/**
 * The tap-to-cycle stepping that keeps a finger from having to find a small ring
 * twice. Pure list logic, so it is worth pinning down: a field of bodies has to
 * wrap in both directions, and a single-body field must never offer a next.
 */
import { nextMoverId } from "../src/lib/spherex/movers";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const eq = (got: string | null, want: string | null) => got === want;

const ids = ["a", "b", "c", "d"];
const bodies = ids.map((id) => ({ id }));

// Forward from nothing lands on the first body.
check(eq(nextMoverId(bodies, null, 1), "a"), "nothing selected, forwards → first body");
check(eq(nextMoverId(bodies, null, -1), "d"), "nothing selected, backwards → last body");

// Forward walks the list and wraps; backwards walks it the other way and wraps.
check(eq(nextMoverId(bodies, "a", 1), "b"), "a forwards → b");
check(eq(nextMoverId(bodies, "c", 1), "d"), "c forwards → d");
check(eq(nextMoverId(bodies, "d", 1), "a"), "d forwards wraps → a");
check(eq(nextMoverId(bodies, "b", -1), "a"), "b backwards → a");
check(eq(nextMoverId(bodies, "a", -1), "d"), "a backwards wraps → d");

// Default direction is forward, and a selection the caller no longer has (a body
// that failed to resolve) still lands somewhere sensible rather than on nothing.
check(eq(nextMoverId(bodies, "b"), "c"), "default direction is forwards");
check(eq(nextMoverId(bodies, "gone", 1), "a"), "stale selection → first body");
check(eq(nextMoverId(bodies, "gone", -1), "d"), "stale selection, backwards → last body");

// Nothing to cycle through.
check(eq(nextMoverId([], null, 1), null), "empty field offers nothing");
check(eq(nextMoverId([{ id: "solo" }], "solo", 1), "solo"), "single body stays on itself");

// A full lap must return to where it started, in both directions. Seeded on a
// body: the first step from "nothing selected" is picking one, not stepping.
for (const dir of [1, -1] as const) {
  let id: string | null = ids[0];
  for (let step = 0; step < ids.length; step++) id = nextMoverId(bodies, id, dir);
  check(eq(id, ids[0]), `a full lap ${dir > 0 ? "forwards" : "backwards"} returns to the start`);
}

console.log(failures === 0 ? "\nmover checks passed" : `\n${failures} mover checks FAILED`);
process.exit(failures === 0 ? 0 : 1);