// Final check: parses the IMAGE header of every field key in the app manifest.
const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;

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

const src = await import("node:fs").then((fs) =>
  fs.readFileSync("src/lib/spherex/fields.ts", "utf8"),
);
const keys = [...src.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);

for (const key of keys) {
  const res = await fetch(BUCKET + key, { headers: { Range: "bytes=0-294911" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  let found = null;
  for (let b = 0; b * BLOCK + 80 <= buf.length; b++) {
    const { map, end } = parseCards(buf, b * BLOCK);
    if (end < 0) continue;
    if (map.EXTNAME?.trim() === "IMAGE" && map.CRVAL1) { found = { map, end }; break; }
  }
  if (!found) { console.log(`FAIL ${key.split("/").pop()}`); continue; }
  const m = found.map;
  const n = (k) => Number(m[k]);
  const plate = Math.hypot(n("PC1_1"), n("PC2_1")) * n("CDELT1");
  console.log(
    `${key.split("/").pop().slice(7, 24)}  ${m["DATE-OBS"].slice(0, 19)}  RA ${n("CRVAL1").toFixed(4)} Dec ${n("CRVAL2").toFixed(4)}  ${(plate * 3600).toFixed(3)}"/px  ${(n("NAXIS1") * plate).toFixed(2)}°  PSF ${Number(m.PSF_FWHM).toFixed(1)}"  data@${Math.ceil(found.end / BLOCK) * BLOCK}`,
  );
}
