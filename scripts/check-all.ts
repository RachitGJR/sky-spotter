/**
 * Runs the checks that need no network, in the order that fails fastest.
 * `bun run check:live` covers the rest, which reads the archive and JPL.
 */
const LOCAL = ["check-astro.ts", "check-locator.mjs", "check-fit.ts"];

const failed: string[] = [];
for (const name of LOCAL) {
  console.log(`\n${"=".repeat(64)}\n${name}\n${"=".repeat(64)}`);
  const proc = Bun.spawn(["bun", "run", `scripts/${name}`], { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) failed.push(name);
}

console.log(`\n${"=".repeat(64)}`);
if (failed.length) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log("local checks passed");
