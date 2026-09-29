// Verifies the display path: decode a real SPHEREx plane, max-pool it, apply the
// same asinh stretch the viewer uses, and report whether stars survive.
const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const KEY = "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0187_4D2_spx_l2b-v20-2025-240.fits";
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

const head = new Uint8Array(await (await fetch(BUCKET + KEY, { headers: { Range: "bytes=0-294911" } })).arrayBuffer());
let h = null;
for (let b = 0; b * BLOCK + 80 <= head.length; b++) {
  const r = cards(head, b * BLOCK);
  if (r.end < 0) continue;
  if (r.m.EXTNAME?.trim() === "IMAGE" && r.m.CRVAL1) { h = { m: r.m, end: r.end }; break; }
}
const naxis = Number(h.m.NAXIS1);
const rows = 512;
const start = Math.ceil(h.end / BLOCK) * BLOCK;
const raw = new Uint8Array(await (await fetch(BUCKET + KEY, { headers: { Range: `bytes=${start}-${start + rows * naxis * 4 - 1}` } })).arrayBuffer());
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

const factor = 4;
const w = Math.floor(naxis / factor);
const hh = Math.floor(rows / factor);
const maxPooled = new Float32Array(w * hh);
const meanPooled = new Float32Array(w * hh);
for (let y = 0; y < hh; y++) {
  for (let x = 0; x < w; x++) {
    let peak = -Infinity, sum = 0, n = 0;
    for (let sy = 0; sy < factor; sy++) {
      const r0 = (y * factor + sy) * naxis + x * factor;
      for (let sx = 0; sx < factor; sx++) {
        const v = dv.getFloat32((r0 + sx) * 4, false);
        if (Number.isFinite(v)) { if (v > peak) peak = v; sum += v; n++; }
      }
    }
    maxPooled[y * w + x] = n ? peak : NaN;
    meanPooled[y * w + x] = n ? sum / n : NaN;
  }
}

function stretchStats(data) {
  const sample = [];
  for (let i = 0; i < data.length; i += 7) {
    const v = data[i];
    if (Number.isFinite(v) && v > 0) sample.push(v);
  }
  sample.sort((a, b) => a - b);
  const q = (p) => sample[Math.min(sample.length - 1, Math.floor(p * sample.length))];
  const pctHigh = Number(process.env.PCT_HIGH ?? 0.995);
  const low = q(0.05), high = q(pctHigh), span = Math.max(1e-9, high - low);
  const inv = 1 / Math.asinh(20);
  let bg = 0, bright = 0, veryBright = 0, total = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    const t = Math.max(0, Math.min(1, (v - low) / span));
    const level = Math.asinh(t * 20) * inv;
    const out = Math.round(255 * level);
    total++;
    if (out > 40) bright++;
    if (out > 110) veryBright++;
    bg += out;
  }
  return {
    low: low.toPrecision(4), high: high.toPrecision(4),
    meanOutput: (bg / total).toFixed(1),
    pctAbove40: ((bright / total) * 100).toFixed(2) + "%",
    pctAbove110: ((veryBright / total) * 100).toFixed(2) + "%",
    pixels: total,
  };
}

console.log("max-pooled :", JSON.stringify(stretchStats(maxPooled)));
console.log("mean-pooled:", JSON.stringify(stretchStats(meanPooled)));
