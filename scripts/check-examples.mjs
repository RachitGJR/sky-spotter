// Re-measure every worked example. The numbers in src/lib/spherex/examples.ts are
// claims about JPL Horizons, so they get checked the same way the field manifest does.
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/spherex/fields.ts", "utf8");
const starts = [...src.matchAll(/^    id: "([\w-]+)",$/gm)];
const fields = new Map();
for (let i = 0; i < starts.length; i++) {
  const chunk = src.slice(starts[i].index, starts[i + 1]?.index ?? src.length);
  fields.set(starts[i][1], {
    des: chunk.match(/designation: "(\d+)"/)[1],
    dates: [...chunk.matchAll(/date: "([\d-]+)"/g)].map((d) => d[1]),
  });
}

const ex = readFileSync("src/lib/spherex/examples.ts", "utf8");
const examples = [...ex.matchAll(/id: "([^"]+)",\s*\n\s*fieldId: "([^"]+)",\s*\n\s*a: (\d+),\s*\n\s*b: (\d+),\s*\n\s*sepDeg: ([\d.]+),\s*\n\s*days: (\d+)/g)].map(
  (m) => ({ id: m[1], fieldId: m[2], a: Number(m[3]), b: Number(m[4]), sepDeg: Number(m[5]), days: Number(m[6]) }),
);
console.log(`${examples.length} worked examples in the manifest\n`);

function sep(ra1, dec1, ra2, dec2) {
  const R = Math.PI / 180;
  const c = Math.sin(dec1 * R) * Math.sin(dec2 * R) + Math.cos(dec1 * R) * Math.cos(dec2 * R) * Math.cos((ra1 - ra2) * R);
  return (Math.acos(Math.max(-1, Math.min(1, c))) / Math.PI) * 180;
}

async function horizons(des, d1, d2) {
  const reversed = d2 < d1;
  const start = reversed ? d2 : d1;
  const stop = reversed ? d1 : d2;
  const days = Math.max(1, Math.round((Date.parse(stop) - Date.parse(start)) / 86400000));
  const p = new URLSearchParams({
    format: "text",
    COMMAND: `'${des}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    REF_PLANE: "'FRAME'",
    ANG_FORMAT: "'DEG'",
    QUANTITIES: "'1'",
    CSV_FORMAT: "'YES'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${days} d'`,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${p}`)).text();
      const rows = text
        .match(/\$\$SOE([\s\S]*?)\$\$EOE/)?.[1]
        .trim()
        .split("\n")
        .map((l) => l.split(",").map((c) => c.trim()))
        .filter((c) => c.length > 5 && c[3] !== "");
      if (!rows || rows.length < 2) continue;
      const toP = (r) => ({ ra: Number(r[3]), dec: Number(r[4]) });
      return reversed ? { a: toP(rows.at(-1)), b: toP(rows[0]) } : { a: toP(rows[0]), b: toP(rows.at(-1)) };
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

let bad = 0;
for (const e of examples) {
  const field = fields.get(e.fieldId);
  if (!field) {
    console.log(`FAIL ${e.id}: no field ${e.fieldId}`);
    bad++;
    continue;
  }
  const d1 = field.dates[e.a];
  const d2 = field.dates[e.b];
  if (!d1 || !d2) {
    console.log(`FAIL ${e.id}: epoch ${e.a} or ${e.b} does not exist in ${e.fieldId}`);
    bad++;
    continue;
  }
  const p = await horizons(field.des, d1, d2);
  if (!p) {
    console.log(`FAIL ${e.id}: Horizons gave no solution for ${field.des}`);
    bad++;
    continue;
  }
  const measured = sep(p.a.ra, p.a.dec, p.b.ra, p.b.dec);
  const realDays = Math.abs(Math.round((Date.parse(d2) - Date.parse(d1)) / 86400000));
  const sepOk = Math.abs(measured - e.sepDeg) < 0.002;
  const dayOk = realDays === e.days;
  if (!sepOk || !dayOk) bad++;
  console.log(
    `${sepOk && dayOk ? "ok  " : "FAIL"} ${e.id.padEnd(20)} ${field.des}  ${d1} → ${d2}  ` +
      `moved ${measured.toFixed(3)}° (claimed ${e.sepDeg}) over ${realDays} d (claimed ${e.days})`,
  );
}
console.log(bad ? `\n${bad} example(s) do not match Horizons` : "\nevery worked example matches Horizons");
process.exit(bad ? 1 : 0);
