/** Gnomonic (TAN) projection helpers, matching the `RA---TAN-SIP` WCS used by
 *  the SPHEREx archive products. */

const DEG = Math.PI / 180;

export type SkyPoint = { ra: number; dec: number };

/** World coordinates (degrees) -> tangent plane (degrees) about the tangent point. */
export function project(ra: number, dec: number, ra0: number, dec0: number) {
  const a = ra * DEG;
  const d = dec * DEG;
  const a0 = ra0 * DEG;
  const d0 = dec0 * DEG;
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosC <= 1e-9) return { x: NaN, y: NaN };
  const cosd = Math.cos(d);
  return {
    x: (cosd * Math.sin(a - a0)) / cosC / DEG,
    y: (cosd * Math.cos(d0) * Math.sin(d) - Math.sin(d0) * cosd * Math.cos(a - a0)) / cosC / DEG,
  };
}

/** Tangent plane (degrees) -> world coordinates. */
export function deproject(x: number, y: number, ra0: number, dec0: number) {
  const a0 = ra0 * DEG;
  const d0 = dec0 * DEG;
  const xi = x * DEG;
  const eta = y * DEG;
  const rho = Math.hypot(xi, eta);
  if (rho === 0) return { ra: ra0, dec: dec0 };
  const c = Math.atan(rho);
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const sinD = cosC * Math.sin(d0) + (eta * sinC * Math.cos(d0)) / rho;
  const dec = Math.asin(Math.min(1, Math.max(-1, sinD)));
  const y1 = rho * sinC;
  const x1 = y1 * Math.sin(a0) - xi * Math.cos(d0) * Math.cos(a0);
  const y2 = y1 * Math.cos(a0) + xi * Math.cos(d0) * Math.sin(a0);
  const ra = a0 + Math.atan2(x1, y2);
  return { ra: ((ra / DEG) % 360 + 360) % 360, dec: dec / DEG };
}

/** Great-circle separation in degrees. */
export function separation(a: SkyPoint, b: SkyPoint) {
  const d1 = a.dec * DEG;
  const d2 = b.dec * DEG;
  const dd = (b.dec - a.dec) * DEG;
  const da = (b.ra - a.ra) * DEG;
  const h =
    Math.sin(dd / 2) ** 2 + Math.cos(d1) * Math.cos(d2) * Math.sin(da / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / DEG;
}

/** Position angle of B as seen from A, measured east of north, in degrees. */
export function positionAngle(from: SkyPoint, to: SkyPoint) {
  const a = from.ra * DEG;
  const d = from.dec * DEG;
  const b = to.ra * DEG;
  const e = to.dec * DEG;
  const y = Math.cos(d) * Math.sin(b - a);
  const x = Math.cos(e) * Math.sin(d) - Math.sin(e) * Math.cos(d) * Math.cos(b - a);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

export function formatRa(ra: number) {
  const hours = ra / 15;
  const h = Math.floor(hours);
  const m = (hours - h) * 60;
  return `${String(h).padStart(2, "0")}h ${String(Math.floor(m)).padStart(2, "0")}m ${((m % 1) * 60).toFixed(1).padStart(4, "0")}s`;
}

export function formatDec(dec: number) {
  const sign = dec < 0 ? "−" : "+";
  const a = Math.abs(dec);
  const d = Math.floor(a);
  const m = (a - d) * 60;
  return `${sign}${String(d).padStart(2, "0")}° ${String(Math.floor(m)).padStart(2, "0")}′ ${((m % 1) * 60).toFixed(1).padStart(4, "0")}″`;
}

/** Degrees, rendered the way an astronomer would say it out loud. */
export function formatAngle(deg: number) {
  const a = Math.abs(deg);
  if (a < 1 / 60) return `${(deg * 3600).toFixed(1)}″`;
  if (a < 1) return `${(deg * 60).toFixed(1)}′`;
  return `${deg.toFixed(2)}°`;
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates. Used for the real baseline between two epochs. */
export function daysBetween(fromIso: string, toIso: string) {
  if (!fromIso || !toIso) return 0;
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function shortDate(iso: string) {
  return iso ? iso.slice(0, 10) : "—";
}
