/**
 * Worked examples: real bodies, real epoch pairs, real measured motion.
 *
 * These exist so a first-time citizen does not have to already know where to look.
 * Every number here was measured by asking JPL Horizons for the designation at the
 * two exposures' DATE-OBS values, and `scripts/check-examples.mjs` re-runs that
 * measurement on demand, so nothing in this file is a round number anyone hoped for.
 */

import { FIELDS, getField, type SkyField } from "./fields";

export type Example = {
  id: string;
  /** Which field to load. */
  fieldId: string;
  /** Index into that field's epoch list for the two exposures to compare. */
  a: number;
  b: number;
  /** Measured separation between the two positions, degrees. */
  sepDeg: number;
  /** Days between the two exposures. */
  days: number;
  /** One line on what the citizen is about to see, and why it is a good first look. */
  why: string;
};

export const EXAMPLES: Example[] = [
  {
    id: "don-quixote-6d",
    fieldId: "don-quixote",
    a: 0,
    b: 1,
    sepDeg: 0.366,
    days: 6,
    why: "Six days apart, and Don Quixote has already walked 22 arcminutes. The stars it left behind are still exactly where it left them.",
  },
  {
    id: "40267-11d",
    fieldId: "40267",
    a: 0,
    b: 1,
    sepDeg: 0.859,
    days: 11,
    why: "A faint numbered minor planet, 1.8 AU away. The longest jump on this list per day, so it separates from the stars fastest.",
  },
  {
    id: "antigone-5d",
    fieldId: "antigone",
    a: 0,
    b: 1,
    sepDeg: 1.492,
    days: 5,
    why: "Five days for a degree and a half. 129 Antigone is the easiest one here to catch by eye, and then it is gone from the field.",
  },
  {
    id: "erato-40d",
    fieldId: "erato",
    a: 0,
    b: 1,
    sepDeg: 4.769,
    days: 40,
    why: "The hard case: 62 Erato walks nearly five degrees and leaves the detector entirely. Follow it, and watch the chevron point off the edge.",
  },
  {
    id: "don-quixote-long",
    fieldId: "don-quixote",
    a: 0,
    b: 3,
    sepDeg: 26.146,
    days: 380,
    why: "A year later, the same rock is 25 degrees away in a completely different part of the sky. What you are comparing is not the same patch any more.",
  },
];

export function getExample(id: string): Example {
  return EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
}

export function exampleField(example: Example): SkyField {
  const field = getField(example.fieldId);
  if (!FIELDS.some((f) => f.id === example.fieldId)) {
    throw new Error(`example ${example.id} names a field that does not exist`);
  }
  return field;
}
