/**
 * Turns two real SPHEREx exposures into the pixels on screen.
 *
 * Kept separate from the React component so it can be exercised against the real
 * archive without a browser: the loop is the part that decides whether a mover is
 * visible, and it is the part most worth testing.
 *
 * One call produces one frame for every compare mode. The only per-pixel work is a
 * deprojection of the output pixel back to sky coordinates, done once, followed by a
 * lookup into whichever exposure each mode needs.
 */

import { deproject } from "./astro";
import type { SkyPlane, SpherexHeader } from "./archive";

export type Tone = "ink" | "paper" | "thermal";
export type Compare = "blink" | "split" | "overlay" | "diff";
export type View = { ra: number; dec: number; fovDeg: number };

export type EpochPixels = { header: SpherexHeader; plane: SkyPlane };

/** False-colour ramp for the thermal view: cool for faint sky, hot for point sources. */
const THERMAL_STOPS: [number, number, number][] = [
  [8, 14, 40],
  [18, 62, 96],
  [46, 140, 132],
  [206, 156, 66],
  [252, 236, 214],
];

export function thermalColour(t: number) {
  const x = Math.max(0, Math.min(0.9999, t)) * (THERMAL_STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = THERMAL_STOPS[i];
  const b = THERMAL_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] as const;
}

/** Radians per degree. Dividing by this converts the dimensionless tangent-plane
 *  ratio back to degrees, which is the same convention `astro.ts` uses. */
const DEG = Math.PI / 180;
const INV_ASINH20 = 1 / Math.asinh(20);

type Shade = {
  toIndex: (ra: number, dec: number) => number;
  data: Float32Array;
  width: number;
  height: number;
  low: number;
  span: number;
};

/** Precompute the linear transform from sky coordinates to a plane sample index. */
export function makeShade(header: SpherexHeader, plane: SkyPlane): Shade {
  const [m11, m12, m21, m22] = header.cd;
  const det = m11 * m22 - m12 * m21;
  if (!det) throw new Error("degenerate WCS");
  const inv = plane.width / header.naxis1;
  const baseCol = (header.crpix1 - 1) * inv;
  const baseRow = (header.crpix2 - 1) * inv;
  const d0 = (header.dec * Math.PI) / 180;
  const a0 = (header.ra * Math.PI) / 180;
  const sinD0 = Math.sin(d0);
  const cosD0 = Math.cos(d0);
  const sinA0 = Math.sin(a0);
  const cosA0 = Math.cos(a0);
  const k = 1 / det;
  return {
    width: plane.width,
    height: plane.height,
    data: plane.data,
    low: plane.low,
    span: Math.max(1e-9, plane.high - plane.low),
    toIndex(raDeg, decDeg) {
      const d = (decDeg * Math.PI) / 180;
      const a = (raDeg * Math.PI) / 180;
      const cosD = Math.cos(d);
      const z = Math.sin(d);
      const x = cosD * Math.cos(a);
      const y = cosD * Math.sin(a);
      const cosC = sinD0 * z + cosD0 * (x * cosA0 + y * sinA0);
      if (cosC <= 1e-9) return -1;
      // The gnomonic `project` from astro.ts, inlined for the hot loop. ξ runs along
      // the tangent point's right ascension, η along its declination.
      const std = {
        x: (y * cosA0 - x * sinA0) / cosC / DEG,
        y: (z * cosD0 - sinD0 * (x * cosA0 + y * sinA0)) / cosC / DEG,
      };
      const col = (m22 * std.x - m12 * std.y) * k * inv + baseCol;
      const row = (-m21 * std.x + m11 * std.y) * k * inv + baseRow;
      if (
        !Number.isFinite(col) ||
        !Number.isFinite(row) ||
        col < 0 ||
        col >= plane.width ||
        row < 0 ||
        row >= plane.height
      ) {
        return -1;
      }
      return (Math.round(row) * plane.width + Math.round(col)) | 0;
    },
  };
}

/** Stretched 0..1 brightness, or -1 when this exposure does not cover the pixel. */
function levelOf(s: Shade, i: number) {
  if (i < 0) return -1;
  const raw = s.data[i];
  if (!Number.isFinite(raw)) return 0;
  const t = Math.max(0, Math.min(1, (raw - s.low) / s.span));
  return Math.asinh(t * 20) * INV_ASINH20;
}

export type Frame = { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };

export function shadeFrame(opts: {
  a: EpochPixels | null;
  b: EpochPixels | null;
  compare: Compare;
  /** Which epoch the markers describe, and which one blink shows. */
  epoch: 0 | 1;
  tone: Tone;
  view: View;
  width: number;
  height: number;
}): Frame {
  const { a, b, compare, epoch, tone, view, width: w, height: h } = opts;
  const shadeA = a ? makeShade(a.header, a.plane) : null;
  const shadeB = b ? makeShade(b.header, b.plane) : null;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  if (w < 1 || h < 1) return { data, width: w, height: h };

  const dark = tone !== "paper";
  const bg = dark ? [14, 14, 16] : [244, 243, 240];
  const aspect = w / h;
  const halfH = view.fovDeg / 2;
  const halfW = halfH * aspect;
  const stepX = (2 * halfW) / w;
  const stepY = (2 * halfH) / h;
  const splitAt = Math.round(w * 0.5);

  let i = 0;
  for (let y = 0; y < h; y++) {
    const yStd = halfH - (y + 0.5) * stepY;
    for (let x = 0; x < w; x++) {
      const sky = deproject(-halfW + (x + 0.5) * stepX, yStd, view.ra, view.dec);
      let outR: number;
      let outG: number;
      let outB: number;

      if (compare === "blink") {
        // Only the epoch on screen is resampled, so a flip stays cheap.
        const shade = epoch === 0 ? shadeA : shadeB;
        const level = shade ? levelOf(shade, shade.toIndex(sky.ra, sky.dec)) : -1;
        if (level < 0) {
          outR = bg[0];
          outG = bg[1];
          outB = bg[2];
        } else if (tone === "thermal") {
          const c = thermalColour(level);
          outR = c[0];
          outG = c[1];
          outB = c[2];
        } else {
          const v = dark ? Math.round(255 * level) : 255 - Math.round(255 * level);
          outR = v;
          outG = v;
          outB = dark ? v : Math.max(0, v - 3);
        }
      } else {
        const la = shadeA ? levelOf(shadeA, shadeA.toIndex(sky.ra, sky.dec)) : -1;
        const lb = shadeB ? levelOf(shadeB, shadeB.toIndex(sky.ra, sky.dec)) : -1;
        if (compare === "overlay") {
          // A in red and B in blue. A star sits on the grey diagonal because it is
          // the same source in both; anything that moved shows as a coloured pair
          // sitting off that diagonal.
          const s = Math.max(la, lb);
          if (s < 0) {
            outR = bg[0];
            outG = bg[1];
            outB = bg[2];
          } else {
            const d = Math.max(-1, Math.min(1, la - lb));
            const grey = dark ? 26 + 200 * s : 232 - 190 * s;
            outR = Math.max(0, Math.min(255, grey + 150 * d));
            outG = grey;
            outB = Math.max(0, Math.min(255, grey - 150 * d));
          }
        } else if (compare === "diff") {
          // Signed difference: a mover reads as a bright and a dark blob, which is
          // the signature you confirm in a real discovery.
          const d = la < 0 || lb < 0 ? 0 : Math.max(-1, Math.min(1, (la - lb) * 3.2));
          const mag = Math.abs(d);
          const base = dark ? 12 : 240;
          const hot = dark ? 236 : 16;
          outR = Math.round(base + (hot - base) * (d > 0 ? mag : 0));
          outG = Math.round(base + (hot - base) * (mag * 0.34));
          outB = Math.round(base + (hot - base) * (d < 0 ? mag : 0));
        } else {
          const lp = x < splitAt ? la : lb;
          if (lp < 0) {
            outR = bg[0];
            outG = bg[1];
            outB = bg[2];
          } else if (tone === "thermal") {
            const c = thermalColour(lp);
            outR = c[0];
            outG = c[1];
            outB = c[2];
          } else {
            const v = dark ? Math.round(255 * lp) : 255 - Math.round(255 * lp);
            outR = v;
            outG = v;
            outB = dark ? v : Math.max(0, v - 3);
          }
        }
      }
      data[i] = outR;
      data[i + 1] = outG;
      data[i + 2] = outB;
      data[i + 3] = 255;
      i += 4;
    }
  }
  return { data, width: w, height: h };
}

/** Fraction of pixels that carry sky rather than the empty-canvas background. */
export function coveredFraction(frame: Frame, bg: [number, number, number]) {
  let covered = 0;
  for (let i = 0; i < frame.data.length; i += 4) {
    if (
      Math.abs(frame.data[i] - bg[0]) > 2 ||
      Math.abs(frame.data[i + 1] - bg[1]) > 2 ||
      Math.abs(frame.data[i + 2] - bg[2]) > 2
    ) {
      covered++;
    }
  }
  return covered / (frame.width * frame.height);
}
