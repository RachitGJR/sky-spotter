import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deproject, formatDec, formatRa, project, type SkyPoint } from "@/lib/spherex/astro";
import type { SkyPlane, SpherexHeader } from "@/lib/spherex/archive";
import type { Mover } from "@/lib/spherex/movers";

export type View = { ra: number; dec: number; fovDeg: number };
export type Tone = "ink" | "paper" | "thermal";
/** How the two selected epochs are combined on screen. */
export type Compare = "blink" | "split" | "overlay" | "diff";

export type Epoch = {
  header: SpherexHeader | null;
  plane: SkyPlane | null;
  label: string;
  short: string;
  busy?: boolean;
};

type Props = {
  /** Epoch A, the reference. */
  a: Epoch;
  /** Epoch B, the comparison. */
  b: Epoch;
  compare: Compare;
  view: View;
  tone: Tone;
  /** Which epoch the markers and vectors are drawn at. Ignored in split/overlay/diff. */
  epoch: 0 | 1;
  movers: Mover[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onViewChange: (view: View) => void;
  showGrid: boolean;
  busy: boolean;
};

const INK_BG = "#0b0b0c";
const PAPER_BG = "#f7f6f3";
const THERMAL_BG = "#05070d";
const ACCENT = "#c2703d";

/** False-colour ramp for the thermal view: cool for faint sky, hot for point sources. */
const THERMAL_STOPS: [number, number, number][] = [
  [8, 14, 40],
  [18, 62, 96],
  [46, 140, 132],
  [206, 156, 66],
  [252, 236, 214],
];

function thermalColour(t: number) {
  const x = Math.max(0, Math.min(0.9999, t)) * (THERMAL_STOPS.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = THERMAL_STOPS[i];
  const b = THERMAL_STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] as const;
}

const DEG = 180 / Math.PI;

/**
 * Upper bound on the pixels one sky rebuild shades. Both epochs are resampled in a
 * single pass, so this is the whole cost of a pan or a zoom, not twice it.
 */
const MAX_SKY_PIXELS = 1_400_000;
/**
 * The sky bitmap is rebuilt one frame after the view stops moving. Until then the
 * previous bitmap is transformed on the GPU to follow the pointer, so panning and
 * zooming are instant and the overlay is always drawn in the same frame as the sky
 * underneath it. That shared frame is what stops the blink from tearing.
 */
const REBUILD_DELAY_MS = 90;

const ZOOM_MIN = 0.15;
/** Zooming out past the detector only ever shows empty sky, so it is not offered. */
const ZOOM_OUT_MARGIN = 1.06;

/** World unit vector -> tangent plane, using dot products instead of trig. */
function makeProjector(ra0Deg: number, dec0Deg: number) {
  const d0 = (dec0Deg * Math.PI) / 180;
  const a0 = (ra0Deg * Math.PI) / 180;
  const sinD0 = Math.sin(d0);
  const cosD0 = Math.cos(d0);
  const sinA0 = Math.sin(a0);
  const cosA0 = Math.cos(a0);
  return (raDeg: number, decDeg: number) => {
    const d = (decDeg * Math.PI) / 180;
    const a = (raDeg * Math.PI) / 180;
    const cosD = Math.cos(d);
    const z = Math.sin(d);
    const x = cosD * Math.cos(a);
    const y = cosD * Math.sin(a);
    const u = y * cosA0 - x * sinA0;
    const w = x * cosA0 + y * sinA0;
    const cosC = sinD0 * z + cosD0 * w;
    if (cosC <= 1e-9) return { x: NaN, y: NaN };
    return { x: u / cosC / DEG, y: (cosD0 * z - sinD0 * w) / cosC / DEG };
  };
}

type Shade = {
  header: SpherexHeader;
  plane: SkyPlane;
  /** Standard-coordinate (deg) -> plane sample index. */
  toIndex: (ra: number, dec: number) => number;
  low: number;
  span: number;
  width: number;
  height: number;
};

function makeShade(header: SpherexHeader, plane: SkyPlane): Shade {
  const [m11, m12, m21, m22] = header.cd;
  const det = m11 * m22 - m12 * m21;
  const inv = plane.width / header.naxis1;
  const baseCol = (header.crpix1 - 1) * inv;
  const baseRow = (header.crpix2 - 1) * inv;
  const project = makeProjector(header.ra, header.dec);
  const k = 1 / det;
  return {
    header,
    plane,
    width: plane.width,
    height: plane.height,
    low: plane.low,
    span: Math.max(1e-9, plane.high - plane.low),
    toIndex(ra, dec) {
      const std = project(ra, dec);
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

function levelOf(s: Shade, i: number) {
  if (i < 0) return -1;
  const raw = s.plane.data[i];
  if (!Number.isFinite(raw)) return 0;
  const t = Math.max(0, Math.min(1, (raw - s.low) / s.span));
  return Math.asinh(t * 20) / Math.asinh(20);
}

export function SkyCanvas({
  a,
  b,
  compare,
  view,
  tone,
  epoch,
  movers,
  selectedId,
  onSelect,
  onViewChange,
  showGrid,
  busy,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const skyCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const draggedRef = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  /**
   * The view the pixels on screen were actually drawn for. Interaction uses this,
   * not `view`, so a drag can never drift away from the image under the cursor.
   */
  const drawnRef = useRef<View | null>(null);
  const [drawn, setDrawn] = useState<View | null>(null);

  const zoomOutMax = useMemo(() => {
    const det = Math.max(a.header?.naxis1 ?? 2040, b.header?.naxis1 ?? 2040);
    const scale = a.header?.plateScale ?? b.header?.plateScale ?? 0.0015439;
    return det * scale * ZOOM_OUT_MARGIN;
  }, [a.header, b.header]);

  const clampZoom = useCallback(
    (fovDeg: number) => Math.min(zoomOutMax, Math.max(ZOOM_MIN, fovDeg)),
    [zoomOutMax],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ---------------------------------------------------------------- *
   * Sky layer. One rAF-scheduled rebuild, keyed on the view it was
   * drawn for. While the view is still moving, the old bitmap is
   * transformed in CSS to sit under the pointer.
   * ---------------------------------------------------------------- */
  useEffect(() => {
    if (size.w < 8 || size.h < 8) return;
    const id = window.setTimeout(() => {
      drawnRef.current = view;
      setDrawn(view);
    }, REBUILD_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [view, size.w, size.h]);

  useEffect(() => {
    const canvas = skyCanvasRef.current;
    if (!canvas || !drawn || size.w < 8 || size.h < 8) return;
    const shadeA = a.header && a.plane ? makeShade(a.header, a.plane) : null;
    const shadeB = b.header && b.plane ? makeShade(b.header, b.plane) : null;
    if (!shadeA && !shadeB) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cap = Math.sqrt(MAX_SKY_PIXELS / Math.max(1, size.w * size.h));
    const scale = Math.min(dpr, Math.max(0.5, cap));
    const w = Math.max(1, Math.round(size.w * scale));
    const h = Math.max(1, Math.round(size.h * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);

    const aspect = w / h;
    const halfH = drawn.fovDeg / 2;
    const halfW = halfH * aspect;
    const stepX = (2 * halfW) / w;
    const stepY = (2 * halfH) / h;
    const dark = tone !== "paper";
    const bg = dark ? [14, 14, 16] : [244, 243, 240];
    const px = img.data;
    // In split mode each half shows one epoch; the boundary is a hard vertical cut.
    const splitAt = Math.round(w * 0.5);

    let i = 0;
    for (let y = 0; y < h; y++) {
      const yStd = halfH - (y + 0.5) * stepY;
      for (let x = 0; x < w; x++) {
        const sky = deproject(-halfW + (x + 0.5) * stepX, yStd, drawn.ra, drawn.dec);
        let outR: number;
        let outG: number;
        let outB: number;
        const leftIsA = x < splitAt;

        if (compare === "blink") {
          // Only the epoch on screen has to be resampled, so a flip stays cheap.
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
            // A and B in two colour channels. Stars land on the grey diagonal; a
            // source that moved sits off it, as a coloured pair.
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
            // Signed difference, so a mover reads as a bright/dark dipole.
            const d = la < 0 || lb < 0 ? 0 : Math.max(-1, Math.min(1, (la - lb) * 3.2));
            const mag = Math.abs(d);
            const base = dark ? 12 : 240;
            const hot = dark ? 236 : 16;
            outR = Math.round(base + (hot - base) * (d > 0 ? mag : 0));
            outG = Math.round(base + (hot - base) * (mag * 0.34));
            outB = Math.round(base + (hot - base) * (d < 0 ? mag : 0));
          } else {
            // split: left half epoch A, right half epoch B
            const lp = leftIsA ? la : lb;
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
        px[i] = outR;
        px[i + 1] = outG;
        px[i + 2] = outB;
        px[i + 3] = 255;
        i += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [a.header, a.plane, b.header, b.plane, drawn, tone, compare, epoch, size]);

  /**
   * The live transform that carries the previous bitmap under the pointer while the
   * rebuild is pending. Small offsets are accurate enough over one zoom step, and it
   * costs the compositor nothing.
   */
  /**
   * The live transform that carries the previous frame under the pointer while the
   * rebuild is pending. Both the sky and the overlay sit under the same transform,
   * and the overlay is drawn in the *drawn* view, so the two layers cannot drift
   * apart no matter how fast the pointer moves.
   */
  const transform = useMemo(() => {
    if (!drawn || !size.w || !size.h) return "";
    const k = drawn.fovDeg / view.fovDeg;
    // Where the new view centre sits inside the bitmap we already have.
    const d = project(view.ra, view.dec, drawn.ra, drawn.dec);
    const aspect = size.w / size.h;
    const qx = (d.x / (drawn.fovDeg * aspect / 2)) * (size.w / 2);
    const qy = -(d.y / (drawn.fovDeg / 2)) * (size.h / 2);
    // Origin at the top-left, so the mapping is exactly translate then scale.
    const tx = (size.w / 2) * (1 - k) - k * qx;
    const ty = (size.h / 2) * (1 - k) - k * qy;
    if (Math.abs(k - 1) < 1e-4 && Math.abs(tx) < 0.4 && Math.abs(ty) < 0.4) return "";
    return `translate(${tx}px, ${ty}px) scale(${k})`;
  }, [drawn, view, size.w, size.h]);

  /* ---------------------------------------------------------------- *
   * Overlay. Cheap, and drawn in the same frame as the sky above it.
   * ---------------------------------------------------------------- */
  const screenOf = useCallback(
    (p: SkyPoint) => {
      const base = drawn ?? view;
      const std = project(p.ra, p.dec, base.ra, base.dec);
      const aspect = size.w / size.h;
      return {
        x: size.w / 2 + (std.x / (base.fovDeg * aspect / 2)) * (size.w / 2),
        y: size.h / 2 - (std.y / (base.fovDeg / 2)) * (size.h / 2),
      };
    },
    [drawn, view, size],
  );

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || size.w < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const base = drawn ?? view;
    const dark = tone !== "paper";
    const grid = dark ? "rgba(255,255,255,0.13)" : "rgba(17,17,19,0.14)";
    const label = dark ? "rgba(255,255,255,0.55)" : "rgba(17,17,19,0.5)";
    const aspect = size.w / size.h;
    const halfH = base.fovDeg / 2;
    const halfW = halfH * aspect;

    if (showGrid) {
      const nice = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find((s) => s >= base.fovDeg / 5) ?? 10;
      ctx.lineWidth = 1;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = label;
      const span = Math.ceil(halfW / nice);
      for (let k = -span; k <= span; k++) {
        const x = k * nice;
        if (x === 0 || Math.abs(x) > halfW) continue;
        const px = size.w / 2 + (x / halfW) * (size.w / 2);
        ctx.strokeStyle = grid;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, 0);
        ctx.lineTo(Math.round(px) + 0.5, size.h);
        ctx.stroke();
        ctx.fillText(formatRa(deproject(x, 0, base.ra, base.dec).ra).slice(0, 5), px + 4, 14);
      }
      const rows = Math.ceil(halfH / nice);
      for (let k = -rows; k <= rows; k++) {
        const y = k * nice;
        if (y === 0 || Math.abs(y) > halfH) continue;
        const py = size.h / 2 - (y / halfH) * (size.h / 2);
        ctx.strokeStyle = grid;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(py) + 0.5);
        ctx.lineTo(size.w, Math.round(py) + 0.5);
        ctx.stroke();
        ctx.fillText(formatDec(deproject(0, y, base.ra, base.dec).dec).slice(0, 6), 6, py - 4);
      }
    }

    // Scale bar, sized against the shortest sensible step.
    const targets = [1 / 60, 2 / 60, 5 / 60, 0.1, 0.2, 0.5, 1, 2, 5];
    const barDeg = targets.find((t) => (t / halfH) * (size.h / 2) > 70) ?? 5;
    const barPx = (barDeg / halfH) * (size.h / 2);
    ctx.strokeStyle = label;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, size.h - 20);
    ctx.lineTo(16 + barPx, size.h - 20);
    ctx.moveTo(16, size.h - 24);
    ctx.lineTo(16, size.h - 16);
    ctx.moveTo(16 + barPx, size.h - 24);
    ctx.lineTo(16 + barPx, size.h - 16);
    ctx.stroke();
    ctx.fillStyle = label;
    ctx.fillText(barDeg >= 1 ? `${barDeg}°` : `${Math.round(barDeg * 60)}′`, 16, size.h - 28);

    // Detector footprints. Outside them there is no data, so they get a soft
    // wash rather than a hard black void.
    const wash = dark ? "rgba(255,255,255,0.022)" : "rgba(17,17,19,0.03)";
    for (const header of [a.header, b.header]) {
      if (!header) continue;
      const [m11, m12, m21, m22] = header.cd;
      const det = m11 * m22 - m12 * m21;
      if (!det) continue;
      const wDeg = header.naxis1 * header.plateScale;
      const hDeg = header.naxis2 * header.plateScale;
      const corner = (dRa: number, dDec: number) => {
        const std = project(header.ra + dRa, header.dec + dDec, base.ra, base.dec);
        return {
          x: size.w / 2 + (std.x / halfW) * (size.w / 2),
          y: size.h / 2 - (std.y / halfH) * (size.h / 2),
        };
      };
      const tl = corner(-wDeg / 2, hDeg / 2);
      const tr = corner(wDeg / 2, hDeg / 2);
      const br = corner(wDeg / 2, -hDeg / 2);
      const bl = corner(-wDeg / 2, -hDeg / 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size.w, size.h);
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.fillStyle = wash;
      ctx.fill("evenodd");
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.24)" : "rgba(17,17,19,0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(17,17,19,0.35)";
      ctx.fillText(`DETECTOR ${header.obsid.split("_").slice(-1)[0]}`, tl.x + 4, tl.y - 5);
      ctx.restore();
    }

    if (compare === "split" && a.header && b.header) {
      const mx = size.w / 2;
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.4)" : "rgba(17,17,19,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(mx) + 0.5, 0);
      ctx.lineTo(Math.round(mx) + 0.5, size.h);
      ctx.stroke();
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = dark ? "rgba(255,255,255,0.7)" : "rgba(17,17,19,0.6)";
      ctx.fillText(a.short, mx - 12, size.h - 28);
      ctx.fillText(b.short, mx + 12, size.h - 28);
    }

    const showVectors = compare === "blink" || compare === "split";
    for (const mover of movers) {
      const pa = mover.epoch1;
      const pb = mover.epoch2;
      const p = epoch === 0 ? pa : pb;
      const s = screenOf(p);
      const selected = mover.id === selectedId;

      if (showVectors) {
        const t = screenOf(epoch === 0 ? pb : pa);
        ctx.save();
        ctx.strokeStyle = selected ? ACCENT : dark ? "rgba(194,112,61,0.75)" : "rgba(160,80,32,0.7)";
        ctx.lineWidth = selected ? 1.6 : 1.1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.restore();
      }

      const inside = s.x > -20 && s.x < size.w + 20 && s.y > -20 && s.y < size.h + 20;
      if (inside) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, selected ? 8 : 6, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = selected ? 1.8 : 1.2;
        ctx.stroke();
        if (selected) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
          ctx.beginPath();
          for (const [dx, dy] of [[-15, 0], [15, 0], [0, -15], [0, 15]] as const) {
            ctx.moveTo(s.x + dx * 0.6, s.y + dy * 0.6);
            ctx.lineTo(s.x + dx, s.y + dy);
          }
          ctx.stroke();
        }
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = selected ? ACCENT : label;
        ctx.fillText(mover.name.replace(/^\d+\s*/, ""), s.x + 11, s.y - 9);
      } else if (showVectors) {
        const cx = size.w / 2;
        const cy = size.h / 2;
        const ang = Math.atan2(s.y - cy, s.x - cx);
        const rx = (size.w / 2) * 0.93;
        const ry = (size.h / 2) * 0.93;
        const t = Math.min(
          Math.abs(Math.cos(ang)) < 1e-6 ? Infinity : Math.abs(rx / Math.cos(ang)),
          Math.abs(Math.sin(ang)) < 1e-6 ? Infinity : Math.abs(ry / Math.sin(ang)),
        );
        ctx.save();
        ctx.translate(cx + t * Math.cos(ang), cy + t * Math.sin(ang));
        ctx.rotate(ang);
        ctx.fillStyle = ACCENT;
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(-4, -4.5);
        ctx.lineTo(-4, 4.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }, [drawn, view, size, tone, compare, epoch, movers, selectedId, showGrid, screenOf, a.header, b.header, a.short, b.short]);

  /* ---------------------------------------------------------------- *
   * Interaction. Every handler works from the view the pixels were
   * drawn for, so a drag tracks the cursor exactly.
   * ---------------------------------------------------------------- */
  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    // Measure against the untransformed wrapper: the canvas rect is being scaled
    // by the pending transform, which would corrupt the hit test.
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    const at = epoch === 0 ? "epoch1" : "epoch2";
    for (const mover of movers) {
      const p = screenOf(mover[at]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 18 && (!best || d < best.d)) best = { id: mover.id, d };
    }
    onSelect(best?.id ?? null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: event.clientX, y: event.clientY, view: drawnRef.current ?? view };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (Math.abs(event.clientX - drag.x) > 3 || Math.abs(event.clientY - drag.y) > 3) {
      draggedRef.current = true;
    }
    const dRa = -((event.clientX - drag.x) / rect.width) * drag.view.fovDeg * (rect.width / rect.height);
    const dDec = ((event.clientY - drag.y) / rect.height) * drag.view.fovDeg;
    onViewChange({
      ...drag.view,
      ra: ((drag.view.ra + dRa + 180) % 360 + 360) % 360 - 180,
      dec: Math.max(-89.9, Math.min(89.9, drag.view.dec + dDec)),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    const base = drawnRef.current ?? view;
    onViewChange({
      ...base,
      fovDeg: clampZoom(base.fovDeg * (event.deltaY > 0 ? 1.15 : 1 / 1.15)),
    });
  };

  return (
    <div
      ref={wrapRef}
      className="relative size-full overflow-hidden"
      style={{ background: tone === "ink" ? INK_BG : tone === "thermal" ? THERMAL_BG : PAPER_BG }}
    >
      <div
        className="absolute inset-0 origin-top-left will-change-transform"
        style={{ transform: transform || undefined }}
      >
        <canvas ref={skyCanvasRef} className="absolute inset-0 size-full" />
        <canvas
          ref={overlayRef}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={handleWheel}
          className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="rounded-sm bg-background/75 px-2 py-1 font-mono text-[11px] tracking-wide text-muted-foreground backdrop-blur-sm">
          {compare === "blink" ? (epoch === 0 ? a.label : b.label) : compare === "split" ? `${a.short} / ${b.short}` : `${a.short} vs ${b.short}`}
        </div>
        {busy && (
          <div className="rounded-sm bg-background/75 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur-sm">
            reading archive…
          </div>
        )}
      </div>
    </div>
  );
}
