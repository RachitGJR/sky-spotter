import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { loadHeader, loadPlane, type SkyPlane, type SpherexHeader } from "@/lib/spherex/archive";
import { formatAngle, formatDec, formatRa, project, separation } from "@/lib/spherex/astro";
import { FIELDS, baselineDays, getField, type SurveyEpoch } from "@/lib/spherex/fields";
import { EXAMPLES, getExample, type Example } from "@/lib/spherex/examples";
import { apparentMagnitude, motionOf, type Mover } from "@/lib/spherex/movers";
import { SkyCanvas, type Compare, type Tone, type View } from "@/components/sky/SkyCanvas";
import { MoverInset } from "@/components/sky/MoverInset";
import {
  BAND_COUNT,
  BAND_WAVELENGTHS,
  MARKERS,
  bandColour,
  bandPlainName,
  defaultComposition,
  modelSpectrum,
  strongestMarker,
} from "@/components/sky/SpectralScrubber";
import {
  AllSkyLocator,
  BeginnerGuide,
  Discovery,
  DiscoveryLog,
  ExplainerDialog,
  LogDialog,
  TourDialog,
  useDiscoveryLog,
  useSound,
} from "@/components/sky/Workbench";
import { Intro, useIntro } from "@/components/sky/Intro";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Aperture,
  Asterisk,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Crosshair,
  Grid3x3,
  GraduationCap,
  MoreHorizontal,
  Play,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import "./console.css";

/* ------------------------------------------------------------------ *
 * Presentational pieces — flat, hairline, no fills but the active one
 * ------------------------------------------------------------------ */

function Rail({
  title,
  children,
  action,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  if (collapsible) {
    return (
      <details
        className="border-b border-[var(--deck-line-soft)] px-4 py-4 group"
        open={defaultOpen}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <ChevronRight className="size-3 shrink-0 text-[var(--deck-dim)] transition-transform group-open:rotate-90" />
            <span className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--deck-dim)]">
              {title}
            </span>
          </span>
          {action}
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    );
  }

  return (
    <section className="border-b border-[var(--deck-line-soft)] px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--deck-dim)]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Option<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { id: T; label: string; meta?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-[var(--deck-line)]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`min-h-[38px] px-3 py-2.5 text-left transition-colors ${
              active
                ? "bg-[var(--deck-text)] text-[var(--deck-bg)]"
                : "bg-transparent text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
            }`}
          >
            <span className="block text-[13px] leading-tight">{o.label}</span>
            {o.meta && (
              <span
                className={`mt-0.5 block font-mono text-[10px] leading-tight ${
                  active ? "text-[var(--deck-bg)]/60" : "text-[var(--deck-dim)]"
                }`}
              >
                {o.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function GhostButton({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex min-h-[34px] items-center whitespace-nowrap rounded-md px-3 py-2 text-[13px] transition-colors ${
        active
          ? "bg-[var(--deck-text)] text-[var(--deck-bg)]"
          : "text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  onClick,
  label,
  children,
  active,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-10 shrink-0 place-items-center rounded-md transition-colors ${
        active
          ? "bg-[var(--deck-text)] text-[var(--deck-bg)]"
          : "text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Readout({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3">
          <dt className="text-[11px] text-[var(--deck-dim)]">{k}</dt>
          <dd className="font-mono text-[11px] text-[var(--deck-text)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ThemeButton({ theme, onToggle }: { theme: "light" | "dark"; onToggle: () => void }) {
  return (
    <button type="button" className="theme-button" onClick={onToggle} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
      {theme === "light" ? "☾ Dark" : "☀ Light"}
    </button>
  );
}

function MovementReview({ movers, selectedId, onReview, onFocus }: { movers: Mover[]; selectedId: string | null; onReview: (mover: Mover, moving: boolean) => void; onFocus: (mover: Mover) => void }) {
  const [index, setIndex] = useState(0);
  const current = movers[index % Math.max(1, movers.length)];
  if (!current) return null;

  const decide = (moving: boolean) => {
    onReview(current, moving);
    setIndex((value) => value + 1);
  };

  return (
    <section className="review-card" aria-label="Review possible moving objects">
      <div>
        <p className="text-sm font-semibold text-blue-600">YOUR TURN</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">Does this dot move?</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Swipe right for <strong>moving</strong>. Swipe left for <strong>not moving</strong>.
        </p>
      </div>
      <div className="review-object">
        <span className="review-spark" aria-hidden="true">✦</span>
        <strong>{current.name}</strong>
        <span>{index + 1} of {movers.length} possible objects</span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="review-action review-no" onClick={() => decide(false)} aria-label="Mark as not moving">← Not moving</button>
        <button type="button" className="review-focus" onClick={() => onFocus(current)} aria-label="Zoom to this object">Zoom in</button>
        <button type="button" className="review-action review-yes" onClick={() => decide(true)} aria-label="Mark as moving">Moving →</button>
      </div>
      {selectedId === current.id && <p className="mt-3 text-center text-xs text-blue-700 dark:text-blue-300">The automatic detector found this object between the two pictures.</p>}
    </section>
  );
}

function ConstellationGuide() {
  const constellations = [
    { name: "Orion", note: "Look for three bright stars in a straight line: Orion’s Belt.", pattern: "✦  ✦  ✦" },
    { name: "Ursa Major", note: "The Big Dipper looks like a saucepan with a long handle.", pattern: "✦  ✦\n  ✦  ✦  ✦" },
    { name: "Cassiopeia", note: "Five bright stars make a wide W shape.", pattern: "✦  ✦  ✦  ✦  ✦" },
  ];
  return (
    <section className="constellation-card">
      <p className="text-sm font-semibold text-blue-600">LOOK UP</p>
      <h2 className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">Find a constellation</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Constellations are pictures made by joining stars. The stars are far apart, but the pattern helps us find them.</p>
      <div className="constellation-grid mt-4">
        {constellations.map((item) => (
          <article key={item.name} className="constellation-item">
            <p className="constellation-pattern" aria-hidden="true">{item.pattern}</p>
            <h3>{item.name}</h3>
            <p>{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function WelcomePage({ onStart, onLearn, theme, onToggleTheme }: { onStart: () => void; onLearn: () => void; theme: "light" | "dark"; onToggleTheme: () => void }) {
  return (
    <div className={`welcome-page ${theme} min-h-screen overflow-auto`}>
      <header className="welcome-header">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" aria-hidden="true" className="size-10 rounded-full" />
          <div>
            <p className="text-lg font-semibold tracking-tight">Sky Spotter</p>
            <p className="text-sm text-slate-500">A friendly way to explore space</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeButton theme={theme} onToggle={onToggleTheme} />
          <button type="button" className="welcome-link" onClick={onLearn}>How does it work?</button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col items-center px-5 pb-16 pt-12 text-center sm:pt-20">
        <div className="welcome-orbit" aria-hidden="true">
          <span className="welcome-star star-one" />
          <span className="welcome-star star-two" />
          <span className="welcome-planet" />
        </div>
        <p className="welcome-eyebrow">LOOK UP. FIND SOMETHING MOVING.</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
          The sky is full of little surprises.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl">
          Look at two real pictures of the night sky. Press play. Find the dot that moves.
        </p>
        <button type="button" className="welcome-primary mt-8" onClick={onStart}>
          <Play className="size-5 fill-current" />
          Start exploring
        </button>
        <p className="mt-3 text-sm text-slate-500">No account. No special knowledge. Just curiosity.</p>

        <div className="mt-16 grid w-full max-w-4xl gap-4 text-left sm:grid-cols-3">
          {[
            { icon: "👀", title: "Look", body: "See a real picture from a space telescope." },
            { icon: "▶", title: "Press play", body: "The pictures take turns, like a flip book." },
            { icon: "✨", title: "Spot the mover", body: "One dot jumps. That is a world in space." },
          ].map((step, index) => (
            <div key={step.title} className="welcome-card">
              <span className="welcome-card-number">{index + 1}</span>
              <span className="text-3xl" aria-hidden="true">{step.icon}</span>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">{step.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.body}</p>
            </div>
          ))}
        </div>
        <section className="mt-10 w-full max-w-4xl rounded-3xl border border-blue-100 bg-blue-50/70 p-6 text-left sm:p-8">
          <h2 className="text-xl font-semibold text-slate-900">What can you do here?</h2>
          <ul className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
            {[
              "See real pictures from NASA's SPHEREx telescope",
              "Watch asteroids and comets move between two dates",
              "Choose a friendly example instead of starting from nothing",
              "Tap, click, or use the keyboard — no tiny controls",
              "Learn what you are seeing in plain language",
              "Save discoveries to your own logbook",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-blue-600" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

function SimpleExplorer({
  field,
  epochA,
  epochB,
  expA,
  expB,
  status,
  error,
  compare,
  setCompare,
  epoch,
  setEpoch,
  playing,
  setPlaying,
  movers,
  selected,
  selectedId,
  onSelect,
  view,
  setView,
  geometry,
  onGeometry,
  runExample,
  setFieldId,
  onMoreControls,
  guideOpen,
  setGuideOpen,
  entries,
  updateDiscoveries,
  focusMover,
  baseline,
  targetName,
  coordinates,
  onCoordinates,
  theme,
  onToggleTheme,
}: {
  field: ReturnType<typeof getField>;
  epochA: SurveyEpoch;
  epochB: SurveyEpoch;
  expA: { header: SpherexHeader | null; plane: SkyPlane | null };
  expB: { header: SpherexHeader | null; plane: SkyPlane | null };
  status: string;
  error: string | null;
  compare: Compare;
  setCompare: (v: Compare) => void;
  epoch: 0 | 1;
  setEpoch: (v: 0 | 1) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  movers: Mover[];
  selected: Mover | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  view: View;
  setView: (v: View) => void;
  geometry: { fitFov: number; maxFov: number };
  onGeometry: (v: { fitFov: number; maxFov: number }) => void;
  runExample: (v: Example) => void;
  setFieldId: (v: string) => void;
  onMoreControls: () => void;
  guideOpen: boolean;
  setGuideOpen: (v: boolean) => void;
  entries: Discovery[];
  updateDiscoveries: (v: Discovery[]) => void;
  focusMover: (v: Mover) => void;
  baseline: number;
  targetName: string;
  coordinates: { ra: string; dec: string };
  onCoordinates: (coordinates: { ra: string; dec: string }, name?: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const challengeTargets = [
    { name: "Barnard's Star", hint: "A nearby star", ra: "17:57:48.50", dec: "+04:41:36.1" },
    { name: "Epsilon Indi B", hint: "A tiny brown star", ra: "21:04:34.80", dec: "-56:46:50.0" },
    { name: "WISE 0855", hint: "A cold, fast world", ra: "08:55:10.831", dec: "-07:14:42.53" },
    { name: "RW Aurigae", hint: "A star that changes", ra: "05:07:49.57", dec: "+30:24:05.0" },
    { name: "R Draconis", hint: "A star that brightens", ra: "16:32:40.76", dec: "+66:45:36.7" },
  ];

  const parseAngle = (value: string, isRa: boolean) => {
    const parts = value.trim().split(/[:\s]+/).map(Number);
    if (parts.some(Number.isNaN)) return null;
    if (parts.length === 1) return Number.isFinite(parts[0]) ? parts[0] * (isRa ? 15 : 1) : null;
    const sign = !isRa && value.trim().startsWith("-") ? -1 : 1;
    return sign * (Math.abs(parts[0]) + parts[1] / 60 + (parts[2] ?? 0) / 3600) * (isRa ? 15 : 1);
  };

  const submitCoordinates = (event: React.FormEvent) => {
    event.preventDefault();
    const ra = parseAngle(coordinates.ra, true);
    const dec = parseAngle(coordinates.dec, false);
    if (ra === null || dec === null || ra < 0 || ra >= 360 || dec < -90 || dec > 90) return;
    onCoordinates(coordinates, targetName || "Custom sky position");
    setView({ ...view, ra, dec });
  };

  return (
    <div className={`simple-app ${theme} min-h-screen`}>
      <header className="simple-header">
        <button type="button" className="flex items-center gap-2 text-left" onClick={onMoreControls}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" aria-hidden="true" className="size-9 rounded-full" />
          <span>
            <strong className="block text-sm">Sky Spotter</strong>
            <span className="block text-xs text-slate-500">Find what moves</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <ThemeButton theme={theme} onToggle={onToggleTheme} />
          <button type="button" className="simple-header-button" onClick={() => setGuideOpen(true)}>Help</button>
          <DiscoveryLog entries={entries} onChange={updateDiscoveries} />
          <button type="button" className="simple-header-button" onClick={onMoreControls}>More controls</button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-blue-600">STEP 1 OF 3</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Pick a target</h1>
            <p className="mt-2 max-w-xl text-slate-600">Tap any card. You do not need to know anything about space.</p>
          </div>
          <button type="button" className="simple-help-button" onClick={() => setGuideOpen(true)}>I need help</button>
        </div>

        <div className="simple-story-row" aria-label="Challenge targets">
          {challengeTargets.map((target) => {
            const active = target.name === targetName;
            return (
              <button
                type="button"
                key={target.name}
                onClick={() => {
                  onCoordinates({ ra: target.ra, dec: target.dec }, target.name);
                  setView({ ...view, ra: parseAngle(target.ra, true) ?? view.ra, dec: parseAngle(target.dec, false) ?? view.dec });
                }}
                className={`simple-story-card ${active ? "simple-story-card-active" : ""}`}
              >
                <span className="simple-story-icon" aria-hidden="true">✦</span>
                <span className="block text-left text-base font-semibold text-slate-900">{target.name}</span>
                <span className="mt-1 block text-left text-sm text-slate-600">{target.hint}</span>
                <span className="mt-3 block text-left text-sm font-semibold text-blue-700">{active ? "Showing this target" : "Show me →"}</span>
              </button>
            );
          })}
        </div>
        <details className="coordinate-details">
          <summary>I have coordinates</summary>
          <p>Coordinates are a way to name a place in the sky. You can skip this and use a card above.</p>
          <form className="coordinate-box" onSubmit={submitCoordinates}>
            <label htmlFor="ra-input">Sky address 1</label>
            <input id="ra-input" value={coordinates.ra} onChange={(event) => onCoordinates({ ...coordinates, ra: event.target.value })} placeholder="08:55:10.831" />
            <label htmlFor="dec-input">Sky address 2</label>
            <input id="dec-input" value={coordinates.dec} onChange={(event) => onCoordinates({ ...coordinates, dec: event.target.value })} placeholder="-07:14:42.53" />
            <button type="submit" className="simple-primary-small">Show this sky</button>
          </form>
        </details>

        <section className="simple-viewer-card mt-6">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
            <div>
              <p className="text-sm font-semibold text-blue-600">STEP 2 OF 3</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Watch two pictures</h2>
              <p className="mt-1 text-sm text-slate-600">Stars stay still. The orange ring shows what moved.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`simple-choice ${compare === "blink" ? "simple-choice-active" : ""}`} onClick={() => setCompare("blink")}>Blink</button>
              <button type="button" className={`simple-choice ${compare === "split" ? "simple-choice-active" : ""}`} onClick={() => setCompare("split")}>Side by side</button>
              <button type="button" className={`simple-play ${playing ? "simple-play-active" : ""}`} onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause the pictures" : "Play the pictures"}>
                <Play className={`size-4 ${playing ? "fill-current" : ""}`} />
                {playing ? "Playing" : "Press play"}
              </button>
            </div>
          </div>
          <div className="simple-canvas-wrap">
            <div className="simple-canvas-guide" aria-hidden="true">
              <span className="simple-canvas-guide-title">This is a picture of the sky</span>
              <span>Watch the dots. Find the one with the orange ring.</span>
            </div>
            <div className="simple-sky-canvas">
              <SkyCanvas
                a={{ header: expA.header, plane: expA.plane, label: `A · ${epochA.date}`, short: `A · ${epochA.date}` }}
                b={{ header: expB.header, plane: expB.plane, label: `B · ${epochB.date}`, short: `B · ${epochB.date}` }}
                compare={compare}
                view={view}
                tone="ink"
                epoch={epoch}
                movers={movers}
                selectedId={selectedId}
                onSelect={onSelect}
                aDate={epochA.date}
                bDate={epochB.date}
                onViewChange={setView}
                onGeometry={onGeometry}
                showGrid={false}
                busy={status !== "ready"}
              />
            </div>
            {selected && (
              <>
                <div className="simple-detection-label">
                  <span className="simple-detection-dot" />
                  <span><strong>{selected.name}</strong><small>Automatic movement match</small></span>
                </div>
                <MoverInset
                  a={expA}
                  b={expB}
                  mover={selected}
                  epoch={epoch}
                  tone="ink"
                  aLabel="BEFORE"
                  bLabel="AFTER"
                  aDate={epochA.date}
                  bDate={epochB.date}
                />
              </>
            )}
            {status === "error" && <p className="absolute inset-0 grid place-items-center bg-slate-950/90 p-8 text-center text-sm text-white">{error}</p>}
            {status !== "ready" && status !== "error" && <p className="absolute inset-0 grid place-items-center text-sm text-white">Loading a real sky picture…</p>}
            <div className="simple-canvas-legend" aria-label="Picture legend">
              <span><i className="legend-dot legend-star" /> Stars stay still</span>
              <span><i className="legend-dot legend-mover" /> This one moves</span>
            </div>
          </div>
        </section>

        <section className="simple-next-card mt-6">
          <div>
            <p className="text-sm font-semibold text-blue-600">STEP 3 OF 3</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{selected ? `You found ${selected.name}!` : "Can you find the moving dot?"}</h2>
            <p className="mt-1 text-sm text-slate-600">{selected ? "Tap the button below to keep this discovery." : "Stars stay still. An asteroid or comet moves."}</p>
          </div>
          {selected ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="simple-primary-small" onClick={() => focusMover(selected)}>Show me the movement</button>
              <button type="button" className="simple-secondary-small" onClick={() => setGuideOpen(true)}>Tell me more</button>
            </div>
          ) : (
            <span className="simple-tip">Look for a dot that jumps</span>
          )}
        </section>
        <MovementReview
          movers={movers}
          selectedId={selectedId}
          onReview={(mover, moving) => {
            if (moving) {
              onSelect(mover.id);
              focusMover(mover);
            } else if (selectedId === mover.id) {
              onSelect(null);
            }
          }}
          onFocus={focusMover}
        />
        <ConstellationGuide />
      </main>
      <BeginnerGuide open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

const SPEEDS = [
  { label: "Slow", ms: 1400 },
  { label: "Normal", ms: 950 },
  { label: "Fast", ms: 450 },
];

const FILTERS: { id: Tone; label: string }[] = [
  { id: "ink", label: "True" },
  { id: "thermal", label: "Thermal" },
  { id: "paper", label: "Invert" },
];

const COMPARE_MODES: { id: Compare; label: string; hint: string }[] = [
  { id: "blink", label: "Blink", hint: "the pictures flash one after another" },
  { id: "split", label: "Side by side", hint: "the two pictures next to each other" },
  { id: "overlay", label: "On top", hint: "one picture in red, the other in blue" },
  { id: "diff", label: "What changed", hint: "what is different between the two" },
];

/** The three beats a worked example walks through, in order. */
const DEMO_BEATS: { mode: Compare; caption: string; seconds: number }[] = [
  {
    mode: "split",
    caption: "Same patch of sky, photographed twice. The stars line up across the divider. The dot does not.",
    seconds: 4,
  },
  {
    mode: "blink",
    caption: "Now blink them. Stars hold still. That is the entire experiment — you are doing it.",
    seconds: 5,
  },
  {
    mode: "diff",
    caption: "Difference of the two. The moving body shows as a bright blob with a dark one beside it.",
    seconds: 4,
  },
];

/** Loads one real exposure, keyed by object key and cached in the archive module. */
function useExposure(epoch: SurveyEpoch | undefined) {
  const [header, setHeader] = useState<SpherexHeader | null>(null);
  const [plane, setPlane] = useState<SkyPlane | null>(null);
  const [status, setStatus] = useState<"idle" | "header" | "plane" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const key = epoch?.key;

  useEffect(() => {
    if (!key) {
      setHeader(null);
      setPlane(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("header");
    setError(null);
    (async () => {
      try {
        const h = await loadHeader(key);
        if (cancelled) return;
        setHeader(h);
        setStatus("plane");
        const p = await loadPlane(h, 510);
        if (cancelled) return;
        setPlane(p);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not read the SPHEREx archive.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { header, plane, status, error };
}

/* ------------------------------------------------------------------ *
 * The console
 * ------------------------------------------------------------------ */

export default function Console() {
  const [activeNav, setActiveNav] = useState<"explore" | "learn">("explore");
  const [simpleMode, setSimpleMode] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("sky-spotter.theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // Fall back to the device preference below.
    }
    return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [targetName, setTargetName] = useState("WISE 0855");
  const [coordinates, setCoordinates] = useState({ ra: "08:55:10.831", dec: "-07:14:42.53" });
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return localStorage.getItem("sky-spotter.started") !== "yes";
    } catch {
      return true;
    }
  });
  const [fieldId, setFieldId] = useState(FIELDS[0].id);
  const field = useMemo(() => getField(fieldId), [fieldId]);

  // Two real exposures, chosen from the visits the archive actually published for
  // this field. S1-S4 in the rail; A and B are the pair under the cursor.
  const [aIdx, setAIdx] = useState(0);
  const [bIdx, setBIdx] = useState(1);
  const epochA = field.epochs[Math.min(aIdx, field.epochs.length - 1)];
  const epochB = field.epochs[Math.min(bIdx, field.epochs.length - 1)];

  const expA = useExposure(epochA);
  const expB = useExposure(epochB);
  const header = expA.header ?? expB.header;
  const status = expA.status === "error" || expB.status === "error" ? "error" : expA.status === "ready" || expB.status === "ready" ? "ready" : "header";
  const error = expA.error ?? expB.error;

  const [epoch, setEpoch] = useState<0 | 1>(0);
  const [playing, setPlaying] = useState(true);
  const [intervalMs, setIntervalMs] = useState(950);
  const [tone, setTone] = useState<Tone>("ink");
  const [compare, setCompare] = useState<Compare>("blink");
  const [showGrid, setShowGrid] = useState(true);
  const [follow, setFollow] = useState(false);
  const [onlyInFrame, setOnlyInFrame] = useState(false);
  const [band, setBand] = useState(28);
  const [view, setView] = useState<View>({ ra: epochA.ra, dec: epochA.dec, fovDeg: 3.5 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionClosed, setSelectionClosed] = useState(false);

  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const sound = useSound();
  const { entries, update: updateDiscoveries } = useDiscoveryLog();
  const intro = useIntro();

  // The console is a dark instrument; make every shared dialog and sheet follow.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem("sky-spotter.theme", theme);
    } catch {
      // Theme still applies for this visit when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (localStorage.getItem("sky-spotter.theme")) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /* --- worked examples --------------------------------------------------- */
  // A first-time citizen has four fields, sixteen exposures and no reason to look at
  // any of them. Each example is a real body with motion measured by JPL, and
  // "Show me" loads the field and epoch pair that show it, then walks the three ways
  // of looking at the same two exposures.
  const [exampleId, setExampleId] = useState<string | null>(null);
  const [demoBeat, setDemoBeat] = useState<number | null>(null);
  const activeExample = exampleId ? getExample(exampleId) : null;
  // runExample parks the pair here so the field-change effect below re-applies it
  // instead of resetting to the first two epochs.
  const examplePair = useRef<Example | null>(null);

  const runExample = useCallback((example: Example) => {
    setExampleId(example.id);
    setSelectionClosed(false);
    setFieldId(example.fieldId);
    examplePair.current = example;
    setAIdx(Math.min(example.a, getField(example.fieldId).epochs.length - 1));
    setBIdx(Math.min(example.b, getField(example.fieldId).epochs.length - 1));
    setCompare(DEMO_BEATS[0].mode);
    setPlaying(true);
    setFollow(false);
    setDemoBeat(0);
  }, []);

  const startExperience = useCallback(() => {
    try {
      localStorage.setItem("sky-spotter.started", "yes");
    } catch {
      // The app remains usable when browser storage is unavailable.
    }
    setShowWelcome(false);
    setSimpleMode(true);
    runExample(EXAMPLES[0]);
  }, [runExample]);

  // Frame the field whenever the citizen switches fields, and centre on the midpoint
  // of the two selected exposures so neither sits off the edge of the canvas.
  // Switching fields by hand drops any running example; switching because an example
  // asked for it keeps the pair the example asked for.
  useEffect(() => {
    setSelectedId(null);
    setSelectionClosed(false);
    const ex = examplePair.current;
    examplePair.current = null;
    if (ex && ex.fieldId === field.id) {
      setAIdx(Math.min(ex.a, field.epochs.length - 1));
      setBIdx(Math.min(ex.b, field.epochs.length - 1));
      return;
    }
    setExampleId(null);
    setDemoBeat(null);
    setAIdx(0);
    setBIdx(Math.min(1, field.epochs.length - 1));
  }, [field]);

  useEffect(() => {
    const ra = (epochA.ra + epochB.ra) / 2;
    const dec = (epochA.dec + epochB.dec) / 2;
    setView((v) => ({ ...v, ra: ((ra + 540) % 360) - 180, dec }));
  }, [epochA.ra, epochA.dec, epochB.ra, epochB.dec]);

  const epoch1 = epochA.date;
  const epoch2 = epochB.date;
  const baseline = baselineDays(field, aIdx, bIdx);

  /**
   * The sky the exposures actually cover. SPHEREx's detector is a 3.48° square held
   * at an angle to the sky, so the canvas reports the field of view that shows the
   * whole footprint and the limit past which there is nothing left to show. Without
   * this the default view fits the square's side and leaves most of the canvas black.
   */
  const [geometry, setGeometry] = useState({ fitFov: 3.5, maxFov: 4 });
  const onGeometry = useCallback((g: { fitFov: number; maxFov: number }) => {
    setGeometry((prev) =>
      Math.abs(prev.fitFov - g.fitFov) < 1e-3 && Math.abs(prev.maxFov - g.maxFov) < 1e-3
        ? prev
        : g,
    );
  }, []);

  // Once the header lands, frame the whole footprint.
  const framedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!header) return;
    const id = header.key;
    if (framedFor.current === id) return;
    framedFor.current = id;
    setView((v) => ({ ...v, fovDeg: geometry.fitFov }));
  }, [header, geometry.fitFov]);

  const maxFov = geometry.maxFov;

  /* --- real ephemerides ------------------------------------------------- */
  const designations = useMemo(() => field.members.map((m) => m.designation), [field]);
  const getMovers = useAction(api.movers.getMovers);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [moversError, setMoversError] = useState<string | null>(null);

  useEffect(() => {
    if (!epoch2) return;
    let cancelled = false;
    setMoversError(null);
    getMovers({ designations, date1: epoch1, date2: epoch2 })
      .then((result) => {
        if (cancelled) return;
        setMovers(
          result.movers
            .filter((m): m is NonNullable<typeof m> => m !== null)
            .map((m) => ({
              id: m.designation,
              designation: m.designation,
              name: m.name ?? m.designation,
              class: m.class ?? null,
              diameterKm: m.diameterKm,
              absoluteMagnitude: m.absoluteMagnitude,
              albedo: m.albedo,
              epoch1: m.epoch1,
              epoch2: m.epoch2,
            })),
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setMoversError(e instanceof Error ? e.message : "JPL Horizons did not answer.");
      });
    return () => {
      cancelled = true;
    };
  }, [getMovers, designations, epoch1, epoch2]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setEpoch((e) => (e === 0 ? 1 : 0)), intervalMs);
    return () => window.clearInterval(id);
  }, [playing, intervalMs]);

  // Selecting the body is what the inset and the target card key off, so a worked
  // example falls back to the field's own member as soon as its ephemeris lands.
  // Derived rather than stored, so no effect has to push a selection into state.
  const effectiveSelectedId = selectionClosed
    ? null
    : selectedId ?? (activeExample && movers.length ? movers[0].id : null);
  const selectMover = useCallback((id: string | null) => {
    setSelectionClosed(false);
    setSelectedId(id);
  }, []);
  const selected = movers.find((m) => m.id === effectiveSelectedId) ?? null;
  const motion = selected ? motionOf(selected, baseline) : null;

  // Advance the demo through its beats, then hand control back. Each step sets the
  // next mode from inside the timer rather than from the effect body, so the effect
  // only ever schedules.
  useEffect(() => {
    if (demoBeat === null) return;
    const beat = DEMO_BEATS[demoBeat];
    if (!beat) return;
    const id = window.setTimeout(() => {
      const next = demoBeat + 1;
      // Done: leave the citizen blinking, which is the thing worth doing.
      setCompare(next < DEMO_BEATS.length ? DEMO_BEATS[next].mode : "blink");
      setDemoBeat(next < DEMO_BEATS.length ? next : null);
    }, beat.seconds * 1000);
    return () => window.clearTimeout(id);
  }, [demoBeat]);


  const focusMover = useCallback(
    (m: Mover) => {
      const a = project(m.epoch1.ra, m.epoch1.dec, m.epoch2.ra, m.epoch2.dec);
      // Never ask for more sky than the exposures actually cover.
      setView({
        ra: m.epoch1.ra,
        dec: m.epoch1.dec,
        fovDeg: Math.min(maxFov, Math.max(0.3, Math.hypot(a.x, a.y) * 1.7)),
      });
    },
    [maxFov],
  );

  useEffect(() => {
    if (!simpleMode || !activeExample || !movers.length || selectedId) return;
    const detected = movers[0];
    setSelectedId(detected.id);
    focusMover(detected);
  }, [simpleMode, activeExample, movers, selectedId, focusMover]);

  useEffect(() => {
    if (!follow || !selected) return;
    const p = selected[epoch === 0 ? "epoch1" : "epoch2"];
    setView((v) => ({ ...v, ra: p.ra, dec: p.dec }));
  }, [follow, selected, epoch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setEpoch((v) => (v === 0 ? 1 : 0));
        setPlaying(false);
      } else if (e.code === "ArrowRight") {
        setBand((b) => Math.min(BAND_COUNT - 1, b + 1));
      } else if (e.code === "ArrowLeft") {
        setBand((b) => Math.max(0, b - 1));
      } else if (e.key === "+" || e.key === "=") {
        setView((v) => ({ ...v, fovDeg: Math.max(0.15, v.fovDeg / 1.3) }));
      } else if (e.key === "-" || e.key === "_") {
        setView((v) => ({ ...v, fovDeg: Math.min(maxFov, v.fovDeg * 1.3) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxFov]);

  const visible = useMemo(() => {
    if (!onlyInFrame) return movers;
    return movers.filter((m) => {
      const p = m[epoch === 0 ? "epoch1" : "epoch2"];
      return separation(p, { ra: view.ra, dec: view.dec }) < view.fovDeg;
    });
  }, [movers, onlyInFrame, epoch, view]);

  const centre = header ?? { ra: view.ra, dec: view.dec };
  const galactic = useMemo(() => {
    const R = Math.PI / 180;
    return (
      Math.asin(
        Math.sin(centre.dec * R) * Math.sin(27.13 * R) +
          Math.cos(centre.dec * R) * Math.cos(27.13 * R) * Math.sin((centre.ra - 192.86) * R),
      ) / R
    );
  }, [centre.ra, centre.dec]);

  const composition = defaultComposition(selected);
  const curve = useMemo(() => modelSpectrum(composition), [composition]);
  const marker = strongestMarker(composition);
  const magnitude = selected ? apparentMagnitude(selected, epoch === 0 ? 1 : 2) : null;
  const lambda = BAND_WAVELENGTHS[band];

  if (showWelcome) {
    return (
      <WelcomePage
        onStart={startExperience}
        onLearn={() => {
          setShowWelcome(false);
          setGuideOpen(true);
        }}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
      />
    );
  }

  if (simpleMode) {
    return (
      <SimpleExplorer
        field={field}
        epochA={epochA}
        epochB={epochB}
        expA={expA}
        expB={expB}
        status={status}
        error={error}
        compare={compare}
        setCompare={setCompare}
        epoch={epoch}
        setEpoch={setEpoch}
        playing={playing}
        setPlaying={setPlaying}
        movers={movers}
        selected={selected}
        selectedId={effectiveSelectedId}
        onSelect={selectMover}
        view={view}
        setView={setView}
        geometry={geometry}
        onGeometry={onGeometry}
        runExample={runExample}
        setFieldId={setFieldId}
        onMoreControls={() => setSimpleMode(false)}
        guideOpen={guideOpen}
        setGuideOpen={setGuideOpen}
        entries={entries}
        updateDiscoveries={updateDiscoveries}
        focusMover={focusMover}
        baseline={baseline}
        targetName={targetName}
        coordinates={coordinates}
        onCoordinates={(next, name) => {
          setCoordinates(next);
          if (name) setTargetName(name);
        }}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden text-[var(--deck-text)]" style={{ background: "var(--deck-bg)" }}>
      {/* ---------------------------------------------------------- top bar */}
      <a href="#sky-view" className="deck-skip-link">
        Skip to sky view
      </a>
      <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 overflow-hidden border-b border-[var(--deck-line-soft)] px-5 py-3">
        <div className="flex shrink-0 items-center gap-2.5">
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt=""
          aria-hidden="true"
          className="size-8 rounded-full object-cover"
        />
          <div>
            <span className="block text-[14px] font-semibold tracking-tight">Sky Spotter</span>
            <span className="block text-[11px] text-[var(--deck-dim)]">Find worlds that move</span>
          </div>
          <button
            type="button"
            className="ml-2 hidden rounded-lg px-2.5 py-2 text-[12px] text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)] sm:block"
            onClick={() => setShowWelcome(true)}
          >
            Home
          </button>
        </div>

        <nav className="ml-3 flex items-center gap-1" aria-label="Main navigation">
          <button
            type="button"
            onClick={() => setActiveNav("explore")}
            aria-current={activeNav === "explore" ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-[13px] transition-colors ${
              activeNav === "explore"
                ? "bg-[var(--deck-raised)] text-[var(--deck-text)]"
                : "text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
            }`}
          >
            Explore
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveNav("learn");
              setGuideOpen(true);
            }}
            className="rounded-lg px-3 py-2 text-[13px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
          >
            How it works
          </button>
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hidden min-h-[38px] max-w-[190px] items-center gap-2 rounded-md border border-[var(--deck-line)] px-3 text-left text-[13px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)] lg:flex"
              aria-label="Choose sky field"
            >
              <span className="truncate">{field.name}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60 border-[var(--deck-line)] bg-[var(--deck-panel)] text-[var(--deck-text)]">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.16em] text-[var(--deck-dim)]">
              Choose a sky field
            </DropdownMenuLabel>
            {FIELDS.map((f) => (
              <DropdownMenuItem
                key={f.id}
                onClick={() => setFieldId(f.id)}
                className="cursor-pointer text-[13px] focus:bg-[var(--deck-raised)] focus:text-[var(--deck-text)]"
              >
                <span className="flex-1">{f.name}</span>
                {f.id === fieldId && <Check className="size-3.5 text-[var(--deck-accent)]" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <GhostButton
            onClick={() => runExample(EXAMPLES[0])}
            title="Load a worked example with a known moving body"
          >
            <Play className="mr-1.5 inline size-3.5" />
            Example
          </GhostButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-[34px] items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-[13px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
                aria-label="Open learning tools"
              >
                <GraduationCap className="size-3.5" />
                Learn
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 border-[var(--deck-line)] bg-[var(--deck-panel)] text-[var(--deck-text)]">
              <DropdownMenuItem onClick={() => setTourOpen(true)} className="cursor-pointer text-[13px] focus:bg-[var(--deck-raised)] focus:text-[var(--deck-text)]">
                Guided tour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={intro.replay} className="cursor-pointer text-[13px] focus:bg-[var(--deck-raised)] focus:text-[var(--deck-text)]">
                Replay intro
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGuideOpen(true)} className="cursor-pointer text-[13px] focus:bg-[var(--deck-raised)] focus:text-[var(--deck-text)]">
                Plain-English guide
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setExplainerOpen(true)} className="cursor-pointer text-[13px] focus:bg-[var(--deck-raised)] focus:text-[var(--deck-text)]">
                Cosmic explainer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <NeoWsInline />
          <DiscoveryLog entries={entries} onChange={updateDiscoveries} />
          <GhostButton
            onClick={() => setLogOpen(true)}
            title={selected ? `Mark ${selected.name}` : "Select a body first"}
          >
            <Asterisk className="mr-1.5 inline size-3.5 text-[var(--deck-accent)]" />
            Mark
          </GhostButton>
          <span className="mx-1 h-4 w-px bg-[var(--deck-line)]" />
          <IconButton onClick={() => sound.setOn(!sound.on)} label="Toggle sound">
            {sound.on ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          </IconButton>
        </div>
      </header>

      <div className="deck-layout flex min-h-0 flex-1">
        {/* ------------------------------------------------------ left rail */}
        <aside className="deck-scroll w-[258px] shrink-0 overflow-y-auto border-r border-[var(--deck-line-soft)]" style={{ background: "var(--deck-panel)" }}>
          <div className="px-4 py-4">
            <p className="text-[18px] font-medium leading-snug text-[var(--deck-text)]">
              Start here
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--deck-muted)]">
              Find a moving object in three simple steps.
            </p>
            <ol className="mt-4 space-y-3" aria-label="How to use Sky Spotter">
              {[
                ["1", "Choose a place", "Pick a patch of sky."],
                ["2", "Choose two pictures", "Use the dates already selected."],
                ["3", "Press play", "A moving object will jump."],
              ].map(([number, title, body]) => (
                <li key={number} className="flex gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--deck-accent)] text-[11px] font-semibold text-[var(--deck-bg)]">
                    {number}
                  </span>
                  <span>
                    <strong className="block text-[12px] font-medium text-[var(--deck-text)]">{title}</strong>
                    <span className="block text-[11px] text-[var(--deck-dim)]">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 border-t border-[var(--deck-line-soft)] pt-3 text-[11px] leading-relaxed text-[var(--deck-dim)]">
              {field.blurb}
            </p>
          </div>

          <Rail
            title="Try an example"
            action={
              activeExample ? (
                <button
                  onClick={() => {
                    setExampleId(null);
                    setDemoBeat(null);
                  }}
                  className="font-mono text-[10px] text-[var(--deck-dim)] hover:text-[var(--deck-text)]"
                >
                  clear
                </button>
              ) : (
                <span className="font-mono text-[10px] text-[var(--deck-dim)]">{EXAMPLES.length} real bodies</span>
              )
            }
          >
            <p className="mb-3 text-[11px] leading-relaxed text-[var(--deck-dim)]">
              Every one of these is a real SPHEREx field with a real body in it, and
              every separation was measured from the two exposures' own dates. Pick one
              and it loads the field, picks the epoch pair and shows you the motion.
            </p>
            <div className="space-y-px overflow-hidden rounded-md border border-[var(--deck-line)]">
              {EXAMPLES.map((ex) => {
                const f = getField(ex.fieldId);
                const aDate = f.epochs[Math.min(ex.a, f.epochs.length - 1)].date;
                const bDate = f.epochs[Math.min(ex.b, f.epochs.length - 1)].date;
                const isActive = activeExample?.id === ex.id;
                return (
                  <div
                    key={ex.id}
                    className={`px-3 py-2.5 transition-colors ${
                      isActive ? "bg-[var(--deck-raised)]" : "hover:bg-[var(--deck-raised)]/60"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[11px] text-[var(--deck-text)]">
                        {f.members[0]?.label ?? ex.fieldId}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--deck-accent)]">
                        {ex.sepDeg >= 1 ? `${ex.sepDeg.toFixed(2)}°` : `${(ex.sepDeg * 60).toFixed(1)}′`}
                        <span className="text-[var(--deck-dim)]"> / {ex.days} d</span>
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] text-[var(--deck-dim)]">
                      {f.name} · {aDate} → {bDate}
                    </p>
                    {isActive && (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--deck-muted)]">{ex.why}</p>
                    )}
                    <div className="mt-2">
                      <GhostButton active={isActive} onClick={() => runExample(ex)}>
                        {isActive ? "Show me again" : "Show me"}
                      </GhostButton>
                    </div>
                  </div>
                );
              })}
            </div>
          </Rail>

          <Rail title="Choose a place">
            <div className="mb-4 space-y-px overflow-hidden rounded-md border border-[var(--deck-line)]">
              {FIELDS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFieldId(f.id)}
                  className={`flex min-h-[38px] w-full items-baseline justify-between gap-2 px-3 py-2.5 text-left transition-colors ${
                    f.id === fieldId
                      ? "bg-[var(--deck-raised)] text-[var(--deck-text)]"
                      : "text-[var(--deck-muted)] hover:bg-[var(--deck-raised)]/60"
                  }`}
                >
                  <span className="truncate text-[13px]">{f.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--deck-dim)]">
                    {f.members[0]?.designation}
                  </span>
                </button>
              ))}
            </div>
            <Readout
              rows={[
                ["α", formatRa(centre.ra)],
                ["δ", formatDec(centre.dec)],
                ["galactic b", `${galactic.toFixed(1)}°`],
                ["field of view", `${view.fovDeg.toFixed(2)}°`],
              ]}
            />
          </Rail>

          <Rail
            title="Compare pictures"
            action={
              <span className="text-right text-[10px] text-[var(--deck-dim)]">
                {COMPARE_MODES.find((m) => m.id === compare)?.hint}
              </span>
            }
          >
            <Option
              options={COMPARE_MODES.map((m) => ({ id: m.id, label: m.label }))}
              value={compare}
              onChange={setCompare}
              columns={2}
            />
            {compare === "blink" && (
              <div className="mt-3">
                <Option
                  options={[
                    { id: "play", label: "Keep flashing" },
                    { id: "hold", label: "Stop" },
                  ]}
                  value={playing ? "play" : "hold"}
                  onChange={(v) => {
                    setPlaying(v === "play");
                    if (v === "play") setFollow(false);
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <GhostButton active={follow} onClick={() => setFollow((f) => !f)}>
                    Keep it centred
                  </GhostButton>
                </div>
              </div>
            )}
          </Rail>

          <Rail
            title="Choose pictures"
            action={
              <span className="font-mono text-[10px] text-[var(--deck-dim)]">{baseline} days apart</span>
            }
          >
            <p className="mb-3 text-[11px] leading-relaxed text-[var(--deck-dim)]">
              Pick two. <span className="text-[var(--deck-accent)]">A</span> is the first
              picture, <span className="text-[var(--deck-text)]">B</span> is the second.
              Everything that moved is something new.
            </p>
            <div className="mb-3 space-y-px overflow-hidden rounded-md border border-[var(--deck-line)]">
              {field.epochs.map((e, i) => {
                const isA = i === aIdx;
                const isB = i === bIdx;
                return (
                  <div
                    key={e.key}
                    className={`flex items-center gap-2 px-2 py-1.5 ${
                      isA || isB ? "bg-[var(--deck-raised)]" : ""
                    }`}
                  >
                    <span className="w-4 shrink-0 font-mono text-[10px] text-[var(--deck-dim)]">
                      S{i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--deck-text)]">
                      {e.date}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-[var(--deck-dim)]">
                      {e.visit.replace("20", "’")}
                    </span>
                    <button
                      onClick={() => {
                        setAIdx(i);
                        if (bIdx === i) setBIdx(aIdx);
                      }}
                      title={`Use ${e.date} as the first picture (A)`}
                      className={`grid size-8 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold transition-colors ${
                        isA
                          ? "bg-[var(--deck-accent)] text-[var(--deck-bg)]"
                          : "text-[var(--deck-dim)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
                      }`}
                    >
                      A
                    </button>
                    <button
                      onClick={() => {
                        setBIdx(i);
                        if (aIdx === i) setAIdx(bIdx);
                      }}
                      title={`Use ${e.date} as the second picture (B)`}
                      className={`grid size-8 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold transition-colors ${
                        isB
                          ? "bg-[var(--deck-text)] text-[var(--deck-bg)]"
                          : "text-[var(--deck-dim)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
                      }`}
                    >
                      B
                    </button>
                  </div>
                );
              })}
            </div>
            <Readout
              rows={[
                ["A · first", `${epoch1} · ${epochA.visit}`],
                ["B · second", `${epoch2} · ${epochB.visit}`],
                ["time between", `${baseline} days`],
              ]}
            />
            {compare === "blink" && (
              <div className="mt-3">
                <Option
                  options={[
                    { id: "a", label: "Show A" },
                    { id: "b", label: "Show B" },
                  ]}
                  value={epoch === 0 ? "a" : "b"}
                  onChange={(v) => {
                    setEpoch(v === "a" ? 0 : 1);
                    setPlaying(false);
                  }}
                />
              </div>
            )}
          </Rail>

          <Rail
            title="Animation speed"
            action={<span className="font-mono text-[10px] text-[var(--deck-dim)]">{(intervalMs / 1000).toFixed(2)}s</span>}
            collapsible
            defaultOpen={false}
          >
            <Option
              options={SPEEDS.map((s) => ({ id: String(s.ms), label: s.label }))}
              value={String(intervalMs)}
              onChange={(v) => setIntervalMs(Number(v))}
              columns={3}
            />
            <input
              type="range"
              min={150}
              max={2000}
              step={50}
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="deck-range mt-4 w-full"
              aria-label="Blink interval"
            />
          </Rail>

          <Rail title="More display options" collapsible defaultOpen={false}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Option
                options={FILTERS.map((f) => ({ id: f.id, label: f.label }))}
                value={tone}
                onChange={setTone}
                columns={3}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <GhostButton active={showGrid} onClick={() => setShowGrid((g) => !g)}>
                Grid
              </GhostButton>
              <GhostButton active={onlyInFrame} onClick={() => setOnlyInFrame((v) => !v)}>
                In frame only
              </GhostButton>
            </div>
          </Rail>

          <Rail title="Sky map" collapsible defaultOpen={false}>
            <AllSkyLocator ra={centre.ra} dec={centre.dec} />
          </Rail>
        </aside>

        {/* --------------------------------------------------------- canvas */}
        <main id="sky-view" className="relative min-w-0 flex-1" aria-label="Interactive sky view">
          <SkyCanvas
            a={{
              header: expA.header,
              plane: expA.plane,
              label: `A · ${epochA.visit} · ${epoch1}`,
              short: `A · ${epoch1}`,
            }}
            b={{
              header: expB.header,
              plane: expB.plane,
              label: `B · ${epochB.visit} · ${epoch2}`,
              short: `B · ${epoch2}`,
            }}
            compare={compare}
            view={view}
            tone={tone}
            epoch={epoch}
            movers={visible}
            selectedId={effectiveSelectedId}
            onSelect={selectMover}
            onViewChange={setView}
            onGeometry={onGeometry}
            aDate={epoch1}
            bDate={epoch2}
            showGrid={showGrid}
            busy={status !== "ready" && status !== "error"}
          />

          <div className="pointer-events-none absolute left-5 top-5 font-mono text-[10px] text-[var(--deck-dim)]">
            <p>α {formatRa(centre.ra)}</p>
            <p className="mt-0.5">δ {formatDec(centre.dec)}</p>
            <p className="mt-0.5">
              FOV {view.fovDeg.toFixed(2)}° · PSF {header ? header.psfFwhmArcsec.toFixed(1) : "—"}″
            </p>
          </div>

          <div className="pointer-events-none absolute right-5 top-5 text-right font-mono text-[10px]">
            <p className="text-[var(--deck-ok)]">archive · {status === "ready" ? "live" : status}</p>
            <p className="mt-0.5 text-[var(--deck-dim)]">{header ? header.obsid : "—"}</p>
            {moversError && (
              // The real message matters: "horrizons error" on its own gave no
              // way to tell a JPL outage from a cache or schema fault.
              <p
                className="mt-0.5 max-w-[38ch] truncate text-[var(--deck-bad)]"
                title={moversError}
              >
                horizons · {moversError}
              </p>
            )}
          </div>

          <div className="absolute bottom-5 left-5 flex flex-col gap-px overflow-hidden rounded-md border border-[var(--deck-line)]">
            <IconButton onClick={() => setView((v) => ({ ...v, fovDeg: Math.max(0.15, v.fovDeg / 1.4) }))} label="Zoom in">
              +
            </IconButton>
            <IconButton onClick={() => setView((v) => ({ ...v, fovDeg: Math.min(maxFov, v.fovDeg * 1.4) }))} label="Zoom out">
              −
            </IconButton>
            <IconButton
              onClick={() => setPlaying((p) => !p)}
              label={playing ? "Pause" : "Play"}
              active
            >
              <Play className="size-3.5" />
            </IconButton>
            <IconButton onClick={() => setShowGrid((g) => !g)} label="Grid" active={showGrid}>
              <Grid3x3 className="size-3.5" />
            </IconButton>
            <IconButton
              onClick={() => setView({ ra: centre.ra, dec: centre.dec, fovDeg: geometry.fitFov })}
              label="Frame the whole detector"
            >
              <RotateCcw className="size-3.5" />
            </IconButton>
            <IconButton
              onClick={() => setView({ ra: centre.ra, dec: centre.dec, fovDeg: view.fovDeg })}
              label="Centre on field"
            >
              <Crosshair className="size-3.5" />
            </IconButton>
          </div>

          {status === "error" && (
            <div className="absolute inset-0 grid place-items-center bg-[var(--deck-bg)]/90 p-8 text-center">
              <div className="max-w-sm space-y-2">
                <p className="text-sm">The SPHEREx archive did not respond.</p>
                <p className="text-xs text-[var(--deck-dim)]">{error}</p>
              </div>
            </div>
          )}

          {status !== "ready" && status !== "error" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--deck-dim)]">
                {status === "header" ? "reading archive header" : "reading 16 MB of sky"}
              </p>
            </div>
          )}

          <Intro
            open={intro.open}
            onDismiss={intro.dismiss}
            onStart={() => {
              intro.dismiss();
              runExample(EXAMPLES[0]);
            }}
          />

          {selected && motion && (
            <div className="pointer-events-auto absolute bottom-5 left-1/2 z-30 w-[min(540px,calc(100%-2.5rem))] -translate-x-1/2 rounded-lg border border-[var(--deck-line)] p-4" style={{ background: "var(--deck-panel)" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-medium">{selected.name}</h3>
                  <p className="mt-1 text-[12px] text-[var(--deck-muted)]">
                    {selected.class ?? "solar system body"}
                    {selected.diameterKm
                      ? ` · ${selected.diameterKm > 1 ? `${selected.diameterKm.toFixed(0)} km` : `${Math.round(selected.diameterKm * 1000)} m`} across`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectionClosed(true);
                    setSelectedId(null);
                  }}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--deck-dim)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
                  aria-label="Close selected object"
                  title="Close selected object"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-3.5 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-[var(--deck-line)]">
                <Stat label="Coordinates" value={`${formatRa(here(selected, epoch).ra).slice(0, 8)} ${formatDec(here(selected, epoch).dec).slice(0, 9)}`} />
                <Stat label="Magnitude" value={magnitude !== null ? `${magnitude.toFixed(2)} mag` : "—"} />
                <Stat label="Motion" value={`${formatAngle(motion.separationDeg)}`} accent />
              </div>

              <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
                <GhostButton onClick={() => focusMover(selected)}>Frame both epochs</GhostButton>
                <GhostButton active={follow} onClick={() => setFollow((f) => !f)}>
                  Follow while blinking
                </GhostButton>
                <button
                  onClick={() => setLogOpen(true)}
                  className="ml-auto rounded-md bg-[var(--deck-text)] px-3 py-1.5 text-[12px] text-[var(--deck-bg)] transition-opacity hover:opacity-85"
                >
                  Mark candidate
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ------------------------------------------------------ bottom bar */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--deck-line-soft)] px-5 py-3">
        <div className="min-w-[128px]">
          <p className="flex items-center gap-2 text-[12px] font-medium">
            <span
              className="size-3 shrink-0 rounded-full border border-[var(--deck-line)]"
              style={{ background: bandColour(lambda) }}
            />
            Band {band + 1} <span className="text-[var(--deck-dim)]">· {lambda.toFixed(2)} µm</span>
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--deck-dim)]">
            flux {curve[band].toFixed(3)} · {bandPlainName(lambda)}
          </p>
        </div>

        <BandSlider band={band} onChange={setBand} />

        <div className="flex flex-wrap items-center gap-1.5">
          {MARKERS.slice(0, 4).map((m) => (
            <button
              key={m.name}
              onClick={() => {
                const i = BAND_WAVELENGTHS.findIndex((l) => l >= m.centre);
                if (i >= 0) setBand(i);
              }}
              title={`Jump to the ${m.name} band, near ${m.centre.toFixed(2)} µm`}
              className="rounded-md px-2.5 py-1.5 text-[12px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
            >
              {m.name}
            </button>
          ))}
        </div>

        <p className="ml-auto font-mono text-[10px] text-[var(--deck-dim)]">
          {composition === "ice" ? "volatile ice" : composition === "gas" ? "gas giant" : "silicate rock"} ·
          strongest {marker.name} · SPHEREx QR2 · JPL Horizons
        </p>
      </footer>

      {selected && (
        <LogDialog
          mover={selected}
          open={logOpen}
          onOpenChange={setLogOpen}
          epoch1={epoch1}
          epoch2={epoch2}
          field={{ id: field.id, name: field.name }}
          baselineDays={baseline}
          onSave={(d) => updateDiscoveries([d, ...entries])}
        />
      )}
      <TourDialog open={tourOpen} onOpenChange={setTourOpen} step={tourStep} setStep={setTourStep} />
      <BeginnerGuide open={guideOpen} onOpenChange={setGuideOpen} />
      <ExplainerDialog open={explainerOpen} onOpenChange={setExplainerOpen} />
    </div>
  );
}

/**
 * The colour-band slider, built for someone who has never seen a spectrograph.
 *
 * A bare 1px range input is invisible and has a nine-pixel target. This one is a
 * colour bar you can see, with a fat handle, a stepper on each side for anyone who
 * would rather not drag, and plain words under the ends saying which way is which.
 */
function BandSlider({ band, onChange }: { band: number; onChange: (n: number) => void }) {
  const step = (d: number) => onChange(Math.max(0, Math.min(BAND_COUNT - 1, band + d)));
  return (
    <div className="flex min-w-[300px] flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => step(-1)}
          disabled={band === 0}
          aria-label="Previous colour band"
          title="Previous band"
          className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--deck-line)] text-[15px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="relative flex-1">
          {/* The colour bar the handle rides on. */}
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
            style={{
              background: `linear-gradient(to right, ${BAND_WAVELENGTHS.map(
                (l) => `${bandColour(l)} ${(((l - BAND_WAVELENGTHS[0]) / (BAND_WAVELENGTHS[BAND_COUNT - 1] - BAND_WAVELENGTHS[0])) * 100).toFixed(1)}%`,
              ).join(", ")})`,
              opacity: 0.55,
            }}
          />
          <input
            type="range"
            min={0}
            max={BAND_COUNT - 1}
            value={band}
            onChange={(e) => onChange(Number(e.target.value))}
            className="deck-range deck-range-fat relative w-full"
            aria-label="Colour band"
          />
        </div>

        <button
          onClick={() => step(1)}
          disabled={band === BAND_COUNT - 1}
          aria-label="Next colour band"
          title="Next band"
          className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--deck-line)] text-[15px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)] disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="flex items-baseline justify-between pl-11 pr-11 text-[10px] text-[var(--deck-dim)]">
        <span className="inline-flex items-center gap-1"><ChevronLeft className="size-3" /> shorter · {BAND_WAVELENGTHS[0].toFixed(2)} µm</span>
        <span className="inline-flex items-center gap-1">{BAND_WAVELENGTHS[BAND_COUNT - 1].toFixed(2)} µm · longer <ChevronRight className="size-3" /></span>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-[var(--deck-panel-2)] px-3 py-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-[var(--deck-dim)]">{label}</p>
      <p className={`mt-0.5 font-mono text-[11px] ${accent ? "text-[var(--deck-accent)]" : "text-[var(--deck-text)]"}`}>
        {value}
      </p>
    </div>
  );
}

function here(m: Mover, epoch: 0 | 1) {
  return m[epoch === 0 ? "epoch1" : "epoch2"];
}

/** Live NEO feed, collapsed to a single quiet status pill in the top bar. */
function NeoWsInline() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GhostButton onClick={() => setOpen(true)} title="Near-Earth object traffic">
        <Search className="mr-1.5 inline size-3.5" />
        NEO traffic
      </GhostButton>
      {open && <NeoWsSheet onClose={() => setOpen(false)} />}
    </>
  );
}

type Feed = {
  rows: {
    name: string;
    hazardous: boolean;
    diameterKm: number | null;
    velocityKph: number | null;
    missDistanceKm: number | null;
    approachDate: string | null;
  }[];
  tier: "key" | "demo";
  latencyMs: number;
  error?: string;
};

function NeoWsSheet({ onClose }: { onClose: () => void }) {
  const getNeoFeed = useAction(api.neows.getNeoFeed);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getNeoFeed({ days: 7 })
      .then((r) => {
        if (!cancelled) setFeed(r as Feed);
      })
      .catch((e: Error) => {
        if (!cancelled) setFeed({ rows: [], tier: "demo", latencyMs: 0, error: e.message });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getNeoFeed]);

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-[var(--deck-bg)]/80 p-8" onClick={onClose}>
      <div
        className="deck-scroll max-h-[70vh] w-[min(560px,100%)] overflow-y-auto rounded-lg border border-[var(--deck-line)] p-5"
        style={{ background: "var(--deck-panel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[14px] font-medium">Near-Earth object traffic</h2>
          <button onClick={onClose} className="text-[var(--deck-dim)] hover:text-[var(--deck-text)]" aria-label="Close">
            ✕
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--deck-dim)]">
          Objects passing within 1.5 AU of Earth over the next seven days, from NASA&apos;s
          Near-Earth Object Web Service.
        </p>

        {feed && (
          <p className="mt-3 font-mono text-[10px] text-[var(--deck-dim)]">
            {feed.tier === "key" ? "personal key" : "anonymous demo tier — rate limited"} · {feed.latencyMs} ms ·{" "}
            {feed.rows.length} objects
          </p>
        )}

        {loading ? (
          <p className="mt-6 font-mono text-[11px] text-[var(--deck-dim)]">contacting NeoWs…</p>
        ) : feed?.error ? (
          <p className="mt-6 text-[12px] text-[var(--deck-bad)]">{feed.error}</p>
        ) : feed?.rows.length === 0 ? (
          <p className="mt-6 text-[12px] text-[var(--deck-muted)]">No approaches this week. Quiet sky.</p>
        ) : (
          <ul className="mt-5 space-y-px overflow-hidden rounded-md border border-[var(--deck-line)]">
            {feed?.rows.map((r) => (
              <li key={r.name} className="flex items-baseline justify-between gap-3 bg-[var(--deck-panel-2)] px-3 py-2">
                <span className="min-w-0 truncate text-[12px] text-[var(--deck-text)]">
                  {r.name}
                  {r.hazardous && <span className="ml-2 text-[10px] text-[var(--deck-accent)]">hazardous</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--deck-dim)]">
                  {r.diameterKm !== null ? `${Math.round(r.diameterKm * 1000)} m` : "—"} ·{" "}
                  {r.velocityKph !== null ? `${Math.round(r.velocityKph).toLocaleString()} km/h` : "—"} ·{" "}
                  {r.missDistanceKm !== null ? `${Math.round(r.missDistanceKm).toLocaleString()} km` : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
