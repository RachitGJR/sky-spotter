/**
 * Public entry point for the blink comparator: hands back the real ephemerides
 * for a field's targets, reading the cache first and only asking JPL for the
 * bodies it has not seen at this epoch pair before.
 */

import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

// Two browser tabs (or a dev-mode double effect) can ask for the same epoch pair
// at the same moment and both decide the cache is cold. `.first()` rather than
// `.unique()` so a duplicated row can never turn into a hard failure.
export const moverRecord = query({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("moverEphemeris")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first(),
});

export const storeMover = internalMutation({
  args: {
    cacheKey: v.string(),
    designation: v.string(),
    name: v.optional(v.string()),
    class: v.optional(v.string()),
    diameterKm: v.optional(v.number()),
    absoluteMagnitude: v.optional(v.number()),
    albedo: v.optional(v.number()),
    epoch1Ra: v.number(),
    epoch1Dec: v.number(),
    epoch1DistanceAu: v.number(),
    epoch2Ra: v.number(),
    epoch2Dec: v.number(),
    epoch2DistanceAu: v.number(),
  },
  handler: async (ctx, args) => {
    // Idempotent write: the same body at the same epoch pair may be resolved by
    // two actions at once, and an ephemeris never changes, so writing twice is
    // a no-op rather than a second row.
    const existing = await ctx.db
      .query("moverEphemeris")
      .withIndex("by_key", (q) => q.eq("cacheKey", args.cacheKey))
      .first();
    const { cacheKey: _cacheKey, ...rest } = args;
    if (existing) {
      await ctx.db.patch(existing._id, rest);
      return null;
    }
    await ctx.db.insert("moverEphemeris", { ...args, source: "horizons" });
    return null;
  },
});

type Epoch = { ra: number; dec: number; distanceAu: number };
type Normalised = {
  designation: string;
  name?: string;
  class?: string;
  diameterKm?: number;
  absoluteMagnitude?: number;
  albedo?: number;
  epoch1: Epoch;
  epoch2: Epoch;
};

export const getMovers = action({
  args: {
    designations: v.array(v.string()),
    date1: v.string(),
    date2: v.string(),
  },
  handler: async (ctx, args) => {
    const movers = await Promise.all(
      args.designations.map(async (designation): Promise<Normalised | null> => {
        try {
          const cacheKey = `${designation}|${args.date1}|${args.date2}`;
          const cached = await ctx.runQuery(api.movers.moverRecord, { cacheKey });
          if (cached) {
            const { epoch1Ra, epoch1Dec, epoch1DistanceAu, epoch2Ra, epoch2Dec, epoch2DistanceAu, ...rest } = cached;
            return {
              ...rest,
              epoch1: { ra: epoch1Ra, dec: epoch1Dec, distanceAu: epoch1DistanceAu },
              epoch2: { ra: epoch2Ra, dec: epoch2Dec, distanceAu: epoch2DistanceAu },
            };
          }

          const resolved = await ctx.runAction(internal.sky.resolveMover, {
            designation,
            date1: args.date1,
            date2: args.date2,
          });
          if (!resolved) return null;

          await ctx.runMutation(internal.movers.storeMover, {
            cacheKey,
            designation,
            name: resolved.name,
            class: resolved.class,
            diameterKm: resolved.diameterKm,
            absoluteMagnitude: resolved.absoluteMagnitude,
            albedo: resolved.albedo,
            epoch1Ra: resolved.epoch1.ra,
            epoch1Dec: resolved.epoch1.dec,
            epoch1DistanceAu: resolved.epoch1.distanceAu,
            epoch2Ra: resolved.epoch2.ra,
            epoch2Dec: resolved.epoch2.dec,
            epoch2DistanceAu: resolved.epoch2.distanceAu,
          });
          return resolved;
        } catch {
          // JPL misses a body now and then. One body failing should cost that
          // body its ring on the canvas, not the whole field's astrometry.
          return null;
        }
      }),
    );
    return { epoch1: args.date1, epoch2: args.date2, movers };
  },
});
