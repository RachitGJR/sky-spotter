/**
 * Live check for the JPL Horizons path, exercised through the deployed Convex
 * action rather than Horizons directly.
 *
 * Going through the action is the point: the failure this guards against never
 * showed up in the Horizons response. Concurrent field loads duplicated cache
 * rows, and the next read died on `unique()`, so the canvas reported
 * "horizons · error" for a service that had answered perfectly. A check that
 * only called JPL directly would have stayed green the whole time.
 *
 * Needs VITE_CONVEX_URL (Bun loads .env.local automatically).
 */

import { FIELDS } from "../src/lib/spherex/fields";

const url = process.env.VITE_CONVEX_URL;
if (!url) {
  console.error("check-ephemeris: VITE_CONVEX_URL is not set — skipping");
  process.exit(0);
}

type Mover = {
  designation: string;
  name?: string;
  epoch1: { ra: number; dec: number; distanceAu: number };
  epoch2: { ra: number; dec: number; distanceAu: number };
};

const call = (designations: string[], date1: string, date2: string) =>
  fetch(`${url}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "movers:getMovers",
      args: { designations, date1, date2 },
      format: "json",
    }),
  })
    .then((r) => r.json())
    .then((body: { status: string; value?: { movers: (Mover | null)[] }; errorMessage?: string }) => {
      if (body.status !== "success") throw new Error(body.errorMessage ?? "unknown action error");
      return body.value!.movers;
    });

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const inRange = (e: Mover["epoch1"]) =>
  finite(e.ra) && finite(e.dec) && e.ra >= 0 && e.ra < 360 && e.dec >= -90 && e.dec <= 90 && finite(e.distanceAu);

/** Every field, first two visits — the pairs the UI actually opens with. */
for (const field of FIELDS) {
  const designations = field.members.map((m) => m.designation);
  const [a, b] = [field.epochs[0].date, field.epochs[1].date];

  let movers: (Mover | null)[];
  try {
    movers = await call(designations, a, b);
  } catch (e) {
    const first = (e as Error).message.split("\n")[1] ?? String(e);
    check(false, `${field.name} ${a} → ${b}`, `action threw: ${first.trim()}`);
    continue;
  }

  check(movers.length === designations.length, `${field.name} returns one entry per member`);
  const resolved = movers.filter((m): m is Mover => m !== null);
  check(
    resolved.length === designations.length,
    `${field.name} resolves every body`,
    `${resolved.length}/${designations.length}`,
  );

  for (const m of resolved) {
    const ok = inRange(m.epoch1) && inRange(m.epoch2);
    check(ok, `${field.name} ${m.designation} astrometry in range`, ok ? m.name ?? "" : JSON.stringify([m.epoch1, m.epoch2]));
  }
}

/**
 * The regression behind the reported error: several field loads arriving at the
 * same cache key at once. A failure here means the cache can still be corrupted
 * by a duplicate row.
 */
{
  const field = FIELDS[0];
  const designations = field.members.map((m) => m.designation);
  const [a, b] = [field.epochs[3].date, field.epochs[0].date];
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => call(designations, a, b)));
  const rejected = results.filter((r) => r.status === "rejected");
  check(rejected.length === 0, "5 concurrent loads of one cache key", `${rejected.length} failed`);
  if (rejected.length) {
    const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
    console.log(`      ${(reason.message.split("\n")[1] ?? reason.message).trim()}`);
  }
}

console.log(failures === 0 ? "\nephemeris checks passed" : `\n${failures} ephemeris checks FAILED`);
process.exit(failures === 0 ? 0 : 1);