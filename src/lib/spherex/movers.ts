import { positionAngle, separation, type SkyPoint } from "./astro";

/** A real solar-system body tracked across the two SPHEREx survey epochs. */
export type Mover = {
  id: string;
  designation: string;
  name: string;
  class: string | null;
  diameterKm?: number;
  absoluteMagnitude?: number;
  albedo?: number;
  epoch1: SkyPoint & { distanceAu: number };
  epoch2: SkyPoint & { distanceAu: number };
};

export type MoverMotion = {
  separationDeg: number;
  /** Degrees of sky covered per day. */
  rateDegPerDay: number;
  /** Direction of travel, degrees east of north. */
  positionAngle: number;
  /** Closing or opening rate implied by the real distance change, km/s. */
  rangeRateKmS: number;
};

export function motionOf(mover: Mover, baselineDays: number): MoverMotion {
  const separationDeg = separation(mover.epoch1, mover.epoch2);
  const kmPerAu = 149_597_870.7;
  return {
    separationDeg,
    rateDegPerDay: separationDeg / Math.max(1, baselineDays),
    positionAngle: positionAngle(mover.epoch1, mover.epoch2),
    rangeRateKmS:
      (Math.abs(mover.epoch2.distanceAu - mover.epoch1.distanceAu) * kmPerAu) /
      (baselineDays * 86_400),
  };
}

/**
 * Apparent visual magnitude from the body's real absolute magnitude and its real
 * distance at that epoch. Phase geometry is ignored, which costs a few tenths of
 * a magnitude for most of the bodies a citizen will meet here.
 */
export function apparentMagnitude(mover: Mover, epoch: 1 | 2) {
  const h = mover.absoluteMagnitude;
  if (h === undefined) return null;
  const delta = epoch === 1 ? mover.epoch1.distanceAu : mover.epoch2.distanceAu;
  return h + 5 * Math.log10(Math.max(1e-6, delta * delta));
}
