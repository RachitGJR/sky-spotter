// Are the 24 files of a 4-digit tile number at the same pointing, or different?
const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;

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
  const res = await fetch(BUCKET + key, { headers: { Range: "bytes=0-18431" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map } = parseCards(buf, b * BLOCK);
    if (map.EXTNAME?.trim() === "IMAGE" && map.CRVAL1)
      return { date: map["DATE-OBS"]?.slice(0, 19), obsid: map.OBSID, ra: Number(map.CRVAL1), dec: Number(map.CRVAL2) };
  }
  return null;
}

const visit = process.argv[2] ?? "2025W17_4B";
const tile = process.argv[3] ?? "0187";
const keys = await listKeys(`qr2/level2/${visit}/`);
const mine = keys.filter((k) => k.includes(`_${tile}_`));
for (const k of mine) {
  const h = await head(k);
  console.log(
    `${k.split("/").pop().padEnd(52)} ${h?.date}  ${h?.ra.toFixed(4)} ${h?.dec.toFixed(4)}  ${h?.obsid}`,
  );
}
