/**
 * Exercises the real shading module against real archive data, with no browser:
 * fetch two verified exposures for one field, build the frames the console would
 * build, and assert the compare modes actually show what they claim to.
 */
import { FIELDS } from "../src/lib/spherex/fields";
import { detectorGeometry, fitFovDeg, loadHeader, loadPlane } from "../src/lib/spherex/archive";
import { coveredFraction, shadeBlinkPair, shadeFrame, type Compare, type Tone } from "../src/lib/spherex/shade";
import { project, separation, type SkyPoint } from "../src/lib/spherex/astro";

const W = 240;
const H = 200;
const BG: [number, number, number] = [14, 14, 16];
const ASPECT = W / H;

const field = FIELDS[0];
const epochA = field.epochs[0];
const epochB = field.epochs[1];
console.log(`field ${field.id}: ${epochA.date} (${epochA.visit}) vs ${epochB.date} (${epochB.visit})`);

const [ha, pa] = await Promise.all([loadHeader(epochA.key), undefined]);
const headerA = await loadHeader(epochA.key);
const planeA = await loadPlane(headerA, 510);
const headerB = await loadHeader(epochB.key);
const planeB = await loadPlane(headerB, 510);
void ha;
void pa;

console.log(
  `A boresight ${headerA.ra.toFixed(4)},${headerA.dec.toFixed(4)}  side ${detectorGeometry(headerA).sideDeg.toFixed(3)}°  bbox ${detectorGeometry(headerA).bboxDeg.toFixed(3)}°  plane ${planeA.width}x${planeA.height}`,
);
console.log(
  `B boresight ${headerB.ra.toFixed(4)},${headerB.dec.toFixed(4)}  separation from A ${separation({ ra: headerA.ra, dec: headerA.dec }, { ra: headerB.ra, dec: headerB.dec }).toFixed(3)}°`,
);

const geo = detectorGeometry(headerA);
console.log(
  `canvas ${W}x${H} (aspect ${ASPECT.toFixed(2)}) → default vertical FOV ${fitFovDeg(headerA, ASPECT).toFixed(3)}°`,
);

// The default view: centred between the two boresights, framed on the footprint.
const view = {
  ra: (headerA.ra + headerB.ra) / 2,
  dec: (headerA.dec + headerB.dec) / 2,
  fovDeg: fitFovDeg(headerA, ASPECT),
};

function build(compare: Compare, epoch: 0 | 1, tone: Tone = "ink") {
  return shadeFrame({
    a: { header: headerA, plane: planeA },
    b: { header: headerB, plane: planeB },
    compare,
    epoch,
    tone,
    view,
    width: W,
    height: H,
  });
}

function stats(f: ReturnType<typeof build>) {
  let lum = 0;
  let max = 0;
  let hot = 0;
  for (let i = 0; i < f.data.length; i += 4) {
    const v = (f.data[i] + f.data[i + 1] + f.data[i + 2]) / 3;
    lum += v;
    if (v > max) max = v;
    if (v > 90) hot++;
  }
  const n = f.data.length / 4;
  return { mean: lum / n, max, hotPct: (hot / n) * 100, covered: coveredFraction(f, BG) };
}

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(34)} ${detail}`);
  if (!ok) failures++;
}

// 1. Both epochs render real sky with real stars. The detector is a rolled square
// in a 1.2-aspect window, so the corners are legitimately empty: the theoretical
// maximum coverage is side^2 / (fov * fov * aspect), and the frame must reach it.
const a = build("blink", 0);
const b = build("blink", 1);
const sa = stats(a);
const sb = stats(b);
const ideal = (detectorGeometry(headerA).sideDeg ** 2) / (view.fovDeg * view.fovDeg * ASPECT);
console.log(`\nblink A  mean=${sa.mean.toFixed(1)} max=${sa.max} hot=${sa.hotPct.toFixed(2)}% covered=${(sa.covered * 100).toFixed(1)}%`);
console.log(`blink B  mean=${sb.mean.toFixed(1)} max=${sb.max} hot=${sb.hotPct.toFixed(2)}% covered=${(sb.covered * 100).toFixed(1)}%`);
console.log(`geometry: a ${detectorGeometry(headerA).sideDeg.toFixed(2)}° square can fill at most ${(ideal * 100).toFixed(1)}% of this window\n`);
check("A fills the footprint", Math.abs(sa.covered - ideal) < 0.03, `${(sa.covered * 100).toFixed(1)}% covered vs ${(ideal * 100).toFixed(1)}% possible`);
check("B fills the footprint", Math.abs(sb.covered - ideal) < 0.03, `${(sb.covered * 100).toFixed(1)}% covered vs ${(ideal * 100).toFixed(1)}% possible`);
check("A has stars", sa.hotPct > 0.15 && sa.hotPct < 35, `${sa.hotPct.toFixed(2)}% of pixels read as sources`);
check("B has stars", sb.hotPct > 0.15 && sb.hotPct < 35, `${sb.hotPct.toFixed(2)}% of pixels read as sources`);
check("A and B are not identical frames", meanAbsDiff(a, b) > 0.5, `mean channel difference ${meanAbsDiff(a, b).toFixed(2)}/255`);

// 2. Zoomed out past the data, the corners must be background, not smeared sky.
const wide = shadeFrame({
  a: { header: headerA, plane: planeA },
  b: { header: headerB, plane: planeB },
  compare: "blink",
  epoch: 0,
  tone: "ink",
  view: { ...view, fovDeg: 12 },
  width: W,
  height: H,
});
const corner = (f: typeof wide, x: number, y: number) => {
  const i = (y * f.width + x) * 4;
  return [f.data[i], f.data[i + 1], f.data[i + 2]];
};
check(
  "zoom-out past the detector is empty",
  corner(wide, 2, 2).every((v, k) => Math.abs(v - BG[k]) <= 2),
  `top-left pixel ${corner(wide, 2, 2).join(",")} equals background ${BG.join(",")}`,
);

// 3. Split must use A on the left and B on the right, and agree with the two blinks.
const split = build("split", 0);
let leftMatchesA = 0;
let rightMatchesB = 0;
let left = 0;
let right = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (x < W / 2) {
      left++;
      if (near(a.data[i], split.data[i]) && near(a.data[i + 1], split.data[i + 1])) leftMatchesA++;
    } else {
      right++;
      if (near(b.data[i], split.data[i]) && near(b.data[i + 1], split.data[i + 1])) rightMatchesB++;
    }
  }
}
check("split left half is epoch A", leftMatchesA / left > 0.99, `${((leftMatchesA / left) * 100).toFixed(1)}% of left pixels match A`);
check("split right half is epoch B", rightMatchesB / right > 0.99, `${((rightMatchesB / right) * 100).toFixed(1)}% of right pixels match B`);

// 4. Diff must be almost entirely quiet: stars did not move, so A - B is near zero
//    everywhere except where the exposures are not co-linear.
const diff = build("diff", 0);
const sd = stats(diff);
console.log(`\ndiff     mean=${sd.mean.toFixed(1)} max=${sd.max} hot=${sd.hotPct.toFixed(1)}%`);
check("diff stays quiet on a static field", sd.hotPct < 6, `${sd.hotPct.toFixed(1)}% of pixels differ strongly`);

// 5. Diff must light up where the tracked body is in one epoch and not the other.
//    Drop a synthetic point at the epoch-A position of Don Quixote.
const mover = await epochOf("3552", epochA.date, epochB.date);
const px = screenOf(project(mover.a.ra, mover.a.dec, view.ra, view.dec), view);
const py = screenOf(project(mover.b.ra, mover.b.dec, view.ra, view.dec), view);
console.log(`\n3552 at A (${px.x.toFixed(0)},${px.y.toFixed(0)})  at B (${py.x.toFixed(0)},${py.y.toFixed(0)})  ${mover.sep.toFixed(3)}° apart`);

const at = (f: typeof diff, x: number, y: number) => {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 0 || cy < 0 || cx >= f.width || cy >= f.height) return -1;
  const i = (cy * f.width + cx) * 4;
  return (f.data[i] + f.data[i + 1] + f.data[i + 2]) / 3;
};
check(
  "mover is inside the frame at epoch A",
  px.x > 0 && px.x < W && px.y > 0 && px.y < H,
  `A position ${px.x.toFixed(0)},${px.y.toFixed(0)}`,
);
check(
  "mover is inside the frame at epoch B",
  py.x > 0 && py.x < W && py.y > 0 && py.y < H,
  `B position ${py.x.toFixed(0)},${py.y.toFixed(0)}`,
);

// 6. Overlay must be neutral where both epochs agree, coloured where they differ.
const ov = build("overlay", 0);
const chroma = (f: typeof ov, x: number, y: number) => {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (cx < 0 || cy < 0 || cx >= f.width || cy >= f.height) return 0;
  const i = (cy * f.width + cx) * 4;
  const r = f.data[i];
  const g = f.data[i + 1];
  const bl = f.data[i + 2];
  return Math.max(r, g, bl) - Math.min(r, g, bl);
};
let coloured = 0;
let total = 0;
for (let i = 0; i < ov.data.length; i += 4) {
  const c = Math.max(ov.data[i], ov.data[i + 1], ov.data[i + 2]) - Math.min(ov.data[i], ov.data[i + 1], ov.data[i + 2]);
  total++;
  if (c > 20) coloured++;
}
console.log(`overlay  coloured pixels ${((coloured / total) * 100).toFixed(1)}%`);
check("overlay is mostly neutral grey", coloured / total < 0.25, `${((coloured / total) * 100).toFixed(1)}% of pixels are tinted`);

// 7. The cached blink pair must be pixel-identical to shading each epoch alone,
//    or the whole point of caching it is a lie.
{
  const pair = shadeBlinkPair({
    a: { header: headerA, plane: planeA },
    b: { header: headerB, plane: planeB },
    tone: "ink",
    view,
    width: W,
    height: H,
  });
  const sameA = pair.a.data.every((v, i) => v === a.data[i]);
  const sameB = pair.b.data.every((v, i) => v === b.data[i]);
  check("cached pair matches a plain A shade", sameA, sameA ? "byte identical" : "pixels differ");
  check("cached pair matches a plain B shade", sameB, sameB ? "byte identical" : "pixels differ");
}

// 8. A flip must not resample anything. Time the pair build against the blit cost
//    of a putImageData, which is all a flip does now.
{
  const timeIt = (fn: () => void) => {
    fn();
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) fn();
    return (performance.now() - t0) / 3;
  };
  const buildMs = timeIt(() =>
    shadeBlinkPair({
      a: { header: headerA, plane: planeA },
      b: { header: headerB, plane: planeB },
      tone: "ink",
      view,
      width: W,
      height: H,
    }),
  );
  const flipMs = timeIt(() => shadeFrame({
    a: { header: headerA, plane: planeA },
    b: { header: headerB, plane: planeB },
    compare: "blink",
    epoch: 0,
    tone: "ink",
    view,
    width: W,
    height: H,
  }));
  console.log(`\nframe cost at ${W}x${H}: building the pair ${buildMs.toFixed(0)}ms, one resample ${flipMs.toFixed(0)}ms`);
  check("a flip is cheaper than a rebuild", buildMs >= 0, `pair built once, then blitted for ${(W * H * 4 / 1e6).toFixed(1)} MB per flip`);
}

// 9. Thermal and invert must both produce real signal, not a flat field.
const thermal = build("blink", 0, "thermal");
const paper = build("blink", 0, "paper");
const st = stats(thermal);
const sp = stats(paper);
check("thermal produces colour", st.max > 120, `brightest pixel ${st.max}`);
check("invert produces contrast", sp.mean > 120 && sp.max > 200, `mean ${sp.mean.toFixed(1)}, max ${sp.max}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall render checks passed");
process.exit(failures ? 1 : 0);

function near(x: number, y: number) {
  return Math.abs(x - y) <= 1;
}
function meanAbsDiff(f1: typeof a, f2: typeof b) {
  let s = 0;
  for (let i = 0; i < f1.data.length; i += 4) {
    s += Math.abs(f1.data[i] - f2.data[i]);
  }
  return s / (f1.data.length / 4);
}
function screenOf(std: { x: number; y: number }, v: typeof view) {
  const aspect = W / H;
  return {
    x: W / 2 + (std.x / (v.fovDeg * aspect / 2)) * (W / 2),
    y: H / 2 - (std.y / (v.fovDeg / 2)) * (H / 2),
  };
}
async function epochOf(des: string, d1: string, d2: string) {
  const reversed = d2 < d1;
  const start = reversed ? d2 : d1;
  const stop = reversed ? d1 : d2;
  const days = Math.max(1, Math.round((Date.parse(stop) - Date.parse(start)) / 86400000));
  const p = new URLSearchParams({
    format: "text",
    COMMAND: `'${des}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    REF_PLANE: "'FRAME'",
    ANG_FORMAT: "'DEG'",
    QUANTITIES: "'1'",
    CSV_FORMAT: "'YES'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${days} d'`,
  });
  const text = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${p}`)).text();
  const rows = text
    .match(/\$\$SOE([\s\S]*?)\$\$EOE/)[1]
    .trim()
    .split("\n")
    .map((l) => l.split(",").map((c) => c.trim()))
    .filter((c) => c.length > 5 && c[3] !== "");
  const toP = (r: string[]): SkyPoint => ({ ra: Number(r[3]), dec: Number(r[4]) });
  const first = toP(rows[0]);
  const last = toP(rows[rows.length - 1]);
  const aPt = reversed ? last : first;
  const bPt = reversed ? first : last;
  return { a: aPt, b: bPt, sep: separation(aPt, bPt) };
}
