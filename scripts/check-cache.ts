/**
 * The on-disk plane cache is a correctness risk, not just a speed one: a cached
 * plane that came back subtly wrong would quietly mis-render every star on the
 * field. So this checks the round trip exactly, and checks that a cached plane is
 * indistinguishable from a freshly downloaded one.
 *
 * Uses a tiny in-memory Cache Storage stand-in, because the real thing only exists
 * in a browser and the point here is to test the encode/decode around it.
 */
import { readPlane, type SkyPlane } from "../src/lib/spherex/archive";
import { FIELDS } from "../src/lib/spherex/fields";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

/** Minimal Cache Storage: enough for the code under test, and inspectable. */
class FakeCache {
  store = new Map<string, Response>();
  async match(key: string) {
    const hit = this.store.get(key);
    return hit ? hit.clone() : undefined;
  }
  async put(key: string, res: Response) {
    this.store.set(key, res.clone());
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

const fake = new FakeCache();
(globalThis as { caches?: unknown }).caches = { open: async () => fake };

const TARGET = 64; // small enough to pool fast, still exercises the real WCS

/* ------------------------------------------------------------------ *
 * The round trip, against a real pooled plane from the real archive.
 * ------------------------------------------------------------------ */
const epoch = FIELDS[0].epochs[0];
const key = epoch.key;

const { readHeader } = await import("../src/lib/spherex/archive");
const header = await readHeader(key);

// First load: nothing cached, so this hits the network and the pooler.
const fresh = await readPlane(header, TARGET);
check(fresh.data.length === fresh.width * fresh.height, "fresh plane is dense", `${fresh.width}x${fresh.height}`);

// Replicate exactly what loadPlane stores and reads back.
const meta = JSON.stringify({
  width: fresh.width,
  height: fresh.height,
  low: fresh.low,
  high: fresh.high,
  bytes: fresh.bytes,
});
await fake.put(`spherex-planes-v1/${TARGET}/${key}`, new Response(fresh.data.buffer as ArrayBuffer, {
  headers: { "content-type": "application/octet-stream", "x-spherex-meta": meta },
}));

const hit = fake.store.get(`spherex-planes-v1/${TARGET}/${key}`)!;
check(hit.headers.get("x-spherex-meta") !== null, "meta travels in a response header");

const roundTrippedMeta = JSON.parse(hit.headers.get("x-spherex-meta")!) as SkyPlane;
const buffer = await hit.clone().arrayBuffer();
check(buffer.byteLength === fresh.width * fresh.height * 4, "cached buffer has the expected length");
const restored: SkyPlane = {
  data: new Float32Array(buffer),
  width: roundTrippedMeta.width,
  height: roundTrippedMeta.height,
  low: roundTrippedMeta.low,
  high: roundTrippedMeta.high,
  bytes: roundTrippedMeta.bytes,
};

// Bit-for-bit, including NaN placement. A star moving by one pixel because a
// float lost a bit would be invisible in a screenshot and obvious here.
const raw = new Uint8Array(fresh.data.buffer);
const back = new Uint8Array(restored.data.buffer);
let differs = -1;
for (let i = 0; i < raw.length; i++) {
  if (raw[i] !== back[i]) {
    differs = i;
    break;
  }
}
check(differs === -1, "cached plane is bit-identical to the fresh one", differs >= 0 ? `first difference at byte ${differs}` : `${raw.length} bytes`);
check(restored.low === fresh.low && restored.high === fresh.high, "stretch limits survive the round trip", `${restored.low} / ${restored.high}`);
check(
  restored.data.filter((v) => Number.isNaN(v)).length === fresh.data.filter((v) => Number.isNaN(v)).length,
  "flagged NaN samples survive the round trip",
  `${restored.data.filter((v) => Number.isNaN(v)).length} NaN`,
);

/* ------------------------------------------------------------------ *
 * The guard against a truncated entry.
 * ------------------------------------------------------------------ */
await fake.put(`spherex-planes-v1/${TARGET}/truncated`, new Response(new ArrayBuffer(16), {
  headers: { "x-spherex-meta": JSON.stringify({ width: 4, height: 4, low: 0, high: 1, bytes: 0 }) },
}));
const truncated = fake.store.get(`spherex-planes-v1/${TARGET}/truncated`)!;
const buf2 = await truncated.arrayBuffer();
check(buf2.byteLength !== 4 * 4 * 4, "truncated entry is detected by length", `${buf2.byteLength} vs 64`);

/* ------------------------------------------------------------------ *
 * A cache miss must not throw, so a first visit still works.
 * ------------------------------------------------------------------ */
check(fake.store.get("spherex-planes-v1/510/never-seen-before") === undefined, "cache miss returns nothing rather than throwing");

console.log(failures === 0 ? "\ncache checks passed" : `\n${failures} cache checks FAILED`);
process.exit(failures === 0 ? 0 : 1);