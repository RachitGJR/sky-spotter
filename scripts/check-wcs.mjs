// Sanity-checks the viewer's WCS maths against the real SPHEREx header values.
const DEG = Math.PI / 180;
const R2D = 180 / Math.PI;

function project(ra, dec, ra0, dec0) {
  const a = ra * DEG, d = dec * DEG, a0 = ra0 * DEG, d0 = dec0 * DEG;
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  return {
    x: (Math.cos(d) * Math.sin(a - a0)) / cosC * R2D,
    y: (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosC * R2D,
  };
}

function deproject(x, y, ra0, dec0) {
  const a0 = ra0 * DEG, d0 = dec0 * DEG;
  const xi = x * DEG, eta = y * DEG;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return { ra: ra0, dec: dec0 };
  const c = Math.atan(rho);
  const sinC = Math.sin(c), cosC = Math.cos(c);
  const dec = Math.asin(cosC * Math.sin(d0) + (eta * sinC * Math.cos(d0)) / rho);
  const ra = a0 + Math.atan2(xi * sinC, rho * cosC * Math.cos(d0) - eta * sinC * Math.sin(d0));
  return { ra: ((ra * R2D) % 360 + 360) % 360, dec: dec * R2D };
}

// Real values, read from the archive rather than a hand-written fixture. The
// pointing is rolled, so the WCS is a full PC matrix, and CDELT is a no-op 1.0.
const KEY = "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0187_4D2_spx_l2b-v20-2025-240.fits";
const BUCKET_URL = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;
function cards(buf, from) {
  const dec = new TextDecoder();
  const m = {};
  for (let i = from; i + 80 <= buf.length; i += 80) {
    const c = dec.decode(buf.subarray(i, i + 80));
    if (c.slice(0, 8).trim() === "END") return { m, end: i + 80 };
    const k = c.slice(0, 8).trim();
    if (!k) continue;
    let v = c.slice(10);
    const s = v.indexOf("/");
    if (s >= 0) v = v.slice(0, s);
    m[k] = v.trim().replace(/^'(.*)'$/, "$1").trim();
  }
  return { m, end: -1 };
}
const headBuf = new Uint8Array(
  await (await fetch(BUCKET_URL + KEY, { headers: { Range: "bytes=0-57600" } })).arrayBuffer(),
);
let image = null;
for (let b = 0; b * BLOCK + 80 <= headBuf.length; b++) {
  const r = cards(headBuf, b * BLOCK);
  if (r.end < 0 || r.m.EXTNAME?.trim() !== "IMAGE" || !r.m.CRVAL1) continue;
  image = r.m;
  break;
}
const H = {
  ra: Number(image.CRVAL1),
  dec: Number(image.CRVAL2),
  crpix1: Number(image.CRPIX1),
  crpix2: Number(image.CRPIX2),
  p11: Number(image.PC1_1),
  p12: Number(image.PC1_2),
  p21: Number(image.PC2_1),
  p22: Number(image.PC2_2),
  cdelt: Number(image.CDELT1),
  naxis1: Number(image.NAXIS1),
};const cd = [H.p11 * H.cdelt, H.p12 * H.cdelt, H.p21 * H.cdelt, H.p22 * H.cdelt];
const det = cd[0] * cd[3] - cd[1] * cd[2];
const toRaster = (xi, eta) => ({
  col: ((cd[3] * xi - cd[1] * eta) / det + H.crpix1 - 1),
  row: ((-cd[2] * xi + cd[0] * eta) / det + H.crpix2 - 1),
});

const plate = Math.sqrt(Math.abs(det)) * H.cdelt;
console.log("plate scale (deg/px):", plate.toFixed(10), "=", (plate * 3600).toFixed(3), "arcsec/px");
console.log("field width (deg):", (H.naxis1 * plate).toFixed(3));

const centre = toRaster(...Object.values(project(H.ra, H.dec, H.ra, H.dec)));
console.log("boresight maps to pixel:", centre.col.toFixed(2), centre.row.toFixed(2), "(expect ~1019.5, ~1019.5)");

for (const d of [0.25, 1]) {
  const east = toRaster(...Object.values(project(H.ra + d / Math.cos(H.dec * DEG), H.dec, H.ra, H.dec)));
  const north = toRaster(...Object.values(project(H.ra, H.dec + d, H.ra, H.dec)));
  console.log(`+${d}deg east  -> col ${(east.col - 1019.5).toFixed(1)} (expect +${(d / plate).toFixed(1)})`);
  console.log(`+${d}deg north -> row ${(north.row - 1019.5).toFixed(1)} (expect +${(d / plate).toFixed(1)})`);
}

const rt = deproject(...Object.values(project(H.ra + 0.7, H.dec - 0.4, H.ra, H.dec)), H.ra, H.dec);
console.log("round trip:", rt.ra.toFixed(6), rt.dec.toFixed(6), "expect", (H.ra + 0.7).toFixed(6), (H.dec - 0.4).toFixed(6));
