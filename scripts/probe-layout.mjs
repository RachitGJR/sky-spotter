// Understand the QR2/QR3 key layout: suffixes, sequence numbers, tiles per week.
const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";

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

async function weeks(prefix) {
  const xml = await (
    await fetch(`${BUCKET}?list-type=2&prefix=${prefix}&delimiter=/&max-keys=1000`)
  ).text();
  return [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map((m) => m[1]);
}

for (const q of ["qr2/level2/", "qr3/level2/"]) {
  const w = await weeks(q);
  console.log(`${q}: ${w.length} weeks`);
  console.log("  " + w.map((x) => x.split("/")[2]).join(" "));
}

const w2 = await weeks("qr2/level2/");
const w3 = await weeks("qr3/level2/");
const k2 = await listKeys(w2[0]);
const k3 = await listKeys(w3[0]);
const shape = (ks) => {
  const s = new Set();
  const seq = new Set();
  for (const k of ks) {
    const m = k.match(/level2_\d{4}W\d+_[^_]*?(\d{4})_(\w+?)_spx_(.+)\.fits$/);
    if (m) {
      s.add(m[3]);
      seq.add(m[1]);
    }
  }
  return { shapes: [...s], seqMin: Math.min(...[...seq].map(Number)), seqMax: Math.max(...[...seq].map(Number)), n: seq.size };
};
console.log("qr2 week0", k2.length, shape(k2));
console.log("qr3 week0", k3.length, shape(k3));
console.log("sample qr3 key:", k3[0]);
console.log("sample qr2 key:", k2[0]);
