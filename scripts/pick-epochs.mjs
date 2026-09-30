// Choose the exact exposure for each candidate epoch, then emit the manifest that
// `src/lib/spherex/fields.ts` will carry. Reads live FITS headers, so the output
// is verified rather than assumed.
import { readFileSync, writeFileSync } from "node:fs";

const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;
const SCAN = JSON.parse(readFileSync("/tmp/spherex-scan.json", "utf8"));

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
    if (key === "END") return { map, end: i + 80 };
    if (!key) continue;
    let raw = card.slice(10);
    const slash = raw.indexOf("/");
    if (slash >= 0) raw = raw.slice(0, slash);
    map[key] = raw.trim().replace(/^'(.*)'$/, "$1").trim();
  }
  return { map, end: -1 };
}

async function head(key) {
  const res = await fetch(BUCKET + key, { headers: { Range: "bytes=0-65535" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map, end } = parseCards(buf, b * BLOCK);
    if (end < 0) continue;
    if (map.EXTNAME?.trim() !== "IMAGE" || !map.CRVAL1) continue;
    const n = (k) => Number(map[k]);
    return {
      key,
      obsid: map.OBSID,
      date: map["DATE-OBS"].slice(0, 10),
      ra: n("CRVAL1"),
      dec: n("CRVAL2"),
      plate: Math.hypot(n("PC1_1"), n("PC2_1")) * n("CDELT1"),
      naxis1: n("NAXIS1"),
      psf: n("PSF_FWHM"),
      dataOffset: Math.ceil(end / BLOCK) * BLOCK,
    };
  }
  return null;
}

function sep(ra1, dec1, ra2, dec2) {
  const R = Math.PI / 180;
  const a = dec1 * R;
  const b = dec2 * R;
  const c = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos((ra1 - ra2) * R);
  return (Math.acos(Math.max(-1, Math.min(1, c))) / Math.PI) * 180;
}

const PLAN = {
  "don-quixote": { ra: 154.842923073, dec: 18.3496756158, visits: ["2025W17_4B", "2025W18_1B", "2025W47_2A", "2026W19_2A"] },
  antigone: { ra: 310.612394678, dec: -11.4026997291, visits: ["2025W17_4B", "2025W18_1B", "2025W42_2A", "2026W18_2A"] },
  "40267": { ra: 157.624098628, dec: 31.1799591117, visits: ["2025W17_4B", "2025W19_1B", "2025W47_1A", "2026W18_2A"] },
  erato: { ra: 312.473368519, dec: -17.9743217409, visits: ["2025W17_4B", "2025W23_2B", "2025W43_1A", "2026W18_2A"] },
};

const out = {};
for (const [field, p] of Object.entries(PLAN)) {
  out[field] = [];
  for (const visit of p.visits) {
    const seed = SCAN[visit]?.find((h) => h.field === field);
    if (!seed) throw new Error(`no scan seed for ${field} ${visit}`);
    const tile = seed.key.match(/_(\d{4})_\dD\d_/)[1];
    const keys = (await listKeys(`qr2/level2/${visit}/`)).filter((k) => k.includes(`_${tile}_`));
    if (!keys.length) throw new Error(`tile ${tile} absent in ${visit}`);
    let best = null;
    for (const k of keys) {
      const h = await head(k);
      if (!h) continue;
      const d = sep(h.ra, h.dec, p.ra, p.dec);
      if (!best || d < best.d) best = { d, ...h };
    }
    out[field].push({ ...best, visit, tile, sepDeg: Number(best.d.toFixed(3)) });
    console.log(
      `${field.padEnd(12)} ${visit.padEnd(12)} ${tile}  ${best.date}  ${best.ra.toFixed(4)} ${best.dec.toFixed(4)}  off ${best.d.toFixed(3)}°  ${(best.plate * 3600).toFixed(3)}"/px  data@${best.dataOffset}  ${best.key.split("/").pop()}`,
    );
  }
}

writeFileSync("/tmp/epoch-manifest.json", JSON.stringify(out, null, 2));
console.log("\nwrote /tmp/epoch-manifest.json");
