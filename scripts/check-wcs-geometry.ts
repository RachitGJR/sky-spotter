// Where does the detector actually land on screen? Instrument the real WCS path.
import { FIELDS } from "../src/lib/spherex/fields";
import { detectorGeometry, fitFovDeg, loadHeader, loadPlane } from "../src/lib/spherex/archive";
import { makeShade } from "../src/lib/spherex/shade";
import { deproject, project } from "../src/lib/spherex/astro";

const header = await loadHeader(FIELDS[0].epochs[0].key);
const plane = await loadPlane(header, 510);
const shade = makeShade(header, plane);
const geo = detectorGeometry(header);

const W = 240;
const H = 200;
const aspect = W / H;
const view = { ra: header.ra, dec: header.dec, fovDeg: fitFovDeg(header, aspect) };
const halfH = view.fovDeg / 2;
const halfW = halfH * aspect;
console.log(`side ${geo.sideDeg.toFixed(3)}°  bbox ${geo.bboxDeg.toFixed(3)}°  view half ${halfW.toFixed(3)} x ${halfH.toFixed(3)}`);

// 1. The four detector corners, in plane samples, mapped to the sky.
const corners = [
  [0, 0],
  [plane.width - 1, 0],
  [plane.width - 1, plane.height - 1],
  [0, plane.height - 1],
];
for (const [c, r] of corners) {
  const inv = plane.width / header.naxis1;
  const dx = c / inv - (header.crpix1 - 1);
  const dy = r / inv - (header.crpix2 - 1);
  const [m11, m12, m21, m22] = header.cd;
  const det = m11 * m22 - m12 * m21;
  const xi = (m22 * dx - m12 * dy) / det;
  const eta = (-m21 * dx + m11 * dy) / det;
  const sky = deproject(xi, eta, header.ra, header.dec);
  const back = project(sky.ra, sky.dec, header.ra, header.dec);
  const rad = Math.hypot(back.x, back.y);
  console.log(
    `corner ${c},${r}  xi=${xi.toFixed(4)} eta=${eta.toFixed(4)}  roundtrip ${back.x.toFixed(6)},${back.y.toFixed(6)}  radius ${rad.toFixed(4)}°`,
  );
}

// 2. How much of the frame is inside the footprint?
let inside = 0;
let total = 0;
for (let y = 0; y < H; y++) {
  const yStd = halfH - ((y + 0.5) / H) * 2 * halfH;
  for (let x = 0; x < W; x++) {
    const xStd = -halfW + ((x + 0.5) / W) * 2 * halfW;
    const sky = deproject(xStd, yStd, view.ra, view.dec);
    total++;
    if (shade.toIndex(sky.ra, sky.dec) >= 0) inside++;
  }
}
console.log(`\nframe area ${(2 * halfW * 2 * halfH).toFixed(2)} deg², detector ${(geo.sideDeg * geo.sideDeg).toFixed(2)} deg²`);
console.log(`inside the footprint: ${((inside / total) * 100).toFixed(1)}% of the frame`);

// 3. Which plane samples are actually reachable? Find the sampled index extent.
let minC = 1e9;
let maxC = -1e9;
let minR = 1e9;
let maxR = -1e9;
for (let y = 0; y < H; y += 2) {
  const yStd = halfH - ((y + 0.5) / H) * 2 * halfH;
  for (let x = 0; x < W; x += 2) {
    const xStd = -halfW + ((x + 0.5) / W) * 2 * halfW;
    const sky = deproject(xStd, yStd, view.ra, view.dec);
    const i = shade.toIndex(sky.ra, sky.dec);
    if (i < 0) continue;
    const c = i % plane.width;
    const r = Math.floor(i / plane.width);
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
  }
}
console.log(`plane samples reached: cols ${minC}..${maxC} of 0..${plane.width - 1}, rows ${minR}..${maxR} of 0..${plane.height - 1}`);
console.log(`crpix1 ${header.crpix1}  naxis1 ${header.naxis1}  plane ${plane.width}x${plane.height}`);
