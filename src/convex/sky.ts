"use node";

/**
 * Live solar-system ephemerides for the blink comparator.
 *
 * Positions come from NASA/JPL Horizons (NASA/JPL's open planetary ephemeris
 * service, no key required) and physical parameters from the JPL Small-Body
 * Database. Convex actions cannot touch the database directly, so this file is
 * split into the usual three pieces: an internal action that talks to JPL, an
 * internal mutation that persists the result, and a public action that stitches
 * the cache and the fetch together.
 *
 * An ephemeris for a past epoch never changes, so a body is fetched once per
 * epoch pair and then served from the cache.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api";
const SBDB = "https://ssd-api.jpl.nasa.gov/sbdb.api";

type Epoch = { ra: number; dec: number; distanceAu: number };

type Ephemeris = {
  designation: string;
  name?: string;
  class?: string;
  diameterKm?: number;
  absoluteMagnitude?: number;
  albedo?: number;
  epoch1: Epoch;
  epoch2: Epoch;
};

/** Astrometric RA/Dec seen from Earth for one body across the two epochs. */
async function fetchEphemeris(
  designation: string,
  date1: string,
  date2: string,
): Promise<Ephemeris | null> {
  const days = Math.max(
    1,
    Math.round((new Date(date2).getTime() - new Date(date1).getTime()) / 86_400_000),
  );
  const params = new URLSearchParams({
    format: "text",
    COMMAND: `'${designation}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'",
    REF_PLANE: "'FRAME'",
    ANG_FORMAT: "'DEG'",
    QUANTITIES: "'1,20'",
    CSV_FORMAT: "'YES'",
    START_TIME: `'${date1}'`,
    STOP_TIME: `'${date2}'`,
    STEP_SIZE: `'${days} d'`,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${HORIZONS}?${params}`);
      const text = await res.text();
      const block = text.match(/\$\$SOE([\s\S]*?)\$\$EOE/);
      if (!block) return null;
      const rows = block[1]
        .trim()
        .split("\n")
        .map((line) => line.split(",").map((cell) => cell.trim()))
        .filter((cell) => cell.length > 5 && cell[3] !== "");
      if (rows.length < 2) return null;
      const last = rows[rows.length - 1];
      return {
        designation,
        epoch1: { ra: Number(rows[0][3]), dec: Number(rows[0][4]), distanceAu: Number(rows[0][5]) },
        epoch2: { ra: Number(last[3]), dec: Number(last[4]), distanceAu: Number(last[5]) },
      };
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

type Physical = {
  name?: string;
  class?: string;
  diameterKm?: number;
  absoluteMagnitude?: number;
  albedo?: number;
};

async function fetchPhysical(designation: string): Promise<Physical> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `${SBDB}?sstr=${encodeURIComponent(designation)}&phys-par=1`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const par = (name: string) => {
        const hit = (data.phys_par ?? []).find(
          (p: { name: string }) => String(p.name).toUpperCase() === name,
        );
        return hit?.value === undefined ? undefined : Number(hit.value);
      };
      return {
        name: data.object?.fullname ?? data.object?.shortname,
        class: data.object?.orbit_class?.name ?? data.object?.kind,
        diameterKm: par("diameter"),
        absoluteMagnitude: par("H"),
        albedo: par("albedo"),
      };
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return {};
}

export const resolveMover = internalAction({
  args: { designation: v.string(), date1: v.string(), date2: v.string() },
  handler: async (_ctx, args) => {
    const ephemeris = await fetchEphemeris(args.designation, args.date1, args.date2);
    if (!ephemeris) return null;
    const physical = await fetchPhysical(args.designation);
    return { ...ephemeris, ...physical };
  },
});
