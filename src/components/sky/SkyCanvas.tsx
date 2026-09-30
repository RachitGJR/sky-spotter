import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deproject, formatDec, formatRa, project, type SkyPoint } from "@/lib/spherex/astro";
import type { SkyPlane, SpherexHeader } from "@/lib/spherex/archive";
import type { Mover } from "@/lib/spherex/movers";
import { shadeBlinkPair, shadeFrame, type Compare, type Tone, type View } from "@/lib/spherex/shade";
import { fitFovDeg } from "@/lib/spherex/archive";
import { MoverInset } from "@/components/sky/MoverInset";

export type { Compare, Tone, View };

/**
 * One quiet line of instruction, in the bottom-left corner, that goes away as soon
 * as the citizen touches the image. It answers the two questions a new user always
 * has and never asks: how do I move this, and what do I click.
 */
function Hint({ text, show }: { text: string; show: boolean }) {
  if (!show) return null;
  return (
    <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--deck-line)] px-3 py-1.5 text-center text-[11px]" style={{ background: "var(--deck-panel)", color: "var(--deck-dim)" }}>
      {text}
    </p>
  );
}

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
  /** ISO dates of the two exposures, shown on the inset. */
  aDate: string;
  bDate: string;
  onViewChange: (view: View) => void;
  /**
   * The canvas owns its own geometry, so it reports the view that shows the whole
   * footprint and the limit beyond which there is only empty canvas.
   */
  onGeometry: (geometry: { fitFov: number; maxFov: number }) => void;
  showGrid: boolean;
  busy: boolean;
};

const INK_BG = "#0b0b0c";
const PAPER_BG = "#f7f6f3";
const THERMAL_BG = "#05070d";
const ACCENT = "#c2703d";

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
  aDate,
  bDate,
  onViewChange,
  onGeometry,
  showGrid,
  busy,
}: Props) {
  const selected = movers.find((m) => m.id === selectedId) ?? null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const skyCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  /** The graticule layer, a real stacked canvas rather than an offscreen blit. */
  const backdropRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const draggedRef = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /**
   * Where the pointer is, in the view the pixels were drawn for. A dot and a
   * coordinate readout follow it, so it is always obvious *where on the sky* you
   * are pointing rather than having to infer it from the graticule.
   */
  const [hover, setHover] = useState<{ x: number; y: number; p: SkyPoint } | null>(null);
  /** A point the citizen has stuck on the sky with a click, tagged with the field it belongs to. */
  const [pin, setPin] = useState<{ p: SkyPoint; key: string } | null>(null);
  /** Set once they touch the image, so the instruction line can retire. */
  const touchedRef = useRef(false);
  const [touched, setTouched] = useState(false);

  /**
   * The view the pixels on screen were actually drawn for. Interaction uses this,
   * not `view`, so a drag can never drift away from the image under the cursor.
   */
  const drawnRef = useRef<View | null>(null);
  const [drawn, setDrawn] = useState<View | null>(null);
  /** Pre-shaded frames, so a blink flip costs a blit instead of a resample. */
  const framesRef = useRef<{ a: ImageData | null; b: ImageData | null }>({ a: null, b: null });

  const zoomOutMax = useMemo(() => {
    const header = a.header ?? b.header;
    if (!header) return 4;
    const aspect = size.w && size.h ? size.w / size.h : 1;
    // A little past the full footprint, so the dashed outline is not glued to the
    // edge, but never further: beyond this there is no sky to show.
    return fitFovDeg(header, aspect) * ZOOM_OUT_MARGIN;
  }, [a.header, b.header, size.w, size.h]);

  const clampZoom = useCallback(
    (fovDeg: number) => Math.min(zoomOutMax, Math.max(ZOOM_MIN, fovDeg)),
    [zoomOutMax],
  );

  const fitFov = useMemo(() => {
    const header = a.header ?? b.header;
    if (!header) return 3.5;
    const aspect = size.w && size.h ? size.w / size.h : 1;
    return fitFovDeg(header, aspect);
  }, [a.header, b.header, size.w, size.h]);

  useEffect(() => {
    onGeometry({ fitFov, maxFov: zoomOutMax });
  }, [fitFov, zoomOutMax, onGeometry]);

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
    const epochA = a.header && a.plane ? { header: a.header, plane: a.plane } : null;
    const epochB = b.header && b.plane ? { header: b.header, plane: b.plane } : null;
    if (!epochA && !epochB) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cap = Math.sqrt(MAX_SKY_PIXELS / Math.max(1, size.w * size.h));
    const scale = Math.min(dpr, Math.max(0.5, cap));
    const w = Math.max(1, Math.round(size.w * scale));
    const h = Math.max(1, Math.round(size.h * scale));

    // Blink needs both exposures; every other mode is a single frame that does not
    // change when the epoch flips. Either way the expensive work happens here, once
    // the view settles, and never on a flip.
    if (compare === "blink") {
      const pair = shadeBlinkPair({ a: epochA, b: epochB, tone, view: drawn, width: w, height: h });
      framesRef.current = {
        a: new ImageData(pair.a.data, pair.a.width, pair.a.height),
        b: new ImageData(pair.b.data, pair.b.width, pair.b.height),
      };
    } else {
      const frame = shadeFrame({
        a: epochA,
        b: epochB,
        compare,
        epoch: 0,
        tone,
        view: drawn,
        width: w,
        height: h,
      });
      framesRef.current = { a: new ImageData(frame.data, frame.width, frame.height), b: null };
    }

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ready = framesRef.current;
    ctx.putImageData(epoch === 0 ? (ready.a as ImageData) : (ready.b ?? (ready.a as ImageData)), 0, 0);
  }, [a.header, a.plane, b.header, b.plane, drawn, tone, compare, size]);

  // A flip in blink mode is a blit of an already-shaded frame. In the other modes
  // the frame does not depend on the epoch at all, so there is nothing to redraw.
  useEffect(() => {
    if (compare !== "blink" || !drawn) return;
    const canvas = skyCanvasRef.current;
    const ready = framesRef.current;
    if (!canvas || !ready) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const frame = epoch === 0 ? ready.a : (ready.b ?? ready.a);
    if (frame) ctx.putImageData(frame, 0, 0);
  }, [epoch, compare, drawn, size]);

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

  /**
   * A faint diagonal hatch marks the part of the canvas the exposures do not
   * cover. SPHEREx's detector is a square held at an angle, so on a wide window
   * the corners are always empty; hatching says "no data here" instead of leaving
   * them looking like a broken render. Built once per tone, not once per flip.
   */
  const hatchPattern = useMemo(() => {
    const tile = document.createElement("canvas");
    tile.width = 8;
    tile.height = 8;
    const ctx = tile.getContext("2d");
    if (!ctx) return null;
    ctx.strokeStyle = tone === "paper" ? "rgba(17,17,19,0.14)" : "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-2, 10);
    ctx.lineTo(10, -2);
    ctx.moveTo(2, 14);
    ctx.lineTo(14, 2);
    ctx.stroke();
    return tile;
  }, [tone]);

  /** A mark only counts while you are still looking at the field it was put on. */
  const fieldKey = `${a.header?.key ?? ""}|${b.header?.key ?? ""}`;
  const activePin = pin && pin.key === fieldKey ? pin.p : null;

  /** Screen pixel back to a sky position, the inverse of screenOf. */
  const skyAt = useCallback(
    (x: number, y: number): SkyPoint => {
      const base = drawn ?? view;
      const aspect = size.w / size.h;
      return deproject(
        ((x - size.w / 2) / (size.w / 2)) * (base.fovDeg * aspect / 2),
        -((y - size.h / 2) / (size.h / 2)) * (base.fovDeg / 2),
        base.ra,
        base.dec,
      );
    },
    [drawn, view, size],
  );

  /**
   * The graticule, scale bar, detector outlines and split divider. None of it
   * depends on which epoch is showing, so it is drawn once into an offscreen canvas
   * and blitted. A blink flip then only redraws the handful of markers.
   */
  useEffect(() => {
    const canvas = backdropRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas || size.w < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const pattern = hatchPattern;

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
    // wash and a dashed edge rather than a hard black void. The four corners come
    // from the real WCS, which is a rolled square, not an axis-aligned box.
    const wash = dark ? "rgba(255,255,255,0.02)" : "rgba(17,17,19,0.028)";
    for (const header of [a.header, b.header]) {
      if (!header) continue;
      const [m11, m12, m21, m22] = header.cd;
      const det = m11 * m22 - m12 * m21;
      if (!det) continue;
      const corner = (col: number, row: number) => {
        const inv = (header.naxis1 - 1) / header.naxis1;
        const dx = col * inv - (header.crpix1 - 1);
        const dy = row * inv - (header.crpix2 - 1);
        const xi = (m22 * dx - m12 * dy) / det;
        const eta = (-m21 * dx + m11 * dy) / det;
        return screenOf(deproject(xi, eta, header.ra, header.dec));
      };
      const tl = corner(0, 0);
      const tr = corner(header.naxis1 - 1, 0);
      const br = corner(header.naxis1 - 1, header.naxis2 - 1);
      const bl = corner(0, header.naxis2 - 1);
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
      if (pattern) {
        const hatch = ctx.createPattern(pattern, "repeat");
        if (hatch) {
          ctx.fillStyle = hatch;
          ctx.fill("evenodd");
        }
      }
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.26)" : "rgba(17,17,19,0.22)";
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
      ctx.fillStyle = dark ? "rgba(255,255,255,0.42)" : "rgba(17,17,19,0.35)";
      ctx.fillText("SPHEREX DETECTOR", tl.x + 5, tl.y + 11);
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
  }, [
    drawn,
    view,
    size,
    tone,
    compare,
    showGrid,
    a.header,
    b.header,
    a.short,
    b.short,
    screenOf,
    hatchPattern,
  ]);

  /** Blit the cached backdrop, then draw only what the current epoch changes. */
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas || size.w < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The graticule lives on its own stacked canvas, so a flip only clears and
    // redraws the handful of markers rather than re-blitting a full-size layer.
    ctx.clearRect(0, 0, size.w, size.h);

    const dark = tone !== "paper";

    // The pin goes down first so a body ring always sits on top of it.
    if (activePin) {
      const s = screenOf(activePin);
      const inside = s.x > 0 && s.x < size.w && s.y > 0 && s.y < size.h;
      if (inside) {
        ctx.save();
        ctx.strokeStyle = "#5b8dd6";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(s.x - 9, s.y);
        ctx.lineTo(s.x - 3, s.y);
        ctx.moveTo(s.x + 3, s.y);
        ctx.lineTo(s.x + 9, s.y);
        ctx.moveTo(s.x, s.y - 9);
        ctx.lineTo(s.x, s.y - 3);
        ctx.moveTo(s.x, s.y + 3);
        ctx.lineTo(s.x, s.y + 9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = "#5b8dd6";
        ctx.fillText("your mark", s.x + 12, s.y + 3);
        ctx.restore();
      }
    }

    const label = dark ? "rgba(255,255,255,0.55)" : "rgba(17,17,19,0.5)";
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
        ctx.arc(s.x, s.y, selected ? 11 : 8, 0, Math.PI * 2);
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

    // The hover point. Drawn last so nothing covers it, and deliberately plain: a
    // small open circle with a hairline cross, so it never gets mistaken for a
    // planet marker.
    if (hover) {
      const inside =
        hover.x > 0 && hover.x < size.w && hover.y > 0 && hover.y < size.h;
      if (inside) {
        ctx.save();
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.75)" : "rgba(17,17,19,0.7)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, 5.5, 0, Math.PI * 2);
        ctx.moveTo(hover.x - 11, hover.y);
        ctx.lineTo(hover.x - 7, hover.y);
        ctx.moveTo(hover.x + 7, hover.y);
        ctx.lineTo(hover.x + 11, hover.y);
        ctx.moveTo(hover.x, hover.y - 11);
        ctx.lineTo(hover.x, hover.y - 7);
        ctx.moveTo(hover.x, hover.y + 7);
        ctx.lineTo(hover.x, hover.y + 11);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [drawn, view, size, tone, compare, epoch, movers, selectedId, showGrid, screenOf, hover, activePin, a.header, b.header, a.short, b.short]);

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
    if (!rect || size.w < 8) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // A generous grab radius. A nine-pixel ring is a fiddly target, and the whole
    // point is that a first-time user should be able to hit it without trying.
    let best: { id: string; d: number } | null = null;
    const at = epoch === 0 ? "epoch1" : "epoch2";
    for (const mover of movers) {
      const p = screenOf(mover[at]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 30 && (!best || d < best.d)) best = { id: mover.id, d };
    }
    if (best) {
      onSelect(best.id);
      return;
    }
    // Empty sky: stick a mark exactly where they clicked, so "I found something
    // here" is a thing they can point at rather than a thing they have to describe.
    // Clicking the mark again takes it off.
    const existing = activePin ? screenOf(activePin) : null;
    if (existing && Math.hypot(existing.x - x, existing.y - y) < 14) {
      setPin(null);
      return;
    }
    setPin({ p: skyAt(x, y), key: `${a.header?.key ?? ""}|${b.header?.key ?? ""}` });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!touchedRef.current) {
      touchedRef.current = true;
      setTouched(true);
    }
    dragRef.current = { x: event.clientX, y: event.clientY, view: drawnRef.current ?? view };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect && size.w >= 8) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x >= 0 && x <= size.w && y >= 0 && y <= size.h) {
        setHover({ x, y, p: skyAt(x, y) });
      } else {
        setHover(null);
      }
    }
    const drag = dragRef.current;
    if (!drag || !rect) return;
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

  /** Escape takes the mark off the sky again. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPin(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!touchedRef.current) {
      touchedRef.current = true;
      setTouched(true);
    }
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
        <canvas ref={backdropRef} className="pointer-events-none absolute inset-0 size-full" />
        <canvas
          ref={overlayRef}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={handleWheel}
          onPointerLeave={() => setHover(null)}
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

      {/* The point you are pointing at, named in sky coordinates. A child can find
          this by waving the mouse around; an expert can read the number. */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-sm px-2 py-1 font-mono text-[11px] leading-tight"
          style={{
            left: Math.min(Math.max(hover.x + 16, 8), Math.max(8, size.w - 190)),
            top: Math.min(Math.max(hover.y + 16, 8), Math.max(8, size.h - 40)),
            background: "var(--deck-panel)",
            color: "var(--deck-text)",
            border: "1px solid var(--deck-line)",
          }}
        >
          {formatRa(hover.p.ra)} {formatDec(hover.p.dec)}
        </div>
      )}

      {/* How to move it, said once, quietly, until they have done it. */}
      <Hint
        text="Drag to move the sky · scroll to zoom · click a ring to pick it · click empty sky to mark it"
        show={!touched}
      />

      {selected && (
        <MoverInset
          a={{ header: a.header, plane: a.plane }}
          b={{ header: b.header, plane: b.plane }}
          mover={selected}
          epoch={epoch}
          tone={tone}
          aLabel={a.short}
          bLabel={b.short}
          aDate={aDate}
          bDate={bDate}
        />
      )}
    </div>
  );
}
