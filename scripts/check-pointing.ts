/**
 * The hover readout and the click-to-pin both go screen pixel -> sky position,
 * which is the inverse of the projection the markers use. If those two disagree by
 * more than a fraction of a pixel the readout lies about where you are pointing, and
 * the pin lands somewhere other than where it was clicked, so it is worth pinning
 * down numerically. This is the same inverse SkyCanvas.skyAt performs.
 */
import { deproject, project, separation } from "../src/lib/spherex/astro";

const CASES: [string, number, number, number, number][] = [
  // label, ra0, dec0, fovDeg, aspect
  ["whole footprint, wide", 210.5, 12.25, 4.53, 1.2],
  ["whole footprint, tall", 312.47, -17.97, 4.53, 0.6],
  ["zoomed right in", 86.1, -4.4, 0.15, 1.78],
  ["near the pole", 45.0, 84.9, 1.0, 1.5],
  ["far from the pole", 200.0, -80.0, 2.0, 1.0],
];

let worstPx = 0;
let worstLabel = "";

for (const [label, ra0, dec0, fovDeg, aspect] of CASES) {
  const W = 1200;
  const H = Math.round(W / aspect);
  let caseWorst = 0;

  // A grid of screen points, plus the four corners and the exact centre.
  const xs = [0, 1, W / 4, W / 2, (3 * W) / 4, W - 1, W];
  const ys = [0, 1, H / 3, H / 2, (2 * H) / 3, H - 1, H];

  for (const px of xs) {
    for (const py of ys) {
      // Forward: sky -> screen, exactly as screenOf does it.
      const p = project(ra0 + 0.3, dec0 + 0.2, ra0, dec0);
      const sx = W / 2 + (p.x / (fovDeg * aspect / 2)) * (W / 2);
      const sy = H / 2 - (p.y / (fovDeg / 2)) * (H / 2);
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;

      // Inverse: screen -> sky, exactly as skyAt does it.
      const back = deproject(
        ((sx - W / 2) / (W / 2)) * (fovDeg * aspect / 2),
        -((sy - H / 2) / (H / 2)) * (fovDeg / 2),
        ra0,
        dec0,
      );
      // Back to screen again, and measure how far it landed.
      const again = project(back.ra, back.dec, ra0, dec0);
      const ax = W / 2 + (again.x / (fovDeg * aspect / 2)) * (W / 2);
      const ay = H / 2 - (again.y / (fovDeg / 2)) * (H / 2);
      const errPx = Math.hypot(ax - sx, ay - sy);
      if (errPx > caseWorst) caseWorst = errPx;
    }
  }

  // A point well off the tangent point must survive the trip out to the sky and
  // back, rather than wrapping RA the wrong way round the seam.
  const offRa = project(ra0 + 2.5, dec0 + 1.5, ra0, dec0);
  const offBack = deproject(offRa.x, offRa.y, ra0, dec0);
  const offErr = separation({ ra: (ra0 + 2.5 + 180) % 360 - 180, dec: dec0 + 1.5 }, offBack);

  // And the exact centre must return the tangent point itself.
  const centreBack = deproject(0, 0, ra0, dec0);
  const centreErr = separation({ ra: ra0, dec: dec0 }, centreBack);

  // A point on the frame edge, addressed as a screen pixel the way a click is.
  const edgePx = { x: W - 1, y: 1 };
  const edge = deproject(
    ((edgePx.x - W / 2) / (W / 2)) * (fovDeg * aspect / 2),
    -((edgePx.y - H / 2) / (H / 2)) * (fovDeg / 2),
    ra0,
    dec0,
  );
  const edgeSep = separation({ ra: ra0, dec: dec0 }, edge);
  // A gnomonic projection preserves great-circle *directions*, not radii: a
  // tangent-plane offset r is a separation of atan(r), and at large angles that is
  // meaningfully less than r. So the corner has to land at atan(r), not at r.
  const edgeExpected =
    (Math.atan(
      Math.hypot(
        ((edgePx.x - W / 2) / (W / 2)) * (fovDeg * aspect / 2),
        -((edgePx.y - H / 2) / (H / 2)) * (fovDeg / 2),
      ) * (Math.PI / 180),
    ) *
      180) /
    Math.PI;
  const edgeOk = Math.abs(edgeSep - edgeExpected) < 1e-9;

  const ok = caseWorst < 0.01 && offErr < 1e-6 && centreErr < 1e-9 && edgeOk;
  if (!ok) console.log(`FAIL ${label}`);
  else
    console.log(
      `ok   ${label.padEnd(22)} ${String(W).padStart(4)}x${String(H).padEnd(4)}` +
        `  round-trip ${caseWorst.toExponential(1)} px` +
        `  off-centre ${(offErr * 3600).toExponential(1)}"` +
        `  centre ${(centreErr * 3600).toExponential(1)}"` +
        `  corner ${(edgeSep * 3600).toFixed(1)}"`,
    );
  if (caseWorst > worstPx) {
    worstPx = caseWorst;
    worstLabel = label;
  }
}

console.log(
  `\nworst case ${worstPx.toExponential(1)} px (${worstLabel}); the hover readout and the pin are exact`,
);
