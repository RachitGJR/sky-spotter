import { useEffect, useRef } from "react";
import { project, separation } from "@/lib/spherex/astro";
import type { SkyPlane, SpherexHeader } from "@/lib/spherex/archive";
import type { Mover } from "@/lib/spherex/movers";
import { shadeFrame, type Tone } from "@/lib/spherex/shade";

/**
 * A magnified before/after of the selected body.
 *
 * At the default framing the detector's 3.5 degrees fill most of the window, so a
 * body that moved a third of a degree is a small ring in a wide field and the
 * motion itself is invisible. This panel crops to the movement and shows epoch A on
 * the left and epoch B on the right, with the body ringed in each, so the thing the
 * citizen is meant to find is plainly the thing they are looking at.
 */

type Props = {
  a: { header: SpherexHeader | null; plane: SkyPlane | null };
  b: { header: SpherexHeader | null; plane: SkyPlane | null };
  mover: Mover;
  /** Which epoch the main canvas is showing, so the inset can match it. */
  epoch: 0 | 1;
  tone: Tone;
  aLabel: string;
  bLabel: string;
  /** ISO dates of the two exposures, for the baseline readout. */
  aDate: string;
  bDate: string;
};

const SIZE = 232;
const ACCENT = "#c2703d";
/** Past this the two positions cannot share a frame, so a crop would show empty sky. */
const MAX_CROP_DEG = 1.2;

export function MoverInset({ a, b, mover, epoch, tone, aLabel, bLabel, aDate, bDate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<{ key: string; frame: ImageData | null }>({ key: "", frame: null });

  const pa = mover.epoch1;
  const pb = mover.epoch2;
  const sepDeg = separation(pa, pb);
  // Frame the movement with room around it, but keep a sensible floor so a body
  // that barely moved does not zoom into a meaningless patch of sky.
  const days = Math.max(1, Math.abs(Math.round((Date.parse(bDate) - Date.parse(aDate)) / 86_400_000)));
  const sepText =
    sepDeg >= 1 / 60 ? `${(sepDeg * 60).toFixed(1)}′` : `${(sepDeg * 3600).toFixed(1)}″`;
  // 62 Erato walks further than any crop can hold, and the year-later Don Quixote
  // comparison is not the same patch of sky at all. Saying so is honest; a zoomed
  // panel of empty detector would look like a broken render.
  const tooFar = sepDeg > MAX_CROP_DEG * 0.9;

  const fov = Math.min(MAX_CROP_DEG, Math.max(0.08, sepDeg * 2.2));
  const midRa = (pa.ra + pb.ra) / 2;
  const midDec = (pa.dec + pb.dec) / 2;
  const key = `${mover.id}|${fov.toFixed(4)}|${midRa.toFixed(5)}|${midDec.toFixed(5)}|${a.header?.key ?? ""}|${b.header?.key ?? ""}|${tone}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(SIZE * dpr);
    const h = Math.round(SIZE * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (tooFar) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = ACCENT;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${sepText} apart over ${days} d`, SIZE / 2, SIZE / 2 - 8);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText("too far for one crop", SIZE / 2, SIZE / 2 + 8);
      ctx.textAlign = "left";
      return;
    }

    if (cacheRef.current.key !== key || !cacheRef.current.frame) {
      cacheRef.current.key = key;
      cacheRef.current.frame = null;
      if (a.header && a.plane && b.header && b.plane) {
        const frame = shadeFrame({
          a: { header: a.header, plane: a.plane },
          b: { header: b.header, plane: b.plane },
          compare: "split",
          epoch: 0,
          tone,
          view: { ra: midRa, dec: midDec, fovDeg: fov },
          width: SIZE,
          height: SIZE,
        });
        cacheRef.current.frame = new ImageData(frame.data, frame.width, frame.height);
      }
    }

    ctx.clearRect(0, 0, SIZE, SIZE);
    const frame = cacheRef.current.frame;
    if (!frame) return;
    ctx.putImageData(frame, 0, 0, SIZE / dpr, SIZE / dpr, SIZE, SIZE);

    const dark = tone !== "paper";
    const dim = dark ? "rgba(255,255,255,0.5)" : "rgba(17,17,19,0.45)";

    // Divider.
    const mid = SIZE / 2;
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(mid) + 0.5, 0);
    ctx.lineTo(Math.round(mid) + 0.5, SIZE);
    ctx.stroke();

    // Ring the body in each half, at that half's position.
    const view = { ra: midRa, dec: midDec, fovDeg: fov };
    const place = (p: { ra: number; dec: number }, left: boolean) => {
      const std = project(p.ra, p.dec, view.ra, view.dec);
      const half = SIZE / 2;
      // Each half shows the same view, cropped to its own side.
      const x = left
        ? (0.5 + std.x / (view.fovDeg / 2) * 0.5) * half
        : (0.5 + std.x / (view.fovDeg / 2) * 0.5) * half + half;
      const y = half - (std.y / (view.fovDeg / 2)) * half;
      return { x, y };
    };
    const at = place(pa, true);
    const bt = place(pb, false);

    // Dashed line from the first position to the second, across the divider.
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(bt.x, bt.y);
    ctx.stroke();
    ctx.restore();

    for (const [pt, filled] of [
      [at, epoch === 0],
      [bt, epoch === 1],
    ] as const) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = filled ? ACCENT : dim;
      ctx.lineWidth = filled ? 1.8 : 1;
      ctx.stroke();
    }

    // Labels.
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = epoch === 0 ? ACCENT : dim;
    ctx.fillText(aLabel, 6, 13);
    ctx.fillStyle = epoch === 1 ? ACCENT : dim;
    ctx.textAlign = "right";
    ctx.fillText(bLabel, SIZE - 6, 13);
    ctx.textAlign = "left";
  }, [key, mover.id, epoch, tone, a.header, a.plane, b.header, b.plane, aLabel, bLabel, sepDeg, fov, midRa, midDec, tooFar, sepText, days]);

  return (
    <div
      className="pointer-events-none absolute bottom-5 right-5 overflow-hidden rounded-md border border-[var(--deck-line)]"
      style={{ background: "var(--deck-panel)", width: SIZE, height: SIZE }}
    >
      <canvas ref={canvasRef} style={{ width: SIZE, height: SIZE }} className="block" />
      <p className="absolute inset-x-0 bottom-0 bg-[var(--deck-panel)]/90 px-2 py-1 font-mono text-[9px] tracking-wide text-[var(--deck-dim)]">
        {sepText} over {days} d{tooFar ? "" : ` · ${fov.toFixed(2)}° crop`}
      </p>
    </div>
  );
}
