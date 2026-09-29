/**
 * Reader for SPHEREx Quick Release Level-2 calibrated spectral images held in
 * the public NASA/IPAC archive on AWS Open Data.
 *
 * The bucket allows anonymous range requests and sends `Access-Control-Allow-Origin: *`,
 * so the browser reads exactly the byte ranges it needs instead of downloading
 * a 70 MB FITS file:
 *
 *   1. the IMAGE header, to learn the real pointing, DATE-OBS and WCS;
 *   2. the 2040 x 2040 float32 image plane, boxed down to a few hundred pixels.
 */

import type { SkyField } from "./fields";

const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;

export type SpherexHeader = {
  key: string;
  obsid: string;
  dateObs: string;
  ra: number;
  dec: number;
  crpix1: number;
  crpix2: number;
  /** Linear transform from standard coordinates (deg) to pixel offsets. */
  cd: [number, number, number, number];
  naxis1: number;
  naxis2: number;
  dataOffset: number;
  /** Degrees per pixel. */
  plateScale: number;
  psfFwhmArcsec: number;
  unit: string;
};

export type SkyPlane = {
  /** Box-averaged, display-ready samples, row-major, MJy/sr. */
  data: Float32Array;
  width: number;
  height: number;
  /** Robust low/high used for the asinh stretch. */
  low: number;
  high: number;
  bytes: number;
};

async function range(key: string, start: number, end: number, signal?: AbortSignal) {
  const res = await fetch(BUCKET + key, {
    headers: { Range: `bytes=${start}-${end}` },
    signal,
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`SPHEREx archive returned ${res.status} for ${key}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function parseCards(buf: Uint8Array, from: number) {
  const text = new TextDecoder();
  const map: Record<string, string> = {};
  for (let i = from; i + 80 <= buf.length; i += 80) {
    const card = text.decode(buf.subarray(i, i + 80));
    const key = card.slice(0, 8).trim();
    if (key === "END") return { map, end: i + 80 };
    if (!key) continue;
    let value = card.slice(10);
    const slash = value.indexOf("/");
    if (slash >= 0) value = value.slice(0, slash);
    map[key] = value.trim().replace(/^'(.*)'$/, "$1").trim();
  }
  return { map, end: -1 };
}

export async function readHeader(field: SkyField, signal?: AbortSignal): Promise<SpherexHeader> {
  const bytes = await range(field.key, 0, BLOCK * 102 - 1, signal);
  for (let block = 0; block * BLOCK + 80 <= bytes.length; block++) {
    const { map, end } = parseCards(bytes, block * BLOCK);
    if (end < 0) continue;
    if (map.EXTNAME?.trim() !== "IMAGE" || !map.CRVAL1) continue;

    const cdelt1 = Number(map.CDELT1 ?? 1);
    const cdelt2 = Number(map.CDELT2 ?? 1);
    const p11 = Number(map.PC1_1 ?? 1);
    const p12 = Number(map.PC1_2 ?? 0);
    const p21 = Number(map.PC2_1 ?? 0);
    const p22 = Number(map.PC2_2 ?? 1);

    return {
      key: field.key,
      obsid: map.OBSID ?? "unknown",
      dateObs: map["DATE-OBS"] ?? map["DATE-BEG"] ?? new Date().toISOString(),
      ra: Number(map.CRVAL1),
      dec: Number(map.CRVAL2),
      crpix1: Number(map.CRPIX1),
      crpix2: Number(map.CRPIX2),
      cd: [p11 * cdelt1, p12 * cdelt1, p21 * cdelt2, p22 * cdelt2],
      naxis1: Number(map.NAXIS1),
      naxis2: Number(map.NAXIS2),
      dataOffset: Math.ceil(end / BLOCK) * BLOCK,
      plateScale: Math.hypot(p11, p21) * cdelt1,
      psfFwhmArcsec: Number(map.PSF_FWHM ?? 0),
      unit: (map.BUNIT ?? "MJy / sr").replace(/'/g, ""),
    };
  }
  throw new Error("No IMAGE extension found in the SPHEREx product.");
}

/** Reads the calibrated image plane and boxes it down to roughly `target` pixels. */
export async function readPlane(
  header: SpherexHeader,
  target = 510,
  signal?: AbortSignal,
): Promise<SkyPlane> {
  const { naxis1, naxis2, dataOffset } = header;
  const bytesPerPlane = naxis1 * naxis2 * 4;
  const raw = await range(header.key, dataOffset, dataOffset + bytesPerPlane - 1, signal);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

  const factor = Math.max(1, Math.round(naxis1 / target));
  const width = Math.floor(naxis1 / factor);
  const height = Math.floor(naxis2 / factor);
  const data = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let sy = 0; sy < factor; sy++) {
        const row = (y * factor + sy) * naxis1 + x * factor;
        for (let sx = 0; sx < factor; sx++) {
          const v = view.getFloat32((row + sx) * 4, false); // FITS is big-endian
          if (Number.isFinite(v)) {
            sum += v;
            n++;
          }
        }
      }
      data[y * width + x] = n ? sum / n : Number.NaN;
    }
  }

  // Robust stretch limits: ignore the (many) NaN and negative pixels that mark
  // flagged data, then clip at the 0.2 and 99.8 percentiles.
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const v = data[i];
    if (Number.isFinite(v) && v > 0) sample.push(v);
  }
  sample.sort((a, b) => a - b);
  const q = (p: number) =>
    sample.length ? sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] : 1;
  const low = q(0.02);
  const high = q(0.998);

  return { data, width, height, low, high, bytes: raw.byteLength };
}
