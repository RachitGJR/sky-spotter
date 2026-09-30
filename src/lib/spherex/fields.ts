/**
 * Verified SPHEREx fields, each with four real survey epochs.
 *
 * Every epoch points at a real Level-2 calibrated exposure in the public NASA/IPAC
 * archive on AWS Open Data:
 *   https://registry.opendata.aws/spherex-qr/
 *   bucket `nasa-irsa-spherex`, prefix `qr2/level2/`
 *
 * The pointings below were found by scanning the archive's own S3 listing: for each
 * of the 129 published weeks, `scripts/scan-epochs.mjs` read one IMAGE header per
 * survey tile and kept the visit where each field fell inside the detector. For the
 * four fields here that happened at 4-7 visits each, spread across 2025 and 2026, and
 * `scripts/pick-epochs.mjs` then resolved the exact exposure and re-read its header.
 * The `offsetDeg` on each epoch is the measured separation between the exposure
 * boresight and the field centre, so the geometry in the app is not a guess.
 *
 * The same scan is why the epochs are spread over months rather than days: SPHEREx
 * re-observes a fixed sky position only when the survey comes back around, and
 * anything that moved between two visits is a real discovery, not an artefact.
 */

export type FieldMember = {
  /** JPL small-body designation, e.g. "3552". */
  designation: string;
  /** Plain-English name once resolved from the JPL small-body database. */
  label: string;
};

/** One real exposure of one field. */
export type SurveyEpoch = {
  id: string;
  /** SPHEREx visit id, e.g. "2025W47_2A". */
  visit: string;
  /** DATE-OBS of the exposure, YYYY-MM-DD. */
  date: string;
  /** Object key inside the `nasa-irsa-spherex` bucket. */
  key: string;
  /** Boresight from the live header, degrees. */
  ra: number;
  dec: number;
  /** Measured separation from the field centre, degrees. */
  offsetDeg: number;
};

export type SkyField = {
  id: string;
  name: string;
  /** Short line describing what the citizen is looking for here. */
  blurb: string;
  /** Epochs in chronological order. Always at least two. */
  epochs: SurveyEpoch[];
  /** Real solar-system bodies that fall inside this field. */
  members: FieldMember[];
};

export const FIELDS: SkyField[] = [
  {
    id: "don-quixote",
    name: "Main Belt · Taurus",
    blurb:
      "A dormant comet among the asteroid belt. Don Quixote is a carbon-rich rock that has drifted 27° since the archive exposure.",
    members: [{ designation: "3552", label: "3552 Don Quixote" }],
    epochs: [
      {
        id: "s1",
        visit: "2025W17_4B",
        date: "2025-04-25",
        key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0187_4D2_spx_l2b-v20-2025-240.fits",
        ra: 154.8429231,
        dec: 18.3496756,
        offsetDeg: 0,
      },
      {
        id: "s2",
        visit: "2025W18_1B",
        date: "2025-05-01",
        key: "qr2/level2/2025W18_1B/l2b-v20-2025-240/2/level2_2025W18_1B_0452_1D2_spx_l2b-v20-2025-240.fits",
        ra: 154.7735168,
        dec: 18.1641179,
        offsetDeg: 0.197,
      },
      {
        id: "s3",
        visit: "2025W47_2A",
        date: "2025-11-21",
        key: "qr2/level2/2025W47_2A/l2b-v20-2025-328/1/level2_2025W47_2A_0249_2D1_spx_l2b-v20-2025-328.fits",
        ra: 155.3087851,
        dec: 18.1455922,
        offsetDeg: 0.487,
      },
      {
        id: "s4",
        visit: "2026W19_2A",
        date: "2026-05-10",
        key: "qr2/level2/2026W19_2A/l2b-v24-2026-131/1/level2_2026W19_2A_1076_1D1_spx_l2b-v24-2026-131.fits",
        ra: 154.3010188,
        dec: 18.5403471,
        offsetDeg: 0.548,
      },
    ],
  },
  {
    id: "antigone",
    name: "Main Belt · Eridanus",
    blurb:
      "129 Antigone crosses this field close to the Earth-approaching side of the belt — a fast mover, gone in a single blink.",
    members: [{ designation: "129", label: "129 Antigone" }],
    epochs: [
      {
        id: "s1",
        visit: "2025W17_4B",
        date: "2025-04-26",
        key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0285_3D2_spx_l2b-v20-2025-240.fits",
        ra: 310.6123947,
        dec: -11.4026997,
        offsetDeg: 0,
      },
      {
        id: "s2",
        visit: "2025W18_1B",
        date: "2025-05-01",
        key: "qr2/level2/2025W18_1B/l2b-v20-2025-240/2/level2_2025W18_1B_0415_1D2_spx_l2b-v20-2025-240.fits",
        ra: 310.5027038,
        dec: -11.0240862,
        offsetDeg: 0.394,
      },
      {
        id: "s3",
        visit: "2025W42_2A",
        date: "2025-10-19",
        key: "qr2/level2/2025W42_2A/l2b-v20-2025-293/1/level2_2025W42_2A_0543_2D1_spx_l2b-v20-2025-293.fits",
        ra: 310.1381822,
        dec: -11.5298151,
        offsetDeg: 0.482,
      },
      {
        id: "s4",
        visit: "2026W18_2A",
        date: "2026-04-30",
        key: "qr2/level2/2026W18_2A/l2b-v24-2026-125/1/level2_2026W18_2A_0088_2D1_spx_l2b-v24-2026-125.fits",
        ra: 311.1535011,
        dec: -11.2810599,
        offsetDeg: 0.544,
      },
    ],
  },
  {
    id: "40267",
    name: "Main Belt · Hydra",
    blurb:
      "A numbered minor planet only 1.8 AU away at the first epoch. Nearby objects sweep across the field fastest.",
    members: [{ designation: "40267", label: "40267" }],
    epochs: [
      {
        id: "s1",
        visit: "2025W17_4B",
        date: "2025-04-27",
        key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0485_4D2_spx_l2b-v20-2025-240.fits",
        ra: 157.6240986,
        dec: 31.1799591,
        offsetDeg: 0,
      },
      {
        id: "s2",
        visit: "2025W19_1B",
        date: "2025-05-08",
        key: "qr2/level2/2025W19_1B/l2b-v20-2025-241/2/level2_2025W19_1B_0483_4D2_spx_l2b-v20-2025-241.fits",
        ra: 157.6254929,
        dec: 31.1788232,
        offsetDeg: 0.002,
      },
      {
        id: "s3",
        visit: "2025W47_1A",
        date: "2025-11-18",
        key: "qr2/level2/2025W47_1A/l2b-v20-2025-324/1/level2_2025W47_1A_0310_1D1_spx_l2b-v20-2025-324.fits",
        ra: 158.2139018,
        dec: 30.9055458,
        offsetDeg: 0.575,
      },
      {
        id: "s4",
        visit: "2026W18_2A",
        date: "2026-05-03",
        key: "qr2/level2/2026W18_2A/l2b-v24-2026-125/1/level2_2026W18_2A_0830_1D1_spx_l2b-v24-2026-125.fits",
        ra: 156.8357666,
        dec: 31.2114207,
        offsetDeg: 0.675,
      },
    ],
  },
  {
    id: "erato",
    name: "Main Belt · Columba",
    blurb:
      "62 Erato is the fast one here: between these two visits it walks about 5°, straight out of the detector. Watch the chevron at the edge, or switch on Follow and the view goes with it.",
    members: [{ designation: "62", label: "62 Erato" }],
    epochs: [
      {
        id: "s1",
        visit: "2025W17_4B",
        date: "2025-04-27",
        key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0471_2D2_spx_l2b-v20-2025-240.fits",
        ra: 312.4733685,
        dec: -17.9743217,
        offsetDeg: 0,
      },
      {
        id: "s2",
        visit: "2025W23_2B",
        date: "2025-06-06",
        key: "qr2/level2/2025W23_2B/l2b-v20-2025-251/2/level2_2025W23_2B_0167_4D2_spx_l2b-v20-2025-251.fits",
        ra: 312.4682389,
        dec: -17.9763807,
        offsetDeg: 0.005,
      },
      {
        id: "s3",
        visit: "2025W43_1A",
        date: "2025-10-21",
        key: "qr2/level2/2025W43_1A/l2b-v20-2025-299/1/level2_2025W43_1A_0293_2D1_spx_l2b-v20-2025-299.fits",
        ra: 312.0056089,
        dec: -18.081685,
        offsetDeg: 0.458,
      },
      {
        id: "s4",
        visit: "2026W18_2A",
        date: "2026-05-01",
        key: "qr2/level2/2026W18_2A/l2b-v24-2026-125/1/level2_2026W18_2A_0285_1D1_spx_l2b-v24-2026-125.fits",
        ra: 312.9510534,
        dec: -17.6511352,
        offsetDeg: 0.558,
      },
    ],
  },
];

export function getField(id: string): SkyField {
  return FIELDS.find((f) => f.id === id) ?? FIELDS[0];
}

/** Days between the two selected epochs, measured from their real DATE-OBS. */
export function baselineDays(field: SkyField, a: number, b: number) {
  const one = field.epochs[Math.min(a, field.epochs.length - 1)];
  const two = field.epochs[Math.min(b, field.epochs.length - 1)];
  return Math.max(
    1,
    Math.round((Date.parse(two.date) - Date.parse(one.date)) / 86_400_000),
  );
}
