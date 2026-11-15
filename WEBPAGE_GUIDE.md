# Sky Spotter webpage guide

This document explains the Sky Spotter webpage from a visitor's point of view and
then describes how the page is assembled for developers.

## 1. What the webpage is

Sky Spotter is an interactive SPHEREx blink comparator. It lets a visitor compare
two infrared images of the same patch of sky taken on different dates. Distant
stars generally remain in the same positions, while nearby asteroids and other
solar-system objects shift. The shift is the signal the visitor is asked to find.

The page is not a static gallery. It is a single-page React application that:

- reads calibrated SPHEREx Level-2 FITS image data from the public NASA/IPAC S3
  archive;
- lets the visitor select a field and two survey epochs;
- renders and compares the two exposures on a canvas;
- overlays tracked moving objects and coordinate information;
- provides guided learning tools and a modeled infrared spectrum;
- stores flagged discoveries in the browser and exports them as CSV or JSON.

The app is deliberately styled like a quiet scientific instrument: a dark
full-screen console, thin borders, compact monospace readouts, and orange
accents for moving-object evidence.

## 2. First visit and introduction

On the first visit, an introduction overlay covers the console. It contains three
short lessons:

1. **This is a real photograph of the sky** — the image comes from NASA's SPHEREx
   public archive and is infrared data.
2. **Stars do not move** — distant stars provide the fixed reference frame.
3. **Nearby rocks do move** — repeated observations expose motion over time.

The three mini-scenes are animated SVG illustrations. The overlay advances
automatically every 5.2 seconds, but the visitor can click any scene directly.

Available actions:

- **Start blinking** dismisses the introduction and loads the first worked example.
- **Skip** dismisses it without loading an example.
- **Close** dismisses it.
- **Space** or **Enter** starts the example.
- **Escape** dismisses the introduction.

The introduction is marked as seen in `localStorage` under
`spherex.intro.v2`. The **Intro** button in the top bar replays it.

## 3. Top bar

The top bar identifies the application as **SPHEREx Blink Comparator** and
contains the main actions.

### Field selector

On larger screens, the field selector shows the current sky field. Opening it
lists all configured fields and marks the active field. Changing the field loads
the field's available epochs and tracked bodies.

### Example

**Example** loads the first known moving-body example. It selects the appropriate
field and epoch pair and starts the guided three-view demonstration.

### Tour

The seven-step tour explains the intended workflow:

1. Start with a worked example.
2. Pick a field.
3. Choose two epochs.
4. Blink the images.
5. Watch the orange ring.
6. Read the motion in the magnified inset.
7. Log the discovery.

The dialog supports Back, Next, and Start blinking.

### Intro

Reopens the first-visit introduction.

### Guide

Opens **What am I looking at?**, a plain-English explanation of:

- infrared telescope images;
- stars, galaxies, and possible hot pixels;
- the two observation dates;
- orange rings around nearby objects;
- the 102-band chemical fingerprint.

It also lists keyboard controls:

| Key | Action |
| --- | --- |
| `Space` | Flip between epochs |
| `Left` / `Right` arrows | Select a date |
| `+` / `-` | Zoom |
| Drag | Pan the field |

### Explainer

Opens a chaptered animated explanation with five chapters:

1. A telescope built to see everything.
2. Why infrared.
3. The car-window trick: fixed stars and sliding nearby worlds.
4. Blinking two epochs.
5. Reading the chemical fingerprint.

The explainer advances automatically every nine seconds while playing. The
visitor can pause it or select a chapter directly.

### Near-Earth object traffic

The NeoWs action opens a panel backed by NASA's Near Earth Object Web Service.
It requests objects passing within 1.5 AU of Earth over the next seven days.
Each result can show its name, approach date, distance, relative velocity, and
whether NASA marks it as potentially hazardous.

The panel has explicit loading, error, empty, and result states. It depends on
the live NeoWs request being available.

### Logbook

**Logbook** opens the browser-local discovery log. The button displays a count
when entries exist. The logbook can:

- display the object's name and classification;
- show a one-to-five confidence rating;
- show the measured angular motion and field;
- show coordinates at both epochs;
- show notes and the time the entry was created;
- export all entries as `spherex-discoveries.csv`;
- export all entries as `spherex-discoveries.json`;
- clear all entries.

Entries are persisted under `spherex.discovery-log.v1` in `localStorage`.
They are not uploaded to the server.

### Mark

**Mark** opens the discovery form for the currently selected moving body. The
visitor chooses a classification, confidence, and optional notes. The form
records the two epochs, both coordinates, angular motion, distance, field, and
object identity.

If no body is selected, the action is effectively unavailable.

### Sound

The speaker button toggles a small audio tick while the comparator is running.
Sound is off by default. It uses the browser Web Audio API and is held only in
component state; it is not persisted.

## 4. Left control rail

The left rail scrolls independently from the image and is divided into labeled
sections.

### Introductory field description

At the top, the rail says:

> Find what moves while the stars hold still.

Under it is the active field's short description, such as a note about an
asteroid, dormant comet, or fast-moving object.

### Worked examples

The examples list contains five real bodies. Each row shows:

- the body's field/member label;
- the measured angular separation;
- the number of days between the selected observations;
- the field name and two dates;
- an explanation of why the example is useful when active.

**Show me** loads the example. **Show me again** repeats an active example.
**clear** exits example mode.

The examples are based on real exposure dates and tracked positions rather than
illustrative placeholder motion.

### Which part of the sky

This section lists the available fields and the tracked member designation.
Selecting one updates the current field.

The readout shows:

- `α`: right ascension;
- `δ`: declination;
- `galactic b`: galactic latitude;
- `field of view`: current view width in degrees.

### Look at the two pictures

The comparator offers four display modes:

| Mode | Meaning |
| --- | --- |
| **Blink** | Alternates exposure A and exposure B |
| **Side by side** | Shows A and B next to one another |
| **On top** | Uses the two exposures as a colored overlay |
| **What changed** | Displays the difference between the exposures |

When Blink is selected, the visitor can keep flashing or stop. **Keep it
centred** follows the selected moving object while the epochs change.

### The pictures SPHEREx took

Each configured field has four chronological survey epochs, labeled S1 through
S4. For every epoch the rail shows:

- its date;
- its SPHEREx visit identifier;
- an **A** button to use it as the first image;
- a **B** button to use it as the second image.

The app prevents A and B from being the same exposure by swapping the other
selection when necessary.

The readout gives the two selected dates, visit IDs, and the number of days
between them. In Blink mode, **Show A** and **Show B** stop automatic playback
and select one epoch.

### Blink speed

Preset speeds are:

- **Slow**: 1.4 seconds per epoch;
- **Normal**: 0.95 seconds per epoch;
- **Fast**: 0.45 seconds per epoch.

A range slider allows any interval from 150 ms to 2,000 ms in 50 ms steps.

### Display

The tone options are:

- **True** (`ink`): dark scientific display;
- **Thermal**: dark blue thermal-style display;
- **Invert** (`paper`): light display.

Additional toggles:

- **Grid** shows or hides coordinate/grid overlays.
- **In frame only** hides tracked objects outside the visible detector frame.

### Where this is

The all-sky locator is a Mollweide projection of the celestial sphere. It draws:

- the map outline;
- the celestial equator;
- the ecliptic as a dashed orange line;
- right-ascension hour labels;
- the current field as an orange marker.

The text readout gives galactic latitude, ecliptic longitude, and whether the
field is north or south of the celestial equator.

## 5. Main sky viewer

The main viewer is a layered canvas area that occupies the remaining screen
space.

### Image and overlay layers

The viewer displays the selected comparison mode and overlays tracked bodies,
motion indicators, coordinate grids, hover coordinates, and click pins.

The detector is square and rotated on the sky. Areas outside its footprint are
hatched so that empty detector corners are clearly distinguished from missing or
failed data.

### Navigation

The visitor can:

- drag to pan;
- use the `+` control or `+` key to zoom in;
- use the `-` control or `-` key to zoom out;
- use the mouse wheel to zoom;
- click an object marker to select it.

The zoom range is clamped so the visitor cannot zoom out beyond useful empty
canvas or zoom in below the configured minimum.

### Viewer readouts

The upper-left readout displays:

- right ascension;
- declination;
- field of view;
- point-spread-function full width at half maximum when available.

The upper-right readout displays archive status (`live`, header loading, plane
loading, or error) and the observation ID. JPL Horizons errors appear separately
so an archive failure is not confused with an object-service failure.

### Viewer controls

The lower-left controls are:

| Control | Action |
| --- | --- |
| `+` | Zoom in |
| `-` | Zoom out |
| Play/pause | Start or stop epoch playback |
| Grid | Toggle the grid |
| Reset/frame | Fit the whole detector |
| Crosshair | Centre on the current field |

The image initially shows a short hint explaining that it can be dragged and
that objects can be clicked. The hint disappears after the visitor touches the
image.

### Loading and failure states

While loading, the viewer reports either **reading archive header** or
**reading 16 MB of sky**. If the archive request fails, the viewer replaces the
image with an explicit error message and the underlying error text.

## 6. Moving-object selection and motion inset

Tracked bodies are loaded for the selected field and pair of epochs. Their
positions come from JPL Horizons data and are converted into the image's
coordinate system.

Selecting a body shows an orange ring and a motion vector. The selection panel
also presents:

- name and designation;
- classification;
- apparent magnitude for the current epoch when available;
- distance in astronomical units;
- position at each epoch;
- angular separation;
- angular rate in degrees per day;
- direction of travel;
- range-rate information.

The bottom-right **Mover Inset** magnifies the selected motion. It shows epoch A
on the left and epoch B on the right, with a dashed line between the two
positions. The selected epoch receives the stronger orange ring.

The inset normally crops to the motion. If the positions are too far apart to
fit honestly in one crop, it reports that the object is too far for one crop
instead of showing misleading empty sky.

## 7. Spectral band scrubber

The spectral panel contains a **102-band spectrum** covering roughly
0.75–5.0 micrometers. The visitor can switch between three composition models:

- **Volatile ice**;
- **Gas giant / ice giant**;
- **Silicate rock**.

A slider selects an individual band and reports:

- band number out of 102;
- wavelength in micrometers;
- modeled flux.

The chart marks modeled absorption features for:

- water gas;
- water ice;
- methane;
- organics/carbon dust;
- carbon dioxide;
- carbon monoxide.

The panel explains the strongest feature for the selected model and, when an
object is selected, identifies the object used for the model.

**Important limitation:** this is a modeled teaching spectrum, not a measured
SPHEREx spectrum. The actual archive spectral image cubes are not loaded into
this browser panel yet.

## 8. Data and rendering behavior

### Field and epoch metadata

The field definitions live in `src/lib/spherex/fields.ts`. Each field contains:

- a field ID and display name;
- a plain-language blurb;
- four real survey epochs;
- a FITS object key;
- boresight coordinates;
- detector offset;
- known solar-system members.

The baseline is calculated from the selected epochs' real `DATE-OBS` dates.

### Reading a SPHEREx exposure

`src/lib/spherex/archive.ts` reads the public S3 object using HTTP range
requests:

1. Fetch a small FITS header range.
2. Find the `IMAGE` extension and parse WCS, date, observation ID, detector
   geometry, plate scale, and PSF metadata.
3. Fetch the 2040 × 2040 float32 image plane.
4. Read FITS big-endian values and max-pool the plane to approximately 510 pixels.
5. Calculate robust low/high stretch values for display.

Only the required byte ranges are fetched. Headers and pooled planes are cached
in memory, and the browser's Cache Storage is used when available.

### Canvas performance

The sky image is rebuilt after the view settles. While a visitor is dragging or
zooming, the previous bitmap is transformed on the GPU so interaction remains
responsive. Both the sky and overlay use the same transform, preventing visible
drift.

Blink mode pre-renders both frames and changes between them with a cheap image
blit. The expensive resampling work is not repeated on every blink.

## 9. Application structure

The entry point is `src/main.tsx`. It:

- loads the Vly integrations and toolbar;
- creates a Convex client from `VITE_CONVEX_URL`;
- wraps the app in `ConvexAuthProvider`;
- enables `BrowserRouter`;
- mounts `Console` for every route;
- provides a lazy-load fallback;
- posts route changes to a parent iframe when embedded;
- catches toolbar and root render errors;
- mounts the toast provider.

The main UI is in:

- `src/components/sky/Console.tsx` — page state, layout, controls, data
  coordination, and the main viewer composition;
- `src/components/sky/SkyCanvas.tsx` — canvas rendering, panning, zooming,
  overlays, and selection;
- `src/components/sky/MoverInset.tsx` — selected-object motion crop;
- `src/components/sky/SpectralScrubber.tsx` — modeled 102-band spectrum;
- `src/components/sky/Workbench.tsx` — tour, guide, explainer, all-sky locator,
  discovery log, and sound;
- `src/components/sky/Intro.tsx` — first-visit introduction;
- `src/lib/spherex/archive.ts` — FITS archive reader and caching;
- `src/lib/spherex/fields.ts` — configured fields and epochs;
- `src/lib/spherex/movers.ts` — motion calculations and object helpers.

## 10. Authentication and persistence

Convex authentication is initialized globally, but the comparator itself is
usable as a browser interface without a visible sign-in flow.

The following state is local to the browser:

- first-visit introduction dismissal;
- discovery log entries.

Most viewer controls reset when the page is reloaded. Archive data may remain in
Cache Storage to speed up later visits.

## 11. Deployment

`.github/workflows/deploy-pages.yml` deploys the site to GitHub Pages whenever
`main` receives a push, or when the workflow is manually dispatched.

The workflow:

1. checks out the repository;
2. installs Node 22;
3. runs `npm ci`;
4. generates Convex bindings with `npx convex codegen`;
5. runs `npm run build` with `VITE_CONVEX_URL` and the Convex deployment secret;
6. copies `dist/index.html` to `dist/404.html` so SPA routes work on Pages;
7. uploads `dist` as a Pages artifact;
8. deploys with `actions/deploy-pages`.

The workflow grants read access to repository contents, Pages write access, and
OIDC identity-token access. Its concurrency group is `pages`, and a newer run
cancels an older run.

## 12. Local development

Install dependencies and start the Vite development server:

```bash
npm ci
npm run dev
```

Useful repository commands:

```bash
npm run build   # Type-check and create the production bundle
npm run lint    # Run ESLint
npm run preview # Serve the production bundle locally
npm run check   # Run the repository's validation scripts
```

The deployment build expects the Convex environment values used by the workflow,
including `VITE_CONVEX_URL` and `CONVEX_DEPLOYMENT`.

## 13. Honest boundaries

The webpage intentionally communicates what is real and what is educational:

- **Real:** SPHEREx exposure pixels, FITS headers, observation dates, WCS,
  detector geometry, tracked-body positions, and JPL-derived motion.
- **Modeled:** the spectrum chart and its composition curves.
- **External/live:** NASA NeoWs traffic data, archive availability, and Convex
  configuration.
- **Browser-local:** the introduction state, discovery log, and most UI state.

This separation matters because the spectrum panel is an explanatory model, while
the blink comparison is grounded in actual public survey exposures.
