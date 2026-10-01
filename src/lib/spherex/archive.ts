/**
 * Reader for SPHEREx Quick Release Level-2 calibrated spectral images held in
 * the public NASA/IPAC archive on AWS Open Data.
 *
 * The bucket allows anonymous range requests and sends `Access-Control-Allow-Origin: *`,
 * so the browser reads exactly the byte ranges it needs instead of downloading
 * a 70 MB FITS file:
 *
 *   1. the IMAGE header, to learn the real pointing, DATE-OBS and WCS;
 *   2. the 2040 x 2040 float32 image plane, max-pooled down to a few hundred pixels.
 *
 * Both steps are cached by object key, so switching between the epochs of a field,
 * or coming back to one you already looked at, costs nothing.
 */

const BUCKET = "https://nasa-irsa-spherex.s3.amazonaws.com/";
const BLOCK = 2880;
/** Big enough for the 168-card IMAGE header plus the primary, with room to spare. */
const HEADER_BYTES = BLOCK * 24;

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
  /** Max-pooled, display-ready samples, row-major, MJy/sr. */
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
    throw new Error(`SPHEREx archive returned ${res.status} for ${key.split("/").pop()}`);
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

export async function readHeader(key: string, signal?: AbortSignal): Promise<SpherexHeader> {
  const bytes = await range(key, 0, HEADER_BYTES - 1, signal);
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
      key,
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
      // The linear scale of the WCS is the square root of |det(PC)|, not a row norm:
      // hypot(PC1_1, PC2_1) reads ~10% high on a rolled pointing and quietly shrinks
      // the field the viewer thinks it is allowed to show.
      plateScale: Math.sqrt(Math.abs(p11 * p22 - p12 * p21)) * cdelt1,
      psfFwhmArcsec: Number(map.PSF_FWHM ?? 0),
      unit: (map.BUNIT ?? "MJy / sr").replace(/'/g, ""),
    };
  }
  throw new Error("No IMAGE extension found in the SPHEREx product.");
}

/** Reads the calibrated image plane and max-pools it down to roughly `target` pixels. */
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

  // Max-pooling, not averaging. At ~5.6 arcsec per pixel the PSF is under one
  // pixel wide, so a 4x4 box mean would smear every star's flux across sixteen
  // pixels and leave the field looking empty. Taking the brightest sample in each
  // block is what survey images do when the point sources are the point.
  //
  // Reading the samples through the DataView rather than byte-swapping the whole
  // plane first is deliberate: a byte-swapped copy plus a Uint32Array scan benchmarks
  // at roughly twice this on a warm JIT (see scripts/bench-pool.ts), and this loop
  // is already only single-digit milliseconds.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let peak = Number.NEGATIVE_INFINITY;
      for (let sy = 0; sy < factor; sy++) {
        const row = (y * factor + sy) * naxis1 + x * factor;
        for (let sx = 0; sx < factor; sx++) {
          const v = view.getFloat32((row + sx) * 4, false); // FITS is big-endian
          if (Number.isFinite(v) && v > peak) peak = v;
        }
      }
      data[y * width + x] = Number.isFinite(peak) ? peak : Number.NaN;
    }
  }

  // Robust stretch limits: ignore the flagged NaN and negative pixels, then clip
  // just below the faintest real star and just below the brightest few hot pixels.
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const v = data[i];
    if (Number.isFinite(v) && v > 0) sample.push(v);
  }
  sample.sort((a, b) => a - b);
  const q = (p: number) =>
    sample.length ? sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] : 1;
  const low = q(0.05);
  const high = q(0.995);

  return { data, width, height, low, high, bytes: raw.byteLength };
}

  /* ------------------------------------------------------------------ *
 * Detector geometry.
 *
 * The exposures are square, 3.48° on a side, and rolled by the spacecraft attitude
 * — about 22° for these pointings. A square of that size seen through a gnomonic
 * projection is a rotated square, so it does not fill a wide canvas edge to edge:
 * fitting the 3.48° side leaves half the viewport looking like empty black, which
 * is exactly what a citizen reads as "the map is broken". Fitting the rotated
 * bounding box instead puts the whole footprint on screen.
 * ------------------------------------------------------------------ */

export type DetectorGeometry = {
  /** Side of the square footprint, degrees. */
  sideDeg: number;
  /** Width and height of the footprint's axis-aligned bounding box, degrees. */
  bboxDeg: number;
};

export function detectorGeometry(header: SpherexHeader): DetectorGeometry {
  const [c11, c12, c21, c22] = header.cd;
  const scale = Math.sqrt(Math.abs(c11 * c22 - c12 * c21));
  const sideDeg = header.naxis1 * scale;
  // Direction of the detector's own RA axis in the tangent plane.
  const theta = Math.atan2(c21, c11);
  const reach = Math.abs(Math.cos(theta)) + Math.abs(Math.sin(theta));
  return { sideDeg, bboxDeg: sideDeg * reach };
}

/**
 * The vertical field of view that shows the whole footprint in a viewport of the
 * given aspect ratio. The footprint's bounding box is square, so a viewport needs
 * its short side to be at least the box: on a wide window that is the height.
 * This is both the default view and the zoom-out limit, because past it the only
 * thing on screen is empty canvas.
 */
export function fitFovDeg(header: SpherexHeader, aspect: number) {
  const { bboxDeg } = detectorGeometry(header);
  return aspect >= 1 ? bboxDeg : bboxDeg / aspect;
}

/* ------------------------------------------------------------------ *
 * Caching, in two layers.
 *
 * In memory: a field has four epochs and the citizen flips between them
 * constantly, so a decoded 510x510 plane is worth keeping.
 *
 * On disk: the same plane, in Cache Storage. Pulling one exposure costs about
 * 17 MB and roughly seven seconds, and the citizen only ever sees the pooled
 * 510x510 result, which is about 1 MB. Storing that instead means coming back
 * to a field they already looked at skips the download *and* the pooling, which
 * is the difference between a few hundred milliseconds and seven seconds each.
 * ------------------------------------------------------------------ */

const CACHE_NAME = "spherex-planes-v1";

const headerCache = new Map<string, SpherexHeader>();
const headerPending = new Map<string, Promise<SpherexHeader>>();
const planeCache = new Map<string, Promise<SkyPlane>>();

/**
 * Cache Storage is unavailable outside a browser (in the check scripts, and in
 * any SSR), and a full disk quota must never break the viewer, so every path
 * through here is best-effort.
 */
function diskCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return Promise.resolve(null);
  return caches
    .open(CACHE_NAME)
    .catch(() => null);
}

/**
 * The FITS header is small and never changes for a given object, so it rides in
 * the same on-disk cache. It gates the plane fetch, which is the slow part, so
 * skipping it turns a cold field into a plane-only load.
 */
async function readCachedHeader(key: string): Promise<SpherexHeader | null> {
  const cache = await diskCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(`${CACHE_NAME}/header/${key}`);
    if (!hit) return null;
    return (await hit.json()) as SpherexHeader;
  } catch {
    return null;
  }
}

async function writeCachedHeader(key: string, header: SpherexHeader): Promise<void> {
  const cache = await diskCache();
  if (!cache) return;
  try {
    await cache.put(
      `${CACHE_NAME}/header/${key}`,
      new Response(JSON.stringify(header), {
        headers: { "content-type": "application/json" },
      }),
    );
  } catch {
    // A full quota just means the next visit re-reads the header.
  }
}

/** The pooled plane, stored as a plain ArrayBuffer so it round-trips exactly. */
async function readCachedPlane(key: string, target: number): Promise<SkyPlane | null> {
  const cache = await diskCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(`${CACHE_NAME}/${target}/${key}`);
    if (!hit) return null;
    const meta = hit.headers.get("x-spherex-meta");
    if (!meta) return null;
    const { width, height, low, high, bytes } = JSON.parse(meta) as {
      width: number;
      height: number;
      low: number;
      high: number;
      bytes: number;
    };
    const buffer = await hit.arrayBuffer();
    // Guard against a truncated or mismatched entry rather than building a plane
    // out of whatever happened to be in the buffer.
    if (buffer.byteLength !== width * height * 4) return null;
    return {
      data: new Float32Array(buffer),
      width,
      height,
      low,
      high,
      bytes,
    };
  } catch {
    return null;
  }
}

async function writeCachedPlane(
  key: string,
  target: number,
  plane: SkyPlane,
): Promise<void> {
  const cache = await diskCache();
  if (!cache) return;
  try {
    const meta = JSON.stringify({
      width: plane.width,
      height: plane.height,
      low: plane.low,
      high: plane.high,
      bytes: plane.bytes,
    });
    await cache.put(
      `${CACHE_NAME}/${target}/${key}`,
      new Response(plane.data.buffer as ArrayBuffer, {
        headers: {
          "content-type": "application/octet-stream",
          "x-spherex-meta": meta,
        },
      }),
    );
  } catch {
    // A full quota just means the next visit downloads again.
  }
}

export function loadHeader(key: string, signal?: AbortSignal): Promise<SpherexHeader> {
  const hit = headerCache.get(key);
  if (hit) return Promise.resolve(hit);
  const inFlight = headerPending.get(key);
  if (inFlight) return inFlight;
  const pending = readCachedHeader(key)
    .then((cached) => cached ?? readHeader(key, signal))
    .then((h) => {
      headerCache.set(key, h);
      void writeCachedHeader(key, h);
      return h;
    })
    .finally(() => headerPending.delete(key));
  headerPending.set(key, pending);
  return pending;
}

export function loadPlane(
  header: SpherexHeader,
  target = 510,
  signal?: AbortSignal,
): Promise<SkyPlane> {
  const id = `${header.key}@${target}`;
  let hit = planeCache.get(id);
  if (!hit) {
    // Disk first: a pooled plane that survives a reload is worth far more than
    // the in-memory copy, which dies with the tab. An aborted load still falls
    // through to the network rather than throwing.
    hit = readCachedPlane(header.key, target)
      .then((cached) => cached ?? readPlane(header, target, signal))
      .then((plane) => {
        if (!planeCache.has(id)) void writeCachedPlane(header.key, target, plane);
        return plane;
      });
    planeCache.set(id, hit);
    hit.catch(() => planeCache.delete(id));
  }
  return hit;
}

/** Empties the on-disk plane cache. Exposed so the viewer can offer a clean slate. */
export async function clearPlaneDiskCache(): Promise<void> {
  const cache = await diskCache();
  if (!cache) return;
  try {
    await cache.delete(CACHE_NAME);
  } catch {
    // Nothing to clear.
  }
}
