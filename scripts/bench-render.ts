// Where does the time in a blink go? Measure the real shading pass at a realistic
// window size, and compare it against what a flip actually has to do.
import { FIELDS } from "../src/lib/spherex/fields";
import { fitFovDeg, loadHeader, loadPlane } from "../src/lib/spherex/archive";
import { shadeBlinkPair, shadeFrame, type Compare } from "../src/lib/spherex/shade";

const header = await loadHeader(FIELDS[0].epochs[0].key);
const plane = await loadPlane(header, 510);
const view = { ra: header.ra, dec: header.dec, fovDeg: fitFovDeg(header, 16 / 9) };

// A typical laptop window: the console is full-bleed minus a 286px rail.
const SIZES: [string, number, number][] = [
  ["1280x720 (small laptop)", 994, 560],
  ["1600x900 (common)", 1314, 700],
  ["1920x1080 (desktop)", 1634, 880],
];

const MAX_SKY_PIXELS = 1_400_000;

for (const [label, cw, ch] of SIZES) {
  const dpr = 2;
  const cap = Math.sqrt(MAX_SKY_PIXELS / (cw * ch));
  const scale = Math.min(dpr, Math.max(0.5, cap));
  const w = Math.round(cw * scale);
  const h = Math.round(ch * scale);

  const run = (compare: Compare, epoch: 0 | 1) => {
    const t0 = performance.now();
    const f = shadeFrame({
      a: { header, plane },
      b: { header, plane },
      compare,
      epoch,
      tone: "ink",
      view,
      width: w,
      height: h,
    });
    return { ms: performance.now() - t0, bytes: f.data.length };
  };

  // Warm up, then take the best of three.
  run("blink", 0);
  const blink = [run("blink", 0), run("blink", 1), run("blink", 0)].map((r) => r.ms);
  const overlay = [run("overlay", 0), run("overlay", 0), run("overlay", 0)].map((r) => r.ms);
  const blinkBest = Math.min(...blink);
  const overlayBest = Math.min(...overlay);

  console.log(
    `${label.padEnd(26)} sky ${w}x${h} (${((w * h) / 1e6).toFixed(2)} Mpx)  ` +
      `blink frame ${blinkBest.toFixed(0)}ms  overlay frame ${overlayBest.toFixed(0)}ms`,
  );
  console.log(
    `${"".padEnd(26)} a flip at 0.95s spends ${((blinkBest / 950) * 100).toFixed(1)}% of the budget on the sky alone`,
  );
}

console.log(`
What a cached flip would cost instead: one putImageData of ~${((1634 * 880) / 1e6).toFixed(1)} Mpx,
which is a memcpy, not a resample.`);

// With the pair cache, a flip is a blit of two pre-shaded frames. Time the copy.
{
  const w = 1400;
  const h = 800;
  const t0 = performance.now();
  const pair = shadeBlinkPair({ a: { header, plane }, b: { header, plane }, tone: "ink", view, width: w, height: h });
  const buildMs = performance.now() - t0;
  // No DOM in bun, so time the copy of the pixel buffer the browser would memcpy.
  const dst = new Uint8ClampedArray(w * h * 4);
  const t1 = performance.now();
  const iters = 20;
  for (let i = 0; i < iters; i++) {
    dst.set(pair.a.data);
    dst.set(pair.b.data);
  }
  const per = (performance.now() - t1) / iters;
  console.log(`\nat ${w}x${h} (1.12 Mpx) a two-frame flip copies ${(dst.byteLength * 2 / 1e6).toFixed(1)} MB in ${per.toFixed(1)} ms`);
  console.log(`building that pair from the archive costs ${buildMs.toFixed(0)} ms, and happens once per view, never per flip`);
  console.log(`a flip at the 0.95 s default now spends ${((per / 950) * 100).toFixed(1)}% of its budget drawing, was 26%`);
}
