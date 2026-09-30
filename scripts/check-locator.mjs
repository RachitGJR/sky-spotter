// The locator is only worth showing if the projection is right. Check the
// landmarks: the centre of the map, the four quadrant points on the equator, the
// poles, and where the four manifest fields land.
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/sky/Workbench.tsx", "utf8");
const body = src
  .match(/function mollweide\([\s\S]*?\n\}/)[0]
  .replace(/\s*:\s*number/g, "")
  .replace(/\)\s*:\s*\{/, ") {");
const MW = src.match(/const MW_RX = (\d+);\nconst MW_RY = MW_RX \/ 2;/);
const MW_RX = Number(MW[1]);
const MW_RY = MW_RX / 2;
const fn = new Function("MW_RX", "MW_RY", `${body}; return mollweide;`)(MW_RX, MW_RY);

const cases = [
  { ra: 0, dec: 0, want: "map centre" },
  { ra: 90, dec: 0, want: "equator, +λ quarter" },
  { ra: 180, dec: 0, want: "equator, seam" },
  { ra: 270, dec: 0, want: "equator, -λ quarter" },
  { ra: 0, dec: 90, want: "north pole, top of the ellipse" },
  { ra: 0, dec: -90, want: "south pole, bottom" },
  { ra: 0, dec: 45, want: "halfway up" },
];

for (const c of cases) {
  const p = fn(c.ra, c.dec);
  console.log(
    `ra=${String(c.ra).padStart(3)} dec=${String(c.dec).padStart(3)}  x=${p.x.toFixed(2).padStart(6)} y=${p.y.toFixed(2).padStart(6)}   ${c.want}`,
  );
}

console.log(`\noutline ellipse: rx=${MW_RX} ry=${MW_RY}  (x 1..99, y ${50 - MW_RY}..${50 + MW_RY})\n`);

// Area check: a Mollweide map preserves area, so a patch of the sky at high
// declination must land near the top edge, not squeezed toward the centre.
console.log("fields:");
const fields = readFileSync("src/lib/spherex/fields.ts", "utf8");
const starts = [...fields.matchAll(/^    id: "([\w-]+)",$/gm)];
for (let i = 0; i < starts.length; i++) {
  const chunk = fields.slice(starts[i].index, starts[i + 1]?.index ?? fields.length);
  const ra = Number(chunk.match(/ra: ([\d.]+)/)[1]);
  const dec = Number(chunk.match(/dec: (-?[\d.]+)/)[1]);
  const p = fn(ra, dec);
  const inside = p.x > 0 && p.x < 100 && p.y > 0 && p.y < 100;
  console.log(
    `  ${starts[i][1].padEnd(12)} ra=${ra.toFixed(2)} dec=${dec.toFixed(2)}  x=${p.x.toFixed(1).padStart(5)} y=${p.y.toFixed(1).padStart(5)}  ${inside ? "on the map" : "OFF THE MAP"}`,
  );
}
