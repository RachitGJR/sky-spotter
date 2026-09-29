import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { readHeader, readPlane, type SkyPlane, type SpherexHeader } from "@/lib/spherex/archive";
import { addDays, formatAngle, formatDec, formatRa, project, separation, shortDate } from "@/lib/spherex/astro";
import { FIELDS, SURVEY_REPEAT_DAYS, getField } from "@/lib/spherex/fields";
import { apparentMagnitude, motionOf, type Mover } from "@/lib/spherex/movers";
import { SkyCanvas, type Tone, type View } from "@/components/sky/SkyCanvas";
import {
  BAND_COUNT,
  BAND_WAVELENGTHS,
  MARKERS,
  defaultComposition,
  modelSpectrum,
  strongestMarker,
} from "@/components/sky/SpectralScrubber";
import {
  AllSkyLocator,
  BeginnerGuide,
  DiscoveryLog,
  ExplainerDialog,
  LogDialog,
  TourDialog,
  useDiscoveryLog,
  useSound,
} from "@/components/sky/Workbench";
import { Intro, useIntro } from "@/components/sky/Intro";
import {
  Aperture,
  Asterisk,
  Crosshair,
  Grid3x3,
  GraduationCap,
  Play,
  RotateCcw,
  Search,
  Volume2,
  VolumeX,
} from "lucide-react";
import "./console.css";

/* ------------------------------------------------------------------ *
 * Presentational pieces — flat, hairline, no fills but the active one
 * ------------------------------------------------------------------ */

function Rail({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--deck-line-soft)] px-5 py-5">
      <div className="mb-3.5 flex items-center justify-between">
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
            className={`px-2.5 py-2 text-left transition-colors ${
              active
                ? "bg-[var(--deck-text)] text-[var(--deck-bg)]"
                : "bg-transparent text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
            }`}
          >
            <span className="block text-[12px] leading-tight">{o.label}</span>
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
      className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] transition-colors ${
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
      className={`grid size-8 shrink-0 place-items-center rounded-md transition-colors ${
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

/* ------------------------------------------------------------------ *
 * The console
 * ------------------------------------------------------------------ */

export default function Console() {
  const [fieldId, setFieldId] = useState(FIELDS[0].id);
  const field = useMemo(() => getField(fieldId), [fieldId]);

  const [header, setHeader] = useState<SpherexHeader | null>(null);
  const [plane, setPlane] = useState<SkyPlane | null>(null);
  const [status, setStatus] = useState<"header" | "plane" | "ready" | "error">("header");
  const [error, setError] = useState<string | null>(null);

  const [epoch, setEpoch] = useState<0 | 1>(0);
  const [playing, setPlaying] = useState(true);
  const [intervalMs, setIntervalMs] = useState(950);
  const [tone, setTone] = useState<Tone>("ink");
  const [showGrid, setShowGrid] = useState(true);
  const [follow, setFollow] = useState(false);
  const [onlyInFrame, setOnlyInFrame] = useState(false);
  const [band, setBand] = useState(28);
  const [view, setView] = useState<View>({ ra: field.fallbackRa, dec: field.fallbackDec, fovDeg: 3.15 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
    document.documentElement.classList.add("dark");
  }, []);

  /* --- the archive ------------------------------------------------------ */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setStatus("header");
    setError(null);
    setHeader(null);
    setPlane(null);
    setSelectedId(null);
    setView({ ra: field.fallbackRa, dec: field.fallbackDec, fovDeg: 3.15 });

    (async () => {
      try {
        const h = await readHeader(field, controller.signal);
        if (cancelled) return;
        setHeader(h);
        setStatus("plane");
        const p = await readPlane(h, 510, controller.signal);
        if (cancelled) return;
        setPlane(p);
        setStatus("ready");
      } catch (e) {
        if (cancelled || controller.signal.aborted) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not read the SPHEREx archive.");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [field]);

  const epoch1 = header ? header.dateObs.slice(0, 10) : "";
  const epoch2 = header ? addDays(epoch1, SURVEY_REPEAT_DAYS) : "";

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

  const selected = movers.find((m) => m.id === selectedId) ?? null;
  const motion = selected ? motionOf(selected, SURVEY_REPEAT_DAYS) : null;

  const focusMover = useCallback((m: Mover) => {
    const a = project(m.epoch1.ra, m.epoch1.dec, m.epoch2.ra, m.epoch2.dec);
    setView({
      ra: m.epoch1.ra,
      dec: m.epoch1.dec,
      fovDeg: Math.min(8, Math.max(0.3, Math.hypot(a.x, a.y) * 1.7)),
    });
  }, []);

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
        setView((v) => ({ ...v, fovDeg: Math.min(8, v.fovDeg * 1.3) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  return (
    <div className="flex h-screen flex-col overflow-hidden text-[var(--deck-text)]" style={{ background: "var(--deck-bg)" }}>
      {/* ---------------------------------------------------------- top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--deck-line-soft)] px-5 py-2.5">
        <div className="flex shrink-0 items-baseline gap-2.5">
          <Aperture className="size-4 translate-y-0.5 text-[var(--deck-accent)]" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.22em]">SPHEREx</span>
          <span className="text-[12px] text-[var(--deck-dim)]">Blink Comparator</span>
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          <span className="h-4 w-px shrink-0 bg-[var(--deck-line)]" />
          {FIELDS.map((f) => (
            <GhostButton key={f.id} active={f.id === fieldId} onClick={() => setFieldId(f.id)}>
              {f.name}
            </GhostButton>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <GhostButton onClick={() => { setTourStep(0); setTourOpen(true); }} title="Guided walkthrough">
            <GraduationCap className="mr-1.5 inline size-3.5" />
            Tour
          </GhostButton>
          <GhostButton onClick={intro.replay} title="Replay the introduction">
            Intro
          </GhostButton>
          <GhostButton onClick={() => setGuideOpen(true)} title="Plain-English guide">
            What am I seeing?
          </GhostButton>
          <GhostButton onClick={() => setExplainerOpen(true)}>Explainer</GhostButton>
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

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------ left rail */}
        <aside className="deck-scroll w-[286px] shrink-0 overflow-y-auto border-r border-[var(--deck-line-soft)]" style={{ background: "var(--deck-panel)" }}>
          <div className="px-5 py-5">
            <p className="text-[15px] leading-snug text-[var(--deck-text)]">
              Find what moves while the stars hold still.
            </p>
            <p className="mt-2.5 text-[12px] leading-relaxed text-[var(--deck-dim)]">{field.blurb}</p>
          </div>

          <Rail title="Target field">
            <div className="mb-4 space-y-px overflow-hidden rounded-md border border-[var(--deck-line)]">
              {FIELDS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFieldId(f.id)}
                  className={`flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left transition-colors ${
                    f.id === fieldId
                      ? "bg-[var(--deck-raised)] text-[var(--deck-text)]"
                      : "text-[var(--deck-muted)] hover:bg-[var(--deck-raised)]/60"
                  }`}
                >
                  <span className="truncate text-[12px]">{f.name}</span>
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

          <Rail title="Observation mode">
            <Option
              options={[
                { id: "blink", label: "Blink" },
                { id: "freeze", label: "Freeze" },
                { id: "follow", label: "Follow" },
              ]}
              value={playing ? "blink" : follow ? "follow" : "freeze"}
              onChange={(v) => {
                if (v === "blink") {
                  setPlaying(true);
                  setFollow(false);
                }
                if (v === "freeze") {
                  setPlaying(false);
                  setFollow(false);
                }
                if (v === "follow") {
                  setFollow(true);
                  setPlaying(true);
                }
              }}
            />
          </Rail>

          <Rail title="Survey epoch">
            <Option
              options={[
                { id: "a", label: "Epoch A", meta: shortDate(epoch1) },
                { id: "b", label: "Epoch B", meta: shortDate(epoch2) },
              ]}
              value={epoch === 0 ? "a" : "b"}
              onChange={(v) => {
                setEpoch(v === "a" ? 0 : 1);
                setPlaying(false);
              }}
            />
          </Rail>

          <Rail title="Blink speed" action={<span className="font-mono text-[10px] text-[var(--deck-dim)]">{(intervalMs / 1000).toFixed(2)}s / epoch</span>}>
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

          <Rail title="Display">
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

          <Rail title="Where this is">
            <AllSkyLocator ra={centre.ra} dec={centre.dec} />
          </Rail>
        </aside>

        {/* --------------------------------------------------------- canvas */}
        <main className="relative min-w-0 flex-1">
          <SkyCanvas
            header={header}
            plane={plane}
            view={view}
            tone={tone}
            epoch={epoch}
            epochLabels={[
              `EPOCH A · ${shortDate(epoch1)}`,
              `EPOCH B · ${shortDate(epoch2)} · +${SURVEY_REPEAT_DAYS} d`,
            ]}
            movers={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onViewChange={setView}
            showGrid={showGrid}
            busy={status === "header" || status === "plane"}
          />

          <div className="pointer-events-none absolute left-5 top-5 font-mono text-[10px] text-[var(--deck-dim)]">
            <p>α {formatRa(centre.ra)}</p>
            <p className="mt-0.5">δ {formatDec(centre.dec)}</p>
            <p className="mt-0.5">FOV {view.fovDeg.toFixed(2)}° · PSF {header ? header.psfFwhmArcsec.toFixed(1) : "—"}″</p>
          </div>

          <div className="pointer-events-none absolute right-5 top-5 text-right font-mono text-[10px]">
            <p className="text-[var(--deck-ok)]">
              archive · {status === "ready" ? "live" : status}
            </p>
            <p className="mt-0.5 text-[var(--deck-dim)]">{header ? header.obsid : "—"}</p>
            {moversError && <p className="mt-0.5 text-[var(--deck-bad)]">horizons · error</p>}
          </div>

          <div className="absolute bottom-5 left-5 flex flex-col gap-px overflow-hidden rounded-md border border-[var(--deck-line)]">
            <IconButton onClick={() => setView((v) => ({ ...v, fovDeg: Math.max(0.15, v.fovDeg / 1.4) }))} label="Zoom in">
              +
            </IconButton>
            <IconButton onClick={() => setView((v) => ({ ...v, fovDeg: Math.min(8, v.fovDeg * 1.4) }))} label="Zoom out">
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
              onClick={() => header && setView({ ra: header.ra, dec: header.dec, fovDeg: 3.15 })}
              label="Reset view"
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
              setPlaying(true);
            }}
          />

          {selected && motion && (
            <div className="absolute bottom-5 left-1/2 w-[min(540px,calc(100%-2.5rem))] -translate-x-1/2 rounded-lg border border-[var(--deck-line)] p-4" style={{ background: "var(--deck-panel)" }}>
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
                <button onClick={() => setSelectedId(null)} className="text-[var(--deck-dim)] hover:text-[var(--deck-text)]" aria-label="Close">
                  ✕
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
          <p className="text-[12px] font-medium">
            Band {band + 1} <span className="text-[var(--deck-dim)]">· {lambda.toFixed(2)} µm</span>
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--deck-dim)]">
            flux {curve[band].toFixed(3)} · {BAND_COUNT} channels
          </p>
        </div>

        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          <input
            type="range"
            min={0}
            max={BAND_COUNT - 1}
            value={band}
            onChange={(e) => setBand(Number(e.target.value))}
            className="deck-range flex-1"
            aria-label="Spectral band"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {MARKERS.slice(0, 4).map((m) => (
            <button
              key={m.name}
              onClick={() => {
                const i = BAND_WAVELENGTHS.findIndex((l) => l >= m.centre);
                if (i >= 0) setBand(i);
              }}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--deck-muted)] transition-colors hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
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
          baselineDays={SURVEY_REPEAT_DAYS}
          onSave={(d) => updateDiscoveries([d, ...entries])}
        />
      )}
      <TourDialog open={tourOpen} onOpenChange={setTourOpen} step={tourStep} setStep={setTourStep} />
      <BeginnerGuide open={guideOpen} onOpenChange={setGuideOpen} />
      <ExplainerDialog open={explainerOpen} onOpenChange={setExplainerOpen} />
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
