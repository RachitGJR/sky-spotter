// Every epoch pair the console can produce must resolve on JPL Horizons, otherwise
// switching S1..S4 would silently empty the target list. Checks all pairs per field.
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/spherex/fields.ts", "utf8");
// Each field entry starts at its `id:` line and runs to the next one.
const starts = [...src.matchAll(/^    id: "([\w-]+)",$/gm)];
const perField = starts.map((m, i) => {
  const chunk = src.slice(m.index, starts[i + 1]?.index ?? src.length);
  return {
    id: m[1],
    des: chunk.match(/designation: "(\d+)"/)[1],
    dates: [...chunk.matchAll(/date: "([\d-]+)"/g)].map((d) => d[1]),
  };
});
if (perField.length !== 4 || perField.some((f) => f.dates.length < 3)) {
  throw new Error(`field parse failed: ${JSON.stringify(perField.map((f) => [f.id, f.dates.length]))}`);
}

// Mirrors the request convex/sky.ts sends, including the reversed-pair handling.
async function horizons(des, date1, date2) {
  const reversed = date2 < date1;
  const start = reversed ? date2 : date1;
  const stop = reversed ? date1 : date2;
  const days = Math.max(1, Math.round((Date.parse(stop) - Date.parse(start)) / 86400000));
  const params = new URLSearchParams({
    format: "text",
    COMMAND: `'${des}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    REF_PLANE: "'FRAME'",
    ANG_FORMAT: "'DEG'",
    QUANTITIES: "'1,20'",
    CSV_FORMAT: "'YES'",
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${days} d'`,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`)).text();
      const block = text.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
      if (!block) continue;
      const rows = block[1]
        .trim()
        .split("\n")
        .map((l) => l.split(",").map((c) => c.trim()))
        .filter((c) => c.length > 5 && c[3] !== "");
      if (rows.length < 2) continue;
      const toEpoch = (r) => ({ ra: Number(r[3]), dec: Number(r[4]) });
      return { first: toEpoch(rows[0]), last: toEpoch(rows[rows.length - 1]), reversed };
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

let fails = 0;
for (const f of perField) {
  console.log(`\n${f.id} (${f.des})  ${f.dates.join("  ")}`);
  // Every ordered pair, because A and B can be any two of the four.
  for (let i = 0; i < f.dates.length; i++) {
    for (let j = 0; j < f.dates.length; j++) {
      if (i === j) continue;
      const r = await horizons(f.des, f.dates[i], f.dates[j]);
      if (!r) {
        console.log(`  S${i + 1}->S${j + 1}  NO SOLUTION`);
        fails++;
        continue;
      }
      const a = r.reversed ? r.last : r.first;
      const b = r.reversed ? r.first : r.last;
      const d = Math.hypot(a.ra - b.ra, (a.dec - b.dec) * Math.cos((a.dec * Math.PI) / 180));
      const days = Math.abs(Math.round((Date.parse(f.dates[j]) - Date.parse(f.dates[i])) / 86400000));
      console.log(
        `  S${i + 1}->S${j + 1}  ${String(days).padStart(4)} d  moved ${d.toFixed(3)}°  A ${a.ra.toFixed(3)},${a.dec.toFixed(3)}`,
      );
    }
  }
}
console.log(fails ? `\n${fails} pair(s) unresolved` : "\nevery epoch pair resolves");
