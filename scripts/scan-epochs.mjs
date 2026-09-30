// Bake a real multi-epoch manifest: for each target field, find the QR2 visit
// tiles closest to that pointing. Only all-sky survey visits work, so we scan a
// candidate list and keep the visits where every field lands inside ~1 degree.
//
//   node scripts/scan-epochs.mjs <visits csv> [concurrency]
//
// Results are cached in /tmp/spherex-scan.json so a re-run resumes instead of
// re-reading ten thousand FITS headers.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;
const HEAD_BYTES = 18432;
const CACHE = "/tmp/spherex-scan.json";
const CONC = Number(process.argv[3] ?? 48);

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

async function listKeys(prefix) {
  const out = [];
  let token = null;
  do {
    const url =
      `${BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix)}` +
      (token ? `&continuation-token=${encodeURIComponent(token)}` : "");
    const xml = await (await fetch(url)).text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push(m[1]);
    const t = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = t ? t[1] : null;
  } while (token);
  return out;
}

function parseCards(buf, from) {
  const text = new TextDecoder();
  const map = {};
  for (let i = from; i + 80 <= buf.length; i += 80) {
    const card = text.decode(buf.subarray(i, i + 80));
    const key = card.slice(0, 8).trim();
    if (key === "END") return { map };
    if (!key) continue;
    let raw = card.slice(10);
    const slash = raw.indexOf("/");
    if (slash >= 0) raw = raw.slice(0, slash);
    map[key] = raw.trim().replace(/^'(.*)'$/, "$1").trim();
  }
  return { map };
}

async function head(key) {
  const res = await fetch(BUCKET + key, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map } = parseCards(buf, b * BLOCK);
    if (map.EXTNAME?.trim() === "IMAGE" && map.CRVAL1)
      return {
        date: map["DATE-OBS"]?.slice(0, 10),
        obsid: map.OBSID,
        ra: Number(map.CRVAL1),
        dec: Number(map.CRVAL2),
      };
  }
  return null;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          out[i] = await fn(items[i]);
        } catch {
          out[i] = null;
        }
      }
    }),
  );
  return out;
}

function sep(ra1, dec1, ra2, dec2) {
  const R = Math.PI / 180;
  const a = dec1 * R;
  const b = dec2 * R;
  const c = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((ra1 - ra2) * R);
  return (Math.acos(Math.max(-1, Math.min(1, c))) / Math.PI) * 180;
}

// Parse the target pointings straight out of the field manifest, line by line.
const src = readFileSync("src/lib/spherex/fields.ts", "utf8");
const targets = [];
{
  let id = null;
  let ra = null;
  for (const line of src.split("\n")) {
    const mId = line.match(/^\s*id: "([\w-]+)",/);
    if (mId) {
      if (id && ra !== null && ra.dec !== null) targets.push(ra);
      id = mId[1];
      ra = { id, ra: NaN, dec: NaN };
      continue;
    }
    const mRa = line.match(/^\s*fallbackRa: (-?[\d.]+),/);
    if (mRa && ra) ra.ra = Number(mRa[1]);
    const mDec = line.match(/^\s*fallbackDec: (-?[\d.]+),/);
    if (mDec && ra) ra.dec = Number(mDec[1]);
  }
  if (id && ra && !Number.isNaN(ra.ra)) targets.push(ra);
}
if (targets.length < 3) throw new Error(`target parse failed (${targets.length})`);
console.log(`${targets.length} targets: ${targets.map((t) => `${t.id}@${t.ra.toFixed(2)}`).join(", ")}`);

for (const visit of process.argv[2].split(",")) {
  if (cache[visit]) {
    console.log(`${visit} cached`);
    continue;
  }
  const keys = await listKeys(`qr2/level2/${visit}/`);
  const byTile = new Map();
  for (const k of keys) {
    const m = k.match(/level2_(.+?)_(\d{4})_(\dD\d)_spx_(.+)\.fits$/);
    if (m && !byTile.has(m[2])) byTile.set(m[2], k);
  }
  const tiles = [...byTile.values()];
  const t0 = Date.now();
  const heads = await pool(tiles, CONC, head);
  const found = heads.filter(Boolean).length;
  const hits = targets.map((t) => {
    let best = null;
    for (let i = 0; i < tiles.length; i++) {
      const h = heads[i];
      if (!h) continue;
      const d = sep(h.ra, h.dec, t.ra, t.dec);
      if (!best || d < best.sepDeg) best = { ...h, key: tiles[i], sepDeg: d };
    }
    return { field: t.id, ...best, sepDeg: Number(best.sepDeg.toFixed(3)) };
  });
  cache[visit] = hits;
  writeFileSync(CACHE, JSON.stringify(cache));
  const worst = Math.max(...hits.map((h) => h.sepDeg));
  console.log(
    `${visit}  ${tiles.length} tiles, ${found} headers, ${((Date.now() - t0) / 1000).toFixed(1)}s  worst ${worst.toFixed(2)}°  ${worst < 1.2 ? "ALL-SKY ✓" : "partial"}`,
  );
  for (const h of hits) console.log(`    ${h.field.padEnd(12)} ${h.date} ${h.ra.toFixed(4)} ${h.dec.toFixed(4)} off ${h.sepDeg}°`);
}
