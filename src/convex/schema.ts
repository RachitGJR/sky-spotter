import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Cached JPL Horizons + Small-Body Database results for the blink
    // comparator. An ephemeris is immutable once computed, so it is keyed by
    // body and epoch pair and only fetched once.
    moverEphemeris: defineTable({
      cacheKey: v.string(), // `${designation}|${date1}|${date2}`
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
      source: v.string(), // "horizons" | "offline"
    }).index("by_key", ["cacheKey"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
