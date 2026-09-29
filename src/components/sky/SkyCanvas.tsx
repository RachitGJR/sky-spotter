import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deproject, formatDec, formatRa, project, type SkyPoint } from "@/lib/spherex/astro";
import type { SkyPlane, SpherexHeader } from "@/lib/spherex/archive";
import type { Mover } from "@/lib/spherex/movers";

export type View = { ra: number; dec: number; fovDeg: number };
export type Tone = "ink" | "paper" | "thermal";

type Props = {
  header: SpherexHeader | null;
  plane: SkyPlane | null;
  view: View;
  tone: Tone;
  epoch: 0 | 1;
  epochLabels: [string, string];
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
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ] as const;
}

/** Upper bound on the pixels we shade per sky rebuild, so a big window stays responsive. */
const MAX_SKY_PIXELS = 1_500_000;
/** The sky layer is rebuilt a beat after the controls settle, never mid-drag. */
const SETTLE_MS = 140;

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
    return {
      x: u / cosC / DEG,
      y: (cosD0 * z - sinD0 * w) / cosC / DEG,
    };
  };
}

const DEG = 180 / Math.PI;

export function SkyCanvas({
  header,
  plane,
  view,
  tone,
  epoch,
  epochLabels,
  movers,
  selectedId,
  onSelect,
  onViewChange,
  showGrid,
  busy,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skyRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ra: number; dec: number; view: View } | null>(
    null,
  );
  const draggedRef = useRef(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [settled, setSettled] = useState(view);
  const [skyVersion, setSkyVersion] = useState(0);

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

  useEffect(() => {
    const id = window.setTimeout(() => setSettled(view), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [view]);

  const projectToArchive = useMemo(
    () => (header ? makeProjector(header.ra, header.dec) : null),
    [header],
  );

  // Render the sky once the view settles; blinking only redraws the cheap overlay.
  useEffect(() => {
    if (!header || !plane || !projectToArchive || size.w < 8 || size.h < 8) return;
    const [m11, m12, m21, m22] = header.cd;
    const det = m11 * m22 - m12 * m21;
    if (!det) return;
    const invFactor = plane.width / header.naxis1;
    const baseCol = (header.crpix1 - 1) * invFactor;
    const baseRow = (header.crpix2 - 1) * invFactor;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cap = Math.sqrt(MAX_SKY_PIXELS / Math.max(1, size.w * size.h));
    const scale = Math.min(dpr, Math.max(0.5, cap));
    const w = Math.max(1, Math.round(size.w * scale));
    const h = Math.max(1, Math.round(size.h * scale));

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d", { willReadFrequently: false });
    if (!ctx) return;
    const img = ctx.createImageData(w, h);

    const aspect = w / h;
    const halfH = settled.fovDeg / 2;
    const halfW = halfH * aspect;
    const sx = (2 * halfW) / w;
    const sy = (2 * halfH) / h;
    const dark = tone !== "paper";
    const span = Math.max(1e-9, plane.high - plane.low);
    const { data } = plane;
    const dataW = plane.width;
    const inv1q = 1 / Math.asinh(1 / 0.05);
    const px = img.data;
    const bg = dark ? [16, 16, 18] : [246, 245, 242];

    let i = 0;
    for (let y = 0; y < h; y++) {
      const yStd = halfH - (y + 0.5) * sy;
      for (let x = 0; x < w; x++) {
        const sky = deproject(-halfW + (x + 0.5) * sx, yStd, settled.ra, settled.dec);
        const std = projectToArchive(sky.ra, sky.dec);
        const col = ((m22 * std.x - m12 * std.y) / det) * invFactor + baseCol;
        const row = ((-m21 * std.x + m11 * std.y) / det) * invFactor + baseRow;
        if (
          !Number.isFinite(col) ||
          col < 0 ||
          col >= dataW ||
          row < 0 ||
          row >= plane.height
        ) {
          px[i] = bg[0];
          px[i + 1] = bg[1];
          px[i + 2] = bg[2];
          px[i + 3] = 255;
          i += 4;
          continue;
        }
        const raw = data[Math.round(row) * dataW + Math.round(col)];
        const t = Math.max(0, Math.min(1, (raw - plane.low) / span));
        const level = Number.isFinite(raw) ? Math.asinh(t * 20) * inv1q : 0;
        if (tone === "thermal") {
          const c = thermalColour(level);
          px[i] = c[0];
          px[i + 1] = c[1];
          px[i + 2] = c[2];
        } else {
          const out = dark ? Math.round(255 * level) : 255 - Math.round(255 * level);
          px[i] = out;
          px[i + 1] = out;
          px[i + 2] = dark ? out : Math.max(0, out - 3);
        }
        px[i + 3] = 255;
        i += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
    skyRef.current = off;
    setSkyVersion((n) => n + 1);
  }, [header, plane, settled, tone, size, projectToArchive]);

  const screenOf = useCallback(
    (p: SkyPoint) => {
      const std = project(p.ra, p.dec, settled.ra, settled.dec);
      const aspect = size.w / size.h;
      return {
        x: size.w / 2 + (std.x / (settled.fovDeg * aspect / 2)) * (size.w / 2),
        y: size.h / 2 - (std.y / (settled.fovDeg / 2)) * (size.h / 2),
      };
    },
    [settled, size],
  );

  // Overlay: graticule, motion vectors, markers, scale bar.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const sky = skyRef.current;
    if (sky) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(sky, 0, 0, size.w, size.h);
    }

    const dark = tone !== "paper";
    const grid = dark ? "rgba(255,255,255,0.13)" : "rgba(17,17,19,0.14)";
    const label = dark ? "rgba(255,255,255,0.55)" : "rgba(17,17,19,0.5)";
    const aspect = size.w / size.h;
    const halfH = settled.fovDeg / 2;
    const halfW = halfH * aspect;

    if (showGrid) {
      const nice = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find((s) => s >= settled.fovDeg / 5) ?? 10;
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
        const corner = deproject(x, 0, settled.ra, settled.dec);
        ctx.fillText(formatRa(corner.ra).slice(0, 5), px + 4, 14);
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
        const corner = deproject(0, y, settled.ra, settled.dec);
        ctx.fillText(formatDec(corner.dec).slice(0, 6), 6, py - 4);
      }
    }

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

    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    // Outline the detector footprint so the real sky's extent is never ambiguous.
    if (header && plane) {
      const [m11, m12, m21, m22] = header.cd;
      const det = m11 * m22 - m12 * m21;
      if (det) {
        const invFactor = plane.width / header.naxis1;
        const corner = (col: number, row: number) => {
          const dx = col / invFactor - (header.crpix1 - 1);
          const dy = row / invFactor - (header.crpix2 - 1);
          return screenOf(
            deproject((m22 * dx - m12 * dy) / det, (-m21 * dx + m11 * dy) / det, header.ra, header.dec),
          );
        };
        const tl = corner(0, 0);
        const tr = corner(plane.width - 1, 0);
        const br = corner(plane.width - 1, plane.height - 1);
        const bl = corner(0, plane.height - 1);
        ctx.save();
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.22)" : "rgba(17,17,19,0.2)";
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
        ctx.fillStyle = dark ? "rgba(255,255,255,0.38)" : "rgba(17,17,19,0.35)";
        ctx.fillText("SPHEREX DETECTOR FOOTPRINT", tl.x + 4, tl.y - 5);
        ctx.restore();
      }
    }

    for (const mover of movers) {
      const a = screenOf(mover[epoch === 0 ? "epoch1" : "epoch2"]);
      const b = screenOf(mover[epoch === 0 ? "epoch2" : "epoch1"]);
      const selected = mover.id === selectedId;

      ctx.save();
      ctx.strokeStyle = selected
        ? ACCENT
        : dark
          ? "rgba(194,112,61,0.8)"
          : "rgba(160,80,32,0.75)";
      ctx.lineWidth = selected ? 1.6 : 1.1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();

      const inside = a.x > -20 && a.x < size.w + 20 && a.y > -20 && a.y < size.h + 20;
      if (inside) {
        ctx.beginPath();
        ctx.arc(a.x, a.y, selected ? 8 : 6, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = selected ? 1.8 : 1.2;
        ctx.stroke();
        if (selected) {
          ctx.beginPath();
          ctx.arc(a.x, a.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT;
          ctx.fill();
          ctx.beginPath();
          for (const [dx, dy] of [[-15, 0], [15, 0], [0, -15], [0, 15]] as const) {
            ctx.moveTo(a.x + dx * 0.6, a.y + dy * 0.6);
            ctx.lineTo(a.x + dx, a.y + dy);
          }
          ctx.stroke();
        }
        ctx.fillStyle = selected ? ACCENT : label;
        ctx.fillText(mover.name.replace(/^\d+\s*/, ""), a.x + 11, a.y - 9);
      } else {
        const cx = size.w / 2;
        const cy = size.h / 2;
        const ang = Math.atan2(b.y - cy, b.x - cx);
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
  }, [skyVersion, size, settled, tone, epoch, movers, selectedId, showGrid, screenOf, header, plane]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const mover of movers) {
      const p = screenOf(mover[epoch === 0 ? "epoch1" : "epoch2"]);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 18 && (!best || d < best.d)) best = { id: mover.id, d };
    }
    onSelect(best?.id ?? null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      ra: settled.ra,
      dec: settled.dec,
      view: settled,
    };
    draggedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dRa = -((event.clientX - drag.x) / rect.width) * settled.fovDeg * (rect.width / rect.height);
    const dDec = ((event.clientY - drag.y) / rect.height) * settled.fovDeg;
    if (Math.abs(event.clientX - drag.x) > 3 || Math.abs(event.clientY - drag.y) > 3) {
      draggedRef.current = true;
    }
    onViewChange({
      ...drag.view,
      ra: ((drag.ra + dRa + 180) % 360 + 360) % 360 - 180,
      dec: Math.max(-89.9, Math.min(89.9, drag.dec + dDec)),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    onViewChange({
      ...settled,
      fovDeg: Math.min(
        8,
        Math.max(0.15, settled.fovDeg * (event.deltaY > 0 ? 1.15 : 1 / 1.15)),
      ),
    });
  };

  return (
    <div
      ref={wrapRef}
      className="relative size-full overflow-hidden"
      style={{
        background: tone === "ink" ? INK_BG : tone === "thermal" ? THERMAL_BG : PAPER_BG,
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={handleWheel}
        className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="rounded-sm bg-background/75 px-2 py-1 font-mono text-[11px] tracking-wide text-muted-foreground backdrop-blur-sm">
          {epochLabels[epoch]}
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
