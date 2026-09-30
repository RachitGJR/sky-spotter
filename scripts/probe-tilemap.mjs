// Is a QR2 tile number stable across visits? If the survey tiling is a fixed sky
// grid, the tile that covers a field in one visit covers it in every visit.
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
  const res = await fetch(BUCKET + key, { headers: { Range: "bytes=0-18431" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map } = parseCards(buf, b * BLOCK);
    if (map.EXTNAME?.trim() === "IMAGE" && map.CRVAL1)
      return { date: map["DATE-OBS"]?.slice(0, 10), ra: Number(map.CRVAL1), dec: Number(map.CRVAL2) };
  }
  return null;
}

const xml = await (await fetch(`${BUCKET}?list-type=2&prefix=qr2/level2/&delimiter=/&max-keys=1000`)).text();
const weeks = [...xml.matchAll(/<CommonPrefixes><Prefix>([^<]+)<\/Prefix>/g)].map((m) =>
  m[1].replace("qr2/level2/", ""),
);

const probes = [
  ["0187", 154.8429, 18.3497],
  ["0471", 312.4734, -17.9743],
];

const sample = ["2025W17_4B", "2025W18_1B", "2025W20_1C", "2025W26_1A", "2025W30_2B", "2025W43_2A"];
for (const w of sample) {
  const keys = await listKeys(`qr2/level2/${w}/`);
  const line = [w.padEnd(12)];
  for (const [tile, ra, dec] of probes) {
    const k = keys.find((x) => x.includes(`_${tile}_`));
    if (!k) {
      line.push(`${tile}:absent`);
      continue;
    }
    const h = await head(k);
    const d = h
      ? Math.acos(
          Math.max(
            -1,
            Math.min(
              1,
              Math.sin((h.dec * Math.PI) / 180) * Math.sin((dec * Math.PI) / 180) +
                Math.cos((h.dec * Math.PI) / 180) *
                  Math.cos((dec * Math.PI) / 180) *
                  Math.cos(((h.ra - ra) * Math.PI) / 180),
            ),
          ),
        )
      : NaN;
    line.push(`${tile}:${h ? h.date : "?"} ${h ? ((d * 180) / Math.PI).toFixed(2) : "?"}°`);
  }
  console.log(line.join("   "));
}
