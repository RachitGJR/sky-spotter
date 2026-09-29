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

// Real values from the SPHEREx QR2 product.
const H = {
  ra: 164.705590379, dec: 29.1388961408,
  crpix1: 1020.5, crpix2: 1020.5,
  p11: 0.00154389700165, p12: 0, p21: 0, p22: 0.00154389700165,
  cdelt: 1.0, naxis1: 2040,
};
const cd = [H.p11 * H.cdelt, H.p12 * H.cdelt, H.p21 * H.cdelt, H.p22 * H.cdelt];
const det = cd[0] * cd[3] - cd[1] * cd[2];
const toRaster = (xi, eta) => ({
  col: ((cd[3] * xi - cd[1] * eta) / det + H.crpix1 - 1),
  row: ((-cd[2] * xi + cd[0] * eta) / det + H.crpix2 - 1),
});

console.log("plate scale (deg/px):", cd[0], "=", (cd[0] * 3600).toFixed(3), "arcsec/px");
console.log("field width (deg):", (H.naxis1 * cd[0]).toFixed(3));

const centre = toRaster(...Object.values(project(H.ra, H.dec, H.ra, H.dec)));
console.log("boresight maps to pixel:", centre.col.toFixed(2), centre.row.toFixed(2), "(expect ~1020.5, ~1020.5)");

for (const d of [0.25, 1]) {
  const east = toRaster(...Object.values(project(H.ra + d / Math.cos(H.dec * DEG), H.dec, H.ra, H.dec)));
  const north = toRaster(...Object.values(project(H.ra, H.dec + d, H.ra, H.dec)));
  console.log(`+${d}deg east  -> col ${(east.col - 1020.5).toFixed(1)} (expect +${(d / cd[0]).toFixed(1)})`);
  console.log(`+${d}deg north -> row ${(north.row - 1020.5).toFixed(1)} (expect +${(d / cd[0]).toFixed(1)})`);
}

const rt = deproject(...Object.values(project(H.ra + 0.7, H.dec - 0.4, H.ra, H.dec)), H.ra, H.dec);
console.log("round trip:", rt.ra.toFixed(6), rt.dec.toFixed(6), "expect", (H.ra + 0.7).toFixed(6), (H.dec - 0.4).toFixed(6));
