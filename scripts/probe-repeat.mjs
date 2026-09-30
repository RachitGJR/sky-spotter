// Does a fixed QR2 tile number point at the same sky in every week?
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
      return { obsid: map.OBSID, date: map["DATE-OBS"]?.slice(0, 19), ra: Number(map.CRVAL1), dec: Number(map.CRVAL2) };
  }
  return null;
}

const xml = await (await fetch(`${BUCKET}?list-type=2&prefix=qr2/level2/&delimiter=/&max-keys=1000`)).text();
const weeks = [...xml.matchAll(/<CommonPrefixes><Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]);
const names = weeks.map((w) => w.replace("qr2/level2/", ""));
console.log(`${names.length} qr2 weeks\n${names.join(" ")}\n`);

const tile = process.argv[2] ?? "0187_4D2";
for (const w of [names[0], names[8], names[20], names[40], names[60], names[80], names[100], names[120], names[128]]) {
  const keys = await listKeys(w);
  const hit = keys.find((k) => k.includes(`_${tile}_`));
  if (!hit) {
    console.log(`${w.replace("qr2/level2/", "")}  no ${tile}`);
    continue;
  }
  const h = await head(hit);
  console.log(`${w.replace("qr2/level2/", "")}  ${h?.date}  ${h?.ra.toFixed(4)} ${h?.dec.toFixed(4)}  ${h?.obsid}`);
}
