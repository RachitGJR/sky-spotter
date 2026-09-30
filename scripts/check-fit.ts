// A rolled 3.5-degree square cannot both fill a 1.2-aspect window and be fully
// visible. Measure both options on the real footprint: how much of the canvas is
// sky, and how much of the sky makes it on screen.
import { FIELDS } from "../src/lib/spherex/fields";
import { detectorGeometry, loadHeader, loadPlane, fitFovDeg } from "../src/lib/spherex/archive";
import { deproject } from "../src/lib/spherex/astro";

const W = 240;
const H = 200;
const aspect = W / H;
const header = await loadHeader(FIELDS[0].epochs[0].key);
await loadPlane(header, 510);
const geo = detectorGeometry(header);
console.log(`side ${geo.sideDeg.toFixed(3)}°  bbox ${geo.bboxDeg.toFixed(3)}°  canvas aspect ${aspect}\n`);
console.log("  FOV     canvas sky   data kept   note");

/** Fraction of plane samples that land inside the frame, sampled on a grid. */
function dataKept(fovDeg: number) {
  const halfH = fovDeg / 2;
  const halfW = halfH * aspect;
  let inFrame = 0;
  let inPlane = 0;
  const n = 200;
  for (let j = 0; j < n; j++) {
    const yStd = halfH - ((j + 0.5) / n) * 2 * halfH;
    for (let i = 0; i < n; i++) {
      const xStd = -halfW + ((i + 0.5) / n) * 2 * halfW;
      const sky = deproject(xStd, yStd, header.ra, header.dec);
      // Is this sky position on the detector?
      const proj = onDetector(header, sky.ra, sky.dec);
      if (proj) inPlane++;
      if (proj && insideFrame(halfW, halfH, xStd, yStd)) inFrame++;
    }
  }
  return inPlane ? inFrame / inPlane : 0;
}

function insideFrame(halfW: number, halfH: number, x: number, y: number) {
  return Math.abs(x) <= halfW && Math.abs(y) <= halfH;
}

function onDetector(h: typeof header, ra: number, dec: number) {
  // Forward-project the sky position through the WCS by inverting deproject with a
  // bisection on the tangent offsets is overkill; use the standard projection
  // against the header's own tangent point instead.
  const D2R = Math.PI / 180;
  const a = ra * D2R;
  const d = dec * D2R;
  const a0 = h.ra * D2R;
  const d0 = h.dec * D2R;
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosC <= 1e-9) return false;
  const cosd = Math.cos(d);
  const xi = (cosd * Math.sin(a - a0)) / cosC / D2R;
  const eta = (Math.sin(d) * Math.cos(d0) - cosd * Math.sin(d0) * Math.cos(a - a0)) / cosC / D2R;
  const [m11, m12, m21, m22] = h.cd;
  const det = m11 * m22 - m12 * m21;
  const dx = (m22 * xi - m12 * eta) / det;
  const dy = (-m21 * xi + m11 * eta) / det;
  const col = dx + h.crpix1 - 1;
  const row = dy + h.crpix2 - 1;
  return col >= 0 && col <= h.naxis1 - 1 && row >= 0 && row <= h.naxis2 - 1;
}

function canvasSky(fovDeg: number) {
  const halfH = fovDeg / 2;
  const halfW = halfH * aspect;
  let n = 0;
  let total = 0;
  for (let j = 0; j < 200; j++) {
    const yStd = halfH - ((j + 0.5) / 200) * 2 * halfH;
    for (let i = 0; i < 240; i++) {
      const xStd = -halfW + ((i + 0.5) / 240) * 2 * halfW;
      total++;
      if (onDetector(header, deproject(xStd, yStd, header.ra, header.dec).ra, deproject(xStd, yStd, header.ra, header.dec).dec)) n++;
    }
  }
  return n / total;
}

for (const k of [0.72, 0.78, 0.84, 0.88, 0.92, 0.96, 1.0]) {
  const fov = geo.bboxDeg * k;
  console.log(
    `  ${fov.toFixed(3)}   ${(canvasSky(fov) * 100).toFixed(1).padStart(5)}%   ${(dataKept(fov) * 100).toFixed(1).padStart(5)}%   ${k === 1 ? "whole footprint" : ""}`,
  );
}
console.log(`\nfitFovDeg currently returns ${fitFovDeg(header, aspect).toFixed(3)}°`);
