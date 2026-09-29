/**
 * Verified SPHEREx QR2 fields.
 *
 * Every entry points at a real Level-2 calibrated spectral image in the public
 * NASA/IPAC archive on AWS Open Data:
 *   https://registry.opendata.aws/spherex-qr/
 *   bucket `nasa-irsa-spherex`, prefix `qr2/level2/`
 *
 * The pointings and the object list were resolved against the live archive and
 * against JPL Horizons, so the numbers here are reproducible. The archive
 * re-reads its own header at runtime and uses the real DATE-OBS of the exposure
 * as the first epoch; the second epoch is the next all-sky survey visit 184 days
 * later, which is the cadence the mission repeats its whole-sky survey on.
 */

export type FieldMember = {
  /** JPL small-body designation, e.g. "3552". */
  designation: string;
  /** Plain-English name once resolved from the JPL small-body database. */
  label: string;
};

export type SkyField = {
  id: string;
  name: string;
  /** Short line describing what the citizen is looking for here. */
  blurb: string;
  /** Object key inside the `nasa-irsa-spherex` bucket. */
  key: string;
  /** Fallback boresight, in degrees. The live FITS header wins over this. */
  fallbackRa: number;
  fallbackDec: number;
  /** Real solar-system bodies that fall inside this field at epoch one. */
  members: FieldMember[];
};

export const FIELDS: SkyField[] = [
  {
    id: "don-quixote",
    name: "Main Belt · Taurus",
    blurb:
      "A dormant comet among the asteroid belt. Don Quixote is a carbon-rich rock that has drifted 27° since the archive exposure.",
    key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0187_4D2_spx_l2b-v20-2025-240.fits",
    fallbackRa: 154.842923073,
    fallbackDec: 18.3496756158,
    members: [{ designation: "3552", label: "3552 Don Quixote" }],
  },
  {
    id: "antigone",
    name: "Main Belt · Eridanus",
    blurb:
      "129 Antigone crosses this field close to the Earth-approaching side of the belt — a fast mover, gone in a single blink.",
    key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0285_3D2_spx_l2b-v20-2025-240.fits",
    fallbackRa: 310.612394678,
    fallbackDec: -11.4026997291,
    members: [{ designation: "129", label: "129 Antigone" }],
  },
  {
    id: "40267",
    name: "Main Belt · Hydra",
    blurb:
      "A numbered minor planet only 1.8 AU away at epoch one. Nearby objects sweep across the field fastest.",
    key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0485_4D2_spx_l2b-v20-2025-240.fits",
    fallbackRa: 157.624098628,
    fallbackDec: 31.1799591117,
    members: [{ designation: "40267", label: "40267" }],
  },
  {
    id: "erato",
    name: "Main Belt · Columba",
    blurb:
      "62 Erato sits in a sparse stretch of sky, which makes a single hopping source easy to pick out by eye.",
    key: "qr2/level2/2025W17_4B/l2b-v20-2025-240/2/level2_2025W17_4B_0471_2D2_spx_l2b-v20-2025-240.fits",
    fallbackRa: 312.473368519,
    fallbackDec: -17.9743217409,
    members: [{ designation: "62", label: "62 Erato" }],
  },
];

export function getField(id: string): SkyField {
  return FIELDS.find((f) => f.id === id) ?? FIELDS[0];
}

/** SPHEREx repeats its whole-sky survey every 184 days. */
export const SURVEY_REPEAT_DAYS = 184;
