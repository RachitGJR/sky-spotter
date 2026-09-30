// Verify every epoch in the manifest: header, data offset, and that the pooled
// plane has real stars in it rather than an empty or washed-out stretch.
import { readFileSync } from "node:fs";

const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;

function parseCards(buf, from) {
  const t = new TextDecoder();
  const map = {};
  for (let i = from; i + 80 <= buf.length; i += 80) {
    const c = t.decode(buf.subarray(i, i + 80));
    const key = c.slice(0, 8).trim();
    if (key === "END") return { map, end: i + 80 };
    if (!key) continue;
    let raw = c.slice(10);
    const s = raw.indexOf("/");
    if (s >= 0) raw = raw.slice(0, s);
    map[key] = raw.trim().replace(/^'(.*)'$/, "$1").trim();
  }
  return { map, end: -1 };
}

const src = readFileSync("src/lib/spherex/fields.ts", "utf8");
const blocks = [...src.matchAll(/visit: "([^"]+)",[\s\S]*?key: "([^"]+)",/g)];
console.log(`${blocks.length} epochs in the manifest\n`);

let bad = 0;
for (const [, visit, key] of blocks) {
  const res = await fetch(BUCKET + key, { headers: { Range: "bytes=0-57600" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  let h = null;
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map, end } = parseCards(buf, b * BLOCK);
    if (end < 0 || map.EXTNAME?.trim() !== "IMAGE" || !map.CRVAL1) continue;
    h = { map, offset: Math.ceil(end / BLOCK) * BLOCK };
    break;
  }
  if (!h) {
    console.log(`FAIL ${visit} no IMAGE header`);
    bad++;
    continue;
  }
  const m = h.map;
  const n1 = Number(m.NAXIS1);
  const n2 = Number(m.NAXIS2);
  const nbytes = n1 * n2 * 4;
  const dres = await fetch(BUCKET + key, { headers: { Range: `bytes=${h.offset}-${h.offset + nbytes - 1}` } });
  const plane = new Uint8Array(await dres.arrayBuffer());
  if (plane.byteLength !== nbytes) {
    console.log(`FAIL ${visit} short plane ${plane.byteLength}/${nbytes}`);
    bad++;
    continue;
  }
  const view = new DataView(plane.buffer, plane.byteOffset, plane.byteLength);
  const factor = Math.max(1, Math.round(n1 / 510));
  const w = Math.floor(n1 / factor);
  const hgt = Math.floor(n2 / factor);
  const data = new Float32Array(w * hgt);
  let finite = 0;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      let peak = -Infinity;
      for (let sy = 0; sy < factor; sy++) {
        const row = (y * factor + sy) * n1 + x * factor;
        for (let sx = 0; sx < factor; sx++) {
          const v = view.getFloat32((row + sx) * 4, false);
          if (Number.isFinite(v) && v > peak) peak = v;
        }
      }
      data[y * w + x] = Number.isFinite(peak) ? peak : NaN;
      if (Number.isFinite(peak)) finite++;
    }
  }
  const s = [...data].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const q = (p) => s[Math.floor(p * s.length)];
  const low = q(0.05);
  const high = q(0.995);
  const span = Math.max(1e-9, high - low);
  // Same display metric scripts/check-stars.mjs validated: mean output level for the
  // sky, and the share of pixels that read as a star.
  let sum = 0;
  let total = 0;
  let bright = 0;
  let hot = 0;
  for (const v of data) {
    if (!Number.isFinite(v)) continue;
    const t = Math.max(0, Math.min(1, (v - low) / span));
    const out = Math.round(255 * (Math.asinh(t * 20) / Math.asinh(20)));
    sum += out;
    total++;
    if (out > 40) bright++;
    if (out > 110) hot++;
  }
  const mean = sum / Math.max(1, total);
  const pctBright = (bright / total) * 100;
  const pctHot = (hot / total) * 100;
  const det = Math.abs(Number(m.PC1_1) * Number(m.PC2_2) - Number(m.PC1_2) * Number(m.PC2_1));
  const plate = Math.sqrt(det) * Number(m.CDELT1);
  const ok = finite > 0.9 * data.length && mean >= 4 && mean <= 40 && pctBright > 1 && pctBright < 35;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "BAD "} ${visit.padEnd(12)} ${m["DATE-OBS"].slice(0, 10)}  data@${String(h.offset).padStart(5)}  ${(plate * 3600).toFixed(3)}"/px  ${(n1 * plate).toFixed(2)}°  mean=${mean.toFixed(1)}  >40=${pctBright.toFixed(1)}%  >110=${pctHot.toFixed(2)}%`,
  );
}
console.log(bad ? `\n${bad} epoch(s) failed` : "\nall epochs verified");
