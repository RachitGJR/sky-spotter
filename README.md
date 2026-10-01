# SPHEREx Blink Comparator

Blink two real SPHEREx exposures of the same patch of sky and spot what moved.

Solar-system objects drift across the sky while stars stay put. Line up two
exposures of the same field taken weeks or months apart, flash between them, and
anything that walks is a body that was not in the catalogue for that field. This
is a citizen-science tool for doing exactly that, and for reading the astrometry
that comes with it.

Everything the viewer shows is real data, straight from the NASA/IPR archive.
There is no simulated sky anywhere in this project.

---

## Quick start

```bash
bun install
bun run dev          # Vite dev server
bun convex dev       # Convex functions (leave running)
```

The comparator is a single console mounted at every path, so there is nothing to
navigate to. Open the app and it opens on a field.

### Checks

```bash
bun run check        # offline: astro, locator, fit, pointing, movers
bun run check:live   # hits the real archive, JPL and the deployed Convex action
```

`bun run check` is the one to run before committing. `check:live` needs network
and, for the ephemeris half, a deployed Convex backend.

---

## How it works

### The data

| source | what for | key needed |
| --- | --- | --- |
| NASA/IPR SPHEREx archive on AWS Open Data | the sky itself | none |
| JPL Horizons | where the bodies were | none |
| JPL Small-Body Database | names, sizes, orbit classes | none |
| NASA NeoWs | recent NEO context for the logbook | `NASA_API_KEY` (optional) |

The FITS products are Quick Release Level-2 calibrated spectral images, published
weekly under `qr2/level2/`. Each is a 102-band cube covering 0.75–5.0 µm. The
viewer reads **one band** of the two selected exposures.

Range requests do the heavy lifting. A product is ~70 MB; the viewer asks for the
~69 KB FITS header, then a single ~17 MB byte range for the image plane. The
bucket allows anonymous range reads and sends permissive CORS.

```
https://nasa-irsa-spherex.s3.amazonaws.com/qr2/level2/<week>/<visit>/<file>.fits
```

### The detector

The exposures are square, 3.48° on a side, and *rolled* by the spacecraft
attitude — roughly 22° for these pointings. A rolled square through a gnomonic
projection is a rotated square, so fitting the 3.48° side leaves half the viewport
empty, which is exactly what a viewer reads as "the map is broken". The canvas
therefore fits the rotated **bounding box** (4.53°), which puts the whole footprint
on screen. `scripts/check-fit.ts` measures both.

Plate scale is `sqrt(|det(PC)|) * CDELT`, *not* a row norm. `hypot(PC1_1, PC2_1)`
reads ~10% high on a rolled pointing and quietly shrinks the field the viewer
believes it is allowed to show. `check-astro.ts` and `check-pointing.ts` hold this
to ~1e-11 px.

### Max-pooling

The plane is reduced to roughly 510×510 by taking the **brightest** sample in each
block, not the mean. At ~6 arcsec/pixel the PSF is under one pixel wide, so a 4×4
box mean would smear every star's flux across sixteen pixels and leave the field
looking empty. Stars are the point of a survey image.

### The blink

The expensive work happens once per view, never per flip: both epochs are resampled
and shaded into a pair of frames, then a flip is a `putImageData` of an
already-shaded buffer. A flip copies 9 MB in ~0.3 ms against a ~950 ms budget, so
the blink holds its cadence while panning and zooming.

Three stacked canvases share one CSS transform:

- **sky** — the shaded frame pair
- **backdrop** — graticule, scale bar, footprint outline, split divider
- **overlay** — body rings, motion vectors, pin, hover crosshair

The graticule lives on its own layer so redrawing markers never re-blits it.

### The ephemerides

Positions come from Horizons, physical parameters from SBDB, via a Convex action.
An ephemeris for a past epoch never changes, so results are cached by
`designation|date1|date2` and only fetched once.

Two things about that cache are load-bearing, and both were bugs:

1. **Reads use `.first()`, not `.unique()`.** Two tabs (or a dev-mode double
   effect) can race for the same epoch pair, both see it cold, and both insert.
   `.unique()` then throws and takes the whole action down.
2. **Writes are an upsert.** An ephemeris is immutable, so writing it twice is a
   no-op rather than a second row.

Horizons also drops requests under load, so a body it misses costs that body its
ring and nothing else. The batch goes around once more for whatever came back
empty, and the cache makes that second pass nearly free.

`scripts/check-ephemeris.mts` exercises the **deployed action**, not Horizons
directly — the original failure never showed up in the Horizons response, so a
check pointed at JPL would have stayed green through the whole bug.

---

## Layout

```
src/
  components/sky/
    Console.tsx        the whole UI: epochs, fields, controls, examples
    SkyCanvas.tsx      three canvases, interaction, hit testing
    MoverInset.tsx     magnified before/after crop of the selected body
    SpectralScrubber.tsx  band slider and the modelled spectrum
    Workbench.tsx      logbook, tour, explainer
  lib/spherex/
    archive.ts         FITS reader, pooling, geometry, caching
    astro.ts           gnomonic projection and separation
    shade.ts           tone mapping and the blink pair
    fields.ts          the 4 fields x 4 visits that are baked in
    examples.ts        5 worked examples, verified against Horizons
    movers.ts          motion, apparent magnitude, body stepping
  convex/
    movers.ts          getMovers action + the ephemeris cache
    sky.ts             Horizons and SBDB fetches
scripts/               the check suite (see package.json)
```

---

## Design

Near-monochrome, hairline dividers, generous space. Tokens live in
`src/components/sky/console.css` as `--deck-*`; the `dark` class is force-added to
`documentElement`.

Two audiences share this interface. An expert reads α/δ, separations in degrees and
motion in arcsec/day. A child needs to know where to press. Where the two conflict,
the wording is plainer and the jargon is still available — "What changed" instead
of "Diff", "The pictures SPHEREx took" instead of "Survey epochs". Targets are
oversized, a tap on the selected body advances to the next, and the sky takes a
click-to-pin mark so "I found something here" is a thing you can point at rather
than describe.

The spectrum panel is **modelled, not measured**. Real 102-band cubes are far too
large for a browser tab. It is labelled as such, and should stay that way.

---

## Environment

| variable | needed by | required |
| --- | --- | --- |
| `VITE_CONVEX_URL` | client | yes, set by the platform |
| `NASA_API_KEY` | NeoWs feed in the logbook | no, falls back to `DEMO_KEY` |

Add keys through the platform's Keys/API keys panel. Do not commit them.

There is **no authentication** in this product. The Convex auth tables remain in
the schema and are unused; `ConvexAuthProvider` still wraps the app.

---

## Conventions

- **Convex actions** for anything external — `sky.ts` is a `"use node"` file, so it
  cannot hold queries or mutations. Those live in `movers.ts` and are called across.
- **Schema validation stays off** (`schemaValidation: false`).
- **Never write return-type validators** on Convex functions.
- Documents are referenced by `_id` and typed `Id<"Table">` / `Doc<"Table">`.
- The UI is mounted at `path="*"`. There is one page and it is the product.
- Bun is the package manager. Do not add npm/yarn/pnpm lockfiles.

---

## Caveats

- **The sphere itself is cached, the ephemerides are not cleared automatically.**
  `clearPlaneDiskCache()` exists if you want a clean slate.
- **Cached planes are keyed by band resolution.** Changing the pooling target
  invalidates them; the cache name carries a version for a hard reset.
- **Cache Storage is best-effort.** Outside a browser, and on a full quota, the
  viewer silently falls back to downloading.
- Verified against 16 baked exposures across 4 fields and 129 published QR2 weeks
  in the archive, at the time of writing. SPHEREx publishes new weeks continuously.