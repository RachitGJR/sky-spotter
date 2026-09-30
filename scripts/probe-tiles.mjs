// Probe how the QR2 all-sky tile sequence walks across the sky in one week.
const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;

async function listKeys(prefix) {
  const out = [];
  let token = null;
  do {
    const url =
      `${BUCKET}?list-type=2&prefix=${prefix}` +
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
  const res = await fetch(BUCKET + key, { headers: { Range: "bytes=0-294911" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map, end } = parseCards(buf, b * BLOCK);
    if (end < 0) continue;
    if (map.EXTNAME?.trim() === "IMAGE" && map.CRVAL1)
      return {
        obsid: map.OBSID,
        date: map["DATE-OBS"]?.slice(0, 10),
        ra: Number(map.CRVAL1),
        dec: Number(map.CRVAL2),
        crpix1: Number(map.CRPIX1),
        crpix2: Number(map.CRPIX2),
        p11: Number(map.PC1_1),
        p12: Number(map.PC1_2),
        p21: Number(map.PC2_1),
        p22: Number(map.PC2_2),
      };
  }
  return null;
}

const week = process.argv[2] ?? "2025W17_4B";
const keys = await listKeys(`qr2/level2/${week}/`);
console.log(`${week}: ${keys.length} files`);
const d2 = keys.filter((k) => /_2D2_/.test(k));
console.log(`  detector-2: ${d2.length}`);
const sample = d2.filter((_, i) => i % Math.max(1, Math.floor(d2.length / 14)) === 0).slice(0, 15);
for (const k of sample) {
  const h = await head(k);
  if (h)
    console.log(
      `  ${k.split("/").pop().match(/_\d{4}_(\d+)D2_/)[1].padStart(4, "0")}  ${h.date}  ${h.ra.toFixed(4)} ${h.dec.toFixed(4)}  p11=${h.p11.toFixed(5)} p21=${h.p21.toFixed(5)} p12=${h.p12.toFixed(5)} p22=${h.p22.toFixed(5)}`,
    );
}
