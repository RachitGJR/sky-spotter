"use node";

/**
 * Near-Earth Object Web Service feed, fetched server-side.
 *
 * The key is read from `process.env.NASA_API_KEY` so it never reaches the
 * browser bundle. Without a key the service still answers on NASA's anonymous
 * `DEMO_KEY` tier, which is heavily rate limited — the response says which tier
 * answered so the UI can be honest about it.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";

const NEOWS = "https://api.nasa.gov/neo/rest/v1/feed";

export type NeoRow = {
  name: string;
  hazardous: boolean;
  diameterKm: number | null;
  velocityKph: number | null;
  missDistanceKm: number | null;
  approachDate: string | null;
};

type Cache = { fetchedAt: number; days: number; rows: NeoRow[]; tier: "key" | "demo"; latencyMs: number };
let cache: Cache | null = null;

const TTL_MS = 10 * 60 * 1000;

export const getNeoFeed = action({
  args: { days: v.optional(v.number()) },
  handler: async (_ctx, args) => {
    const days = Math.min(7, Math.max(1, Math.round(args.days ?? 7)));
    if (cache && cache.days === days && Date.now() - cache.fetchedAt < TTL_MS) {
      return { ...cache, stale: false };
    }

    const apiKey = process.env.NASA_API_KEY?.trim();
    const key = apiKey && apiKey.length > 0 ? apiKey : "DEMO_KEY";
    const today = new Date();
    const end = new Date(today.getTime() + days * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${NEOWS}?start_date=${fmt(today)}&end_date=${fmt(end)}&api_key=${encodeURIComponent(key)}`;

    const started = Date.now();
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        fetchedAt: Date.now(),
        days,
        rows: [] as NeoRow[],
        tier: (apiKey ? "key" : "demo") as "key" | "demo",
        latencyMs: Date.now() - started,
        stale: false,
        error: `NeoWs answered ${res.status}${res.status === 429 ? " — rate limited" : ""}: ${body.slice(0, 160)}`,
      };
    }

    const json = (await res.json()) as {
      near_earth_objects?: unknown;
    };

    // Depending on the key's tier the feed comes back either as a flat array or
    // as an object keyed by approach date. Accept both, and the same for the
    // numbers, which arrive as strings on some tiers.
    type RawNeo = {
      name: string;
      is_potentially_hazardous_asteroid: boolean;
      estimated_diameter?: { kilometers?: { estimated_diameter_min?: number | string; estimated_diameter_max?: number | string } };
      close_approach_data?: {
        close_approach_date_full?: string;
        relative_velocity?: { kilometers_per_hour?: number | string };
        miss_distance?: { kilometers?: number | string };
      }[];
    };

    const bucket = json.near_earth_objects;
    const list: RawNeo[] = Array.isArray(bucket)
      ? bucket
      : bucket && typeof bucket === "object"
        ? Object.values(bucket as Record<string, RawNeo[]>).flat()
        : [];

    const num = (v: number | string | undefined) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const rows: NeoRow[] = list
      .map((n) => {
        const d = n.estimated_diameter?.kilometers;
        const approach = n.close_approach_data?.[0];
        const lo = num(d?.estimated_diameter_min);
        const hi = num(d?.estimated_diameter_max);
        return {
          name: String(n.name ?? "unnamed").replace(/[()]/g, ""),
          hazardous: Boolean(n.is_potentially_hazardous_asteroid),
          diameterKm: lo !== null && hi !== null ? (lo + hi) / 2 : lo ?? hi,
          velocityKph: num(approach?.relative_velocity?.kilometers_per_hour),
          missDistanceKm: num(approach?.miss_distance?.kilometers),
          approachDate: approach?.close_approach_date_full?.slice(0, 11) ?? null,
        };
      })
      .filter((r) => r.name !== "unnamed")
      .sort((a, b) => (a.missDistanceKm ?? Infinity) - (b.missDistanceKm ?? Infinity));

    cache = {
      fetchedAt: Date.now(),
      days,
      rows,
      tier: apiKey ? "key" : "demo",
      latencyMs: Date.now() - started,
    };
    return { ...cache, stale: false };
  },
});
