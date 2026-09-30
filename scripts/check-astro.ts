/**
 * The projection is the foundation of everything on screen, and both halves of it
 * have been wrong at different points: an inverted degree constant in the WCS
 * inversion, and a deprojection that did not reduce to the identity near the tangent
 * point. This walks the whole sphere and asserts the pair is a true round trip.
 */
import { deproject, project, separation, formatRa, formatDec } from "../src/lib/spherex/astro";

let worst = 0;
let worstAt = "";
let checks = 0;

// 1. Round trip at a spread of tangent points and tangent points on the sphere.
for (const [ra0, dec0] of [
  [154.84, 18.35],
  [310.61, -11.4],
  [0, 0],
  [45, 89.5],
  [200, -60],
  [359.9, 10],
]) {
  for (const r of [0.001, 0.05, 0.5, 1.7, 2.4, 5]) {
    for (const bearing of [0, 37, 90, 141, 180, 223, 270, 315]) {
      const b = (bearing * Math.PI) / 180;
      const x = r * Math.cos(b);
      const y = r * Math.sin(b);
      const sky = deproject(x, y, ra0, dec0);
      const back = project(sky.ra, sky.dec, ra0, dec0);
      const err = Math.hypot(back.x - x, back.y - y) * 3600;
      checks++;
      if (err > worst) {
        worst = err;
        worstAt = `ra0=${ra0} dec0=${dec0} x=${x.toFixed(3)} y=${y.toFixed(3)} -> ${formatRa(sky.ra)} ${formatDec(sky.dec)}`;
      }
    }
  }
}
console.log(`tangent round trip: ${checks} points, worst error ${worst.toExponential(2)} arcsec`);
console.log(`  worst at ${worstAt}`);

// 2. The tangent origin must be the tangent point, exactly.
for (const [ra0, dec0] of [
  [154.84, 18.35],
  [310.61, -11.4],
  [0, 0],
]) {
  const sky = deproject(0, 0, ra0, dec0);
  const d = separation(sky, { ra: ra0, dec: dec0 }) * 3600;
  if (d > 1e-6) {
    console.log(`FAIL origin: deproject(0,0) at ${ra0},${dec0} is ${d} arcsec away`);
    process.exitCode = 1;
  }
}
console.log("tangent origin lands on the tangent point");

// 3. A known angular offset must survive, in both directions.
for (const [ra0, dec0] of [
  [154.84, 18.35],
  [310.61, -11.4],
  [0, -70],
]) {
  const sky = deproject(1, 0, ra0, dec0);
  const back = project(sky.ra, sky.dec, ra0, dec0);
  const off = separation({ ra: ra0, dec: dec0 }, sky) * 60;
  if (Math.abs(off - 60) > 0.01 || Math.abs(back.x - 1) > 1e-6) {
    console.log(`FAIL 1 degree east at ${ra0},${dec0}: got ${off.toFixed(4)}' and xi=${back.x}`);
    process.exitCode = 1;
  }
  const east = deproject(0, 1, ra0, dec0);
  const north = separation({ ra: ra0, dec: dec0 }, east) * 60;
  if (Math.abs(north - 60) > 0.01) {
    console.log(`FAIL 1 degree north at ${ra0},${dec0}: got ${north.toFixed(4)}'`);
    process.exitCode = 1;
  }
}
console.log("one degree east and one degree north both measure 60'");

// 4. Antipode and pole behaviour must not produce NaN.
for (const [ra0, dec0] of [
  [0, 0],
  [90, 45],
]) {
  for (const [x, y] of [
    [90, 0],
    [0, 90],
    [-45, -45],
  ]) {
    const s = deproject(x, y, ra0, dec0);
    if (!Number.isFinite(s.ra) || !Number.isFinite(s.dec)) {
      console.log(`FAIL non-finite at ${ra0},${dec0} offset ${x},${y}`);
      process.exitCode = 1;
    }
  }
}
console.log("no NaN at extreme offsets");

// 1 milliarcsecond is twelve million times finer than a 6 arcsecond pixel; anything
// below that is floating point noise, anything above it is a real coordinate bug.
const TOLERANCE_ARCSEC = 1e-3;
if (worst > TOLERANCE_ARCSEC) {
  console.log(`\nworst round-trip error ${worst.toExponential(2)} arcsec is too large`);
  process.exitCode = 1;
} else {
  console.log("\nprojection verified");
}
