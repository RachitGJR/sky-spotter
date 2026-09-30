// Sanity-checks the viewer's WCS maths against the real SPHEREx header values.
// This deliberately imports the app's own projection rather than keeping a copy:
// a private copy of the maths inside the test is how a broken projection shipped.
import { deproject, project } from "../src/lib/spherex/astro";
import { detectorGeometry, fitFovDeg, loadHeader } from "../src/lib/spherex/archive";
import { FIELDS } from "../src/lib/spherex/fields";

const DEG = Math.PI / 180;
const header = await loadHeader(FIELDS[0].epochs[0].key);
const cd = header.cd;
const det = cd[0] * cd[3] - cd[1] * cd[2];
const toRaster = (xi: number, eta: number) => ({
  col: ((cd[3] * xi - cd[1] * eta) / det + header.crpix1 - 1),
  row: ((-cd[2] * xi + cd[0] * eta) / det + header.crpix2 - 1),
});

console.log(
  "plate scale:",
  header.plateScale.toFixed(10),
  `= ${(header.plateScale * 3600).toFixed(3)}"/px`,
);
const geo = detectorGeometry(header);
console.log(
  `field side ${geo.sideDeg.toFixed(3)}°, rolled bounding box ${geo.bboxDeg.toFixed(3)}°`,
);
console.log(`fit for a 16:9 window: ${fitFovDeg(header, 16 / 9).toFixed(3)}°`);
console.log(`fit for a square window: ${fitFovDeg(header, 1).toFixed(3)}°`);

const centre = toRaster(...Object.values(project(header.ra, header.dec, header.ra, header.dec)));
console.log(
  `boresight maps to pixel ${centre.col.toFixed(2)}, ${centre.row.toFixed(2)} (expect ${(
    header.crpix1 - 1
  ).toFixed(2)}, ${(header.crpix2 - 1).toFixed(2)})`);

let failed = 0;

// The pointing is rolled about 22°, so a degree of right ascension is not one
// column and a degree of declination is not one row. The *magnitudes* are what the
// plate scale fixes, and those must hold.
for (const d of [0.25, 1]) {
  const east = toRaster(
    ...Object.values(project(header.ra + d / Math.cos(header.dec * DEG), header.dec, header.ra, header.dec)),
  );
  const north = toRaster(...Object.values(project(header.ra, header.dec + d, header.ra, header.dec)));
  const along = d / header.plateScale;
  const ex = Math.hypot(east.col - centre.col, east.row - centre.row);
  const nr = Math.hypot(north.col - centre.col, north.row - centre.row);
  const ok = Math.abs(ex - along) < 1 && Math.abs(nr - along) < 1;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  +${d}° east is ${ex.toFixed(1)} px away, +${d}° north is ${nr.toFixed(1)} px ` +
      `(plate scale implies ${along.toFixed(1)})`,
  );
}

// The four detector corners must sit on a square of the right size, half a field
// out from the boresight along the detector's own axes.
{
  // Pixel offsets invert to tangent-plane offsets with the plain CD matrix.
  const toTangent = (c: number, r: number) => {
    const dx = c - (header.crpix1 - 1);
    const dy = r - (header.crpix2 - 1);
    return { xi: cd[0] * dx + cd[1] * dy, eta: cd[2] * dx + cd[3] * dy };
  };
  const corners = [
    [0, 0],
    [header.naxis1 - 1, 0],
    [header.naxis1 - 1, header.naxis2 - 1],
    [0, header.naxis2 - 1],
  ].map(([c, r]) => toTangent(c, r));
  const radii = corners.map((p) => Math.hypot(p.xi, p.eta) / header.plateScale);
  // A corner of a square of side n sits half a diagonal away: n/2 * sqrt 2.
  const halfDiagonal = (header.naxis1 / 2) * Math.SQRT2;
  const ok = radii.every((v) => Math.abs(v - halfDiagonal) < 1.5);
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  all four corners ${halfDiagonal.toFixed(0)} px from the boresight ` +
      `(got ${radii.map((r) => r.toFixed(0)).join(", ")})`,
  );
}

const rt = deproject(...Object.values(project(header.ra + 0.7, header.dec - 0.4, header.ra, header.dec)), header.ra, header.dec);
const roundOk = Math.abs(rt.ra - (header.ra + 0.7)) < 1e-6 && Math.abs(rt.dec - (header.dec - 0.4)) < 1e-6;
if (!roundOk) failed++;
console.log(
  `${roundOk ? "ok  " : "FAIL"}  round trip returns ${rt.ra.toFixed(6)}, ${rt.dec.toFixed(6)}`,
);

console.log(failed ? `\n${failed} WCS check(s) failed` : "\nWCS verified against the live header");
process.exit(failed ? 1 : 0);
