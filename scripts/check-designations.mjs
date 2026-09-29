// Checks that the designations the app sends resolve against Horizons.
const DATES = { date1: "2025-04-27", date2: "2025-10-24" };
const days = Math.round((new Date(DATES.date2) - new Date(DATES.date1)) / 86400000);

for (const desig of ["3552", "129", "40267", "62"]) {
  const p = new URLSearchParams({
    format: "text",
    COMMAND: `'${desig}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    REF_PLANE: "'FRAME'",
    ANG_FORMAT: "'DEG'",
    QUANTITIES: "'1,20'",
    CSV_FORMAT: "'YES'",
    START_TIME: `'${DATES.date1}'`,
    STOP_TIME: `'${DATES.date2}'`,
    STEP_SIZE: `'${days} d'`,
  });
  const t = await (await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${p}`)).text();
  const m = t.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
  if (!m) {
    console.log(`${desig}: NO DATA — ${t.split("\n").filter(Boolean).slice(-1)[0]}`);
    continue;
  }
  const rows = m[1].trim().split("\n").map((l) => l.split(",").map((s) => s.trim()));
  console.log(`${desig}: ${rows.length} rows | ep1 ${rows[0][3]},${rows[0][4]} | ep2 ${rows[rows.length - 1][3]},${rows[rows.length - 1][4]}`);
}
