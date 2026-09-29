import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { readHeader, readPlane, type SkyPlane, type SpherexHeader } from "@/lib/spherex/archive";
import { addDays, formatAngle, formatDec, formatRa, project, separation, shortDate } from "@/lib/spherex/astro";
import { FIELDS, SURVEY_REPEAT_DAYS, getField } from "@/lib/spherex/fields";
import { apparentMagnitude, motionOf, type Mover } from "@/lib/spherex/movers";
import { SkyCanvas, type Tone, type View } from "@/components/sky/SkyCanvas";
import { BAND_COUNT, BAND_WAVELENGTHS, MARKERS, strongestMarker, defaultComposition, modelSpectrum } from "@/components/sky/SpectralScrubber";
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
import {
  Aperture,
  Asterisk,
  Crosshair,
  Eye,
  Grid3x3,
  GraduationCap,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import "./console.css";

/* ------------------------------------------------------------------ *
 * Small presentational pieces
 * ------------------------------------------------------------------ */

function Rail({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--deck-line)] px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--deck-dim)]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md border px-2.5 py-1.5 text-[12px] transition-colors ${
            value === o.id
              ? "border-transparent bg-[var(--deck-violet)] text-white"
              : "border-[var(--deck-line)] text-[var(--deck-muted)] hover:border-[var(--deck-violet)] hover:text-[var(--deck-text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  tone = "violet",
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  tone?: "violet" | "cyan" | "amber" | "green";
}) {
  const colours = {
    violet: "var(--deck-violet)",
    cyan: "var(--deck-cyan)",
    amber: "var(--deck-amber)",
    green: "var(--deck-green)",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-transparent text-white"
          : "border-[var(--deck-line)] text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
      }`}
      style={active ? { background: colours } : undefined}
    >
      <span className="size-1.5 rounded-full" style={{ background: active ? "#fff" : colours }} />
      {children}
    </button>
  );
}

const SPEEDS = [
  { label: "Slow", ms: 1400 },
  { label: "Normal", ms: 950 },
  { label: "Fast", ms: 450 },
];

const FILTERS: { id: Tone; label: string }[] = [
  { id: "ink", label: "True colour" },
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
  const [search, setSearch] = useState("");
  const sound = useSound();
  const { entries, update: updateDiscoveries } = useDiscoveryLog();

  /* --- archive ---------------------------------------------------------- */
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

  /* --- ephemerides ------------------------------------------------------ */
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

  /* --- blink loop ------------------------------------------------------- */
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

  // Follow mode keeps the selected body parked at the centre while it blinks.
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
    const b = Math.asin(
      Math.sin(centre.dec * R) * Math.sin(27.13 * R) +
        Math.cos(centre.dec * R) * Math.cos(27.13 * R) * Math.sin((centre.ra - 192.86) * R),
    );
    return b / R;
  }, [centre.ra, centre.dec]);

  const composition = defaultComposition(selected);
  const curve = useMemo(() => modelSpectrum(composition), [composition]);
  const marker = strongestMarker(composition);
  const magnitude = selected ? apparentMagnitude(selected, epoch === 0 ? 1 : 2) : null;
  const lambda = BAND_WAVELENGTHS[band];

  const jumpToMarker = (centreUm: number) => {
    const i = BAND_WAVELENGTHS.findIndex((l) => l >= centreUm);
    if (i >= 0) setBand(i);
  };

  return (
    <div
      className="flex h-screen flex-col overflow-hidden text-[var(--deck-text)]"
      style={{ background: "var(--deck-bg)" }}
    >
      {/* ---------------------------------------------------------- top bar */}
      <header
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--deck-line)] px-3 py-2"
        style={{ background: "var(--deck-panel)" }}
      >
        <div className="flex items-center gap-2 pr-1">
          <span className="grid size-7 place-items-center rounded-md bg-[var(--deck-violet)]">
            <Aperture className="size-4 text-white" />
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em]">SPHEREx</span>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-[var(--deck-line)] px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-[var(--deck-cyan)]" />
          <span className="max-w-[190px] truncate text-[12px]">
            {selected ? selected.name : field.name}
          </span>
          <span className="font-mono text-[10px] text-[var(--deck-dim)]">
            S{epoch === 0 ? "1" : "2"} · Band {band + 1} ({lambda.toFixed(2)} µm)
          </span>
        </div>

        <div className="flex items-center gap-1">
          {[
            { id: "blink", label: "Blink", icon: <Zap className="size-3" />, on: playing, act: () => setPlaying((p) => !p) },
            { id: "freeze", label: epoch === 0 ? "Epoch A" : "Epoch B", icon: <Pause className="size-3" />, on: !playing, act: () => setPlaying(false) },
            { id: "follow", label: "Follow", icon: <Crosshair className="size-3" />, on: follow, act: () => setFollow((f) => !f) },
          ].map((c) => (
            <button
              key={c.id}
              onClick={c.act}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                c.on
                  ? "border-transparent bg-[var(--deck-violet)] text-white"
                  : "border-[var(--deck-line)] text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
              }`}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>

        <label className="flex min-w-[150px] flex-1 items-center gap-2 rounded-full border border-[var(--deck-line)] px-3 py-1">
          <Search className="size-3 text-[var(--deck-dim)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bodies, fields, bands…"
            className="w-full bg-transparent text-[12px] outline-none placeholder:text-[var(--deck-dim)]"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <TopButton tone="violet" onClick={() => { setTourStep(0); setTourOpen(true); }} icon={<GraduationCap className="size-3.5" />}>
            In-app demo
          </TopButton>
          <TopButton tone="amber" onClick={() => setExplainerOpen(true)} icon={<Layers className="size-3.5" />}>
            Video guide
          </TopButton>
          <TopButton tone="cyan" onClick={() => setGuideOpen(true)} icon={<Sparkles className="size-3.5" />}>
            Guide: {sound.on ? "sound" : "on"}
          </TopButton>
          <DiscoveryLog entries={entries} onChange={updateDiscoveries} />
          <button
            onClick={() => setLogOpen(true)}
            disabled={!selected}
            className="flex items-center gap-1.5 rounded-full bg-[var(--deck-violet)] px-3 py-1 text-[11px] text-white disabled:opacity-40"
          >
            <Asterisk className="size-3.5" />
            Mark
          </button>
          <button
            onClick={() => sound.setOn(!sound.on)}
            className="grid size-7 place-items-center rounded-full border border-[var(--deck-line)] text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
            aria-label="Toggle sound"
          >
            {sound.on ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------ left rail */}
        <aside
          className="deck-scroll w-[300px] shrink-0 overflow-y-auto border-r border-[var(--deck-line)]"
          style={{ background: "var(--deck-panel)" }}
        >
          <div className="space-y-0 p-3">
            <button
              onClick={() => setGuideOpen(true)}
              className="mb-2 flex w-full items-center gap-2 rounded-md border border-[var(--deck-line)] px-3 py-2 text-left text-[12px] text-[var(--deck-muted)] hover:border-[var(--deck-violet)] hover:text-[var(--deck-text)]"
            >
              <GraduationCap className="size-3.5" />
              Kid &amp; beginner guide
            </button>
            <div className="mb-3 flex items-center justify-between rounded-md bg-[var(--deck-raised)] px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--deck-cyan)]">
                Deep sky
              </span>
              <span className="text-[10px] text-[var(--deck-dim)]">moving-object mode</span>
            </div>
          </div>

          <Rail
            title="Target field"
            action={
              <button
                onClick={() => setView({ ra: field.fallbackRa, dec: field.fallbackDec, fovDeg: 3.15 })}
                className="text-[10px] text-[var(--deck-violet)] hover:underline"
              >
                reset
              </button>
            }
          >
            <div className="space-y-1">
              {FIELDS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFieldId(f.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    f.id === fieldId
                      ? "border-[var(--deck-violet)] bg-[var(--deck-raised)]"
                      : "border-transparent hover:border-[var(--deck-line)]"
                  }`}
                >
                  <div className="text-[12px]">{f.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--deck-dim)]">
                    {f.members.map((m) => m.designation).join(", ")}
                  </div>
                </button>
              ))}
            </div>
            <dl className="mt-3 space-y-1 font-mono text-[10px] text-[var(--deck-dim)]">
              <div className="flex justify-between gap-2">
                <dt>α</dt>
                <dd className="text-[var(--deck-cyan)]">{formatRa(centre.ra)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>δ</dt>
                <dd className="text-[var(--deck-cyan)]">{formatDec(centre.dec)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>b</dt>
                <dd className="text-[var(--deck-cyan)]">{galactic.toFixed(1)}°</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>FOV</dt>
                <dd className="text-[var(--deck-cyan)]">{view.fovDeg.toFixed(2)}°</dd>
              </div>
            </dl>
          </Rail>

          <Rail title="Observation mode">
            <Segmented
              options={[
                { id: "blink", label: "Blink" },
                { id: "freeze", label: "Freeze" },
                { id: "follow", label: "Follow" },
              ]}
              value={playing ? "blink" : follow ? "follow" : "freeze"}
              onChange={(v) => {
                if (v === "blink") setPlaying(true);
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
            <div className="grid grid-cols-2 gap-1">
              {[0, 1].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setEpoch(e as 0 | 1);
                    setPlaying(false);
                  }}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    epoch === e
                      ? "border-transparent bg-[var(--deck-violet)] text-white"
                      : "border-[var(--deck-line)] hover:border-[var(--deck-violet)]"
                  }`}
                >
                  <div className="text-[12px] font-semibold">{e === 0 ? "S1" : "S2"}</div>
                  <div className={`font-mono text-[10px] ${epoch === e ? "text-white/80" : "text-[var(--deck-dim)]"}`}>
                    {shortDate(e === 0 ? epoch1 : epoch2)}
                  </div>
                </button>
              ))}
            </div>
          </Rail>

          <Rail title="Blink speed">
            <div className="grid grid-cols-3 gap-1">
              {SPEEDS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setIntervalMs(s.ms)}
                  className={`rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                    intervalMs === s.ms
                      ? "border-[var(--deck-violet)] bg-[var(--deck-raised)] text-[var(--deck-text)]"
                      : "border-[var(--deck-line)] text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="font-mono text-[10px] text-[var(--deck-dim)]">fast</span>
              <input
                type="range"
                min={150}
                max={2000}
                step={50}
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="h-1 flex-1 accent-[var(--deck-violet)]"
              />
              <span className="font-mono text-[10px] text-[var(--deck-dim)]">slow</span>
            </div>
            <p className="mt-1 text-right font-mono text-[10px] text-[var(--deck-violet)]">
              {(intervalMs / 1000).toFixed(2)}s / epoch
            </p>
          </Rail>

          <Rail title="Display">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <Chip key={f.id} active={tone === f.id} onClick={() => setTone(f.id)} tone="cyan">
                  {f.label}
                </Chip>
              ))}
              <Chip active={showGrid} onClick={() => setShowGrid((g) => !g)} tone="green">
                Grid
              </Chip>
              <Chip active={onlyInFrame} onClick={() => setOnlyInFrame((v) => !v)} tone="amber">
                In frame
              </Chip>
            </div>
          </Rail>

          <Rail title="Sky context">
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
              `S1 · ${shortDate(epoch1)}`,
              `S2 · ${shortDate(epoch2)} · +${SURVEY_REPEAT_DAYS} d`,
            ]}
            movers={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onViewChange={setView}
            showGrid={showGrid}
            busy={status === "header" || status === "plane"}
          />

          {/* aperture frame */}
          <div className="pointer-events-none absolute inset-[14%] hidden sm:block">
            <div className="relative size-full">
              {[
                "left-0 top-0 border-l-2 border-t-2",
                "right-0 top-0 border-r-2 border-t-2",
                "left-0 bottom-0 border-l-2 border-b-2",
                "right-0 bottom-0 border-r-2 border-b-2",
              ].map((c) => (
                <span
                  key={c}
                  className={`absolute size-5 border-[var(--deck-text)]/45 ${c}`}
                />
              ))}
              <span className="absolute -top-5 left-0 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--deck-dim)]">
                Aperture
              </span>
            </div>
          </div>

          {/* field readout */}
          <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2 font-mono text-[10px]">
            <span className="rounded-md border border-[var(--deck-line)] bg-black/50 px-2 py-1 text-[var(--deck-muted)] backdrop-blur-sm">
              α {formatRa(centre.ra)}
            </span>
            <span className="rounded-md border border-[var(--deck-line)] bg-black/50 px-2 py-1 text-[var(--deck-muted)] backdrop-blur-sm">
              δ {formatDec(centre.dec)}
            </span>
            <span className="rounded-md border border-[var(--deck-line)] bg-black/50 px-2 py-1 text-[var(--deck-muted)] backdrop-blur-sm">
              FOV {view.fovDeg.toFixed(2)}°
            </span>
            <span className="rounded-md border border-[var(--deck-line)] bg-black/50 px-2 py-1 text-[var(--deck-muted)] backdrop-blur-sm">
              PSF {header ? header.psfFwhmArcsec.toFixed(1) : "—"}″
            </span>
          </div>

          {/* zoom cluster */}
          <div className="absolute left-4 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-[var(--deck-line)] bg-black/45 p-1 backdrop-blur-sm">
            {[
              { icon: <Crosshair className="size-4" />, act: () => setView((v) => ({ ...v, fovDeg: Math.max(0.15, v.fovDeg / 1.4) })) },
              { icon: <Search className="size-4" />, act: () => setView((v) => ({ ...v, fovDeg: Math.min(8, v.fovDeg * 1.4) })) },
            ].map((b, i) => (
              <button
                key={i}
                onClick={b.act}
                className="grid size-8 place-items-center rounded-md text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
              >
                {b.icon}
              </button>
            ))}
            <button
              onClick={() => setPlaying((p) => !p)}
              className="grid size-8 place-items-center rounded-md bg-[var(--deck-violet)] text-white"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              onClick={() => setShowGrid((g) => !g)}
              className="grid size-8 place-items-center rounded-md text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
              aria-label="Grid"
            >
              <Grid3x3 className="size-4" />
            </button>
            <button
              onClick={() => header && setView({ ra: header.ra, dec: header.dec, fovDeg: 3.15 })}
              className="grid size-8 place-items-center rounded-md text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
              aria-label="Reset"
            >
              <RotateCcw className="size-4" />
            </button>
            <button
              onClick={() => tone === "ink" ? setTone("thermal") : setTone("ink")}
              className="grid size-8 place-items-center rounded-md text-[var(--deck-muted)] hover:bg-[var(--deck-raised)] hover:text-[var(--deck-text)]"
              aria-label="Toggle false colour"
            >
              <Eye className="size-4" />
            </button>
          </div>

          {/* survey status */}
          <div className="absolute right-4 top-4 flex items-center gap-2 font-mono text-[10px]">
            <span className="rounded-full border border-[var(--deck-green)]/40 bg-black/50 px-2.5 py-1 text-[var(--deck-green)] backdrop-blur-sm">
              ARCHIVE {status === "ready" ? "live" : status}
            </span>
            <span className="rounded-full border border-[var(--deck-line)] bg-black/50 px-2.5 py-1 text-[var(--deck-muted)] backdrop-blur-sm">
              PHOTO {header ? header.obsid.slice(-9) : "—"}
            </span>
            {moversError && (
              <span className="rounded-full border border-[var(--deck-red)]/40 bg-black/50 px-2.5 py-1 text-[var(--deck-red)] backdrop-blur-sm">
                HORIZONS ERROR
              </span>
            )}
          </div>

          {/* RA / Dec ruler down the right edge */}
          <div className="pointer-events-none absolute bottom-20 right-2 top-16 hidden w-24 flex-col justify-between font-mono text-[9px] text-[var(--deck-dim)] lg:flex">
            {Array.from({ length: 9 }, (_, i) => {
              const dec = centre.dec + (4 - i) * (view.fovDeg / 8);
              return (
                <span key={i} className="flex items-center gap-1">
                  <span className="h-px w-2 bg-[var(--deck-line)]" />
                  {formatDec(dec).slice(0, 9)}
                </span>
              );
            })}
          </div>

          {status === "error" && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 p-8 text-center">
              <div className="max-w-sm space-y-2">
                <p className="text-sm font-medium">The SPHEREx archive did not respond.</p>
                <p className="text-xs text-[var(--deck-muted)]">{error}</p>
              </div>
            </div>
          )}

          {/* target card */}
          {selected && motion && (
            <div className="absolute bottom-4 left-1/2 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-[var(--deck-line)] bg-[var(--deck-panel)]/95 p-4 shadow-2xl backdrop-blur-md">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-semibold">{selected.name}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--deck-muted)]">
                    {selected.class ?? "solar system body"}
                    {selected.diameterKm
                      ? ` · ${selected.diameterKm > 1 ? `${selected.diameterKm.toFixed(0)} km` : `${Math.round(selected.diameterKm * 1000)} m`} across`
                      : ""}
                    . Crosses this field between the two survey epochs.
                  </p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="text-[var(--deck-dim)] hover:text-[var(--deck-text)]"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <CardStat
                  label="Coordinates"
                  value={`${formatRa(here(selected, epoch).ra).slice(0, 8)} ${formatDec(here(selected, epoch).dec).slice(0, 9)}`}
                />
                <CardStat label="Magnitude" value={magnitude !== null ? `${magnitude.toFixed(2)} mag` : "—"} />
                <CardStat
                  label="Motion signature"
                  value={`${formatAngle(motion.separationDeg)} · ${motion.positionAngle.toFixed(0)}°`}
                  tone="amber"
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => focusMover(selected)}
                  className="rounded-full border border-[var(--deck-line)] px-3 py-1 text-[11px] text-[var(--deck-muted)] hover:border-[var(--deck-violet)] hover:text-[var(--deck-text)]"
                >
                  Frame both epochs
                </button>
                <button
                  onClick={() => setFollow((f) => !f)}
                  className={`rounded-full px-3 py-1 text-[11px] ${
                    follow
                      ? "bg-[var(--deck-cyan)] text-black"
                      : "border border-[var(--deck-line)] text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
                  }`}
                >
                  {follow ? "Following" : "Follow while blinking"}
                </button>
                <button
                  onClick={() => setLogOpen(true)}
                  className="ml-auto rounded-full bg-[var(--deck-violet)] px-3 py-1 text-[11px] text-white"
                >
                  + Mark candidate
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ------------------------------------------------------ bottom bar */}
      <footer
        className="flex shrink-0 flex-wrap items-center gap-4 border-t border-[var(--deck-line)] px-4 py-2.5"
        style={{ background: "var(--deck-panel)" }}
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setBand((b) => Math.max(0, b - 1))}
            className="grid size-6 place-items-center rounded text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
          >
            ‹
          </button>
          <button
            onClick={() => setBand((b) => Math.min(BAND_COUNT - 1, b + 1))}
            className="grid size-6 place-items-center rounded text-[var(--deck-muted)] hover:text-[var(--deck-text)]"
          >
            ›
          </button>
        </div>

        <div className="min-w-[150px]">
          <p className="text-[12px] font-semibold text-[var(--deck-violet)]">
            Band {band + 1} · {lambda.toFixed(2)} µm
          </p>
          <p className="font-mono text-[10px] text-[var(--deck-dim)]">
            flux {curve[band].toFixed(3)} · {SURVEY_REPEAT_DAYS} spectral channels
          </p>
        </div>

        <input
          type="range"
          min={0}
          max={BAND_COUNT - 1}
          value={band}
          onChange={(e) => setBand(Number(e.target.value))}
          className="h-1 min-w-[200px] flex-1 accent-[var(--deck-violet)]"
          aria-label="Spectral band"
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {MARKERS.slice(0, 4).map((m) => (
            <button
              key={m.name}
              onClick={() => jumpToMarker(m.centre)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--deck-line)] px-2.5 py-1 text-[11px] text-[var(--deck-muted)] transition-colors hover:border-[var(--deck-cyan)] hover:text-[var(--deck-text)]"
            >
              <span
                className="size-2 rounded-sm"
                style={{ background: bandColour(m.centre) }}
              />
              {m.name}
            </button>
          ))}
        </div>

        <p className="ml-auto font-mono text-[10px] text-[var(--deck-dim)]">
          {composition === "ice" ? "Volatile ice" : composition === "gas" ? "Gas giant" : "Silicate rock"} ·
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

function TopButton({
  tone,
  onClick,
  icon,
  children,
}: {
  tone: "violet" | "amber" | "cyan";
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const accent = {
    violet: "var(--deck-violet)",
    amber: "var(--deck-amber)",
    cyan: "var(--deck-cyan)",
  }[tone];
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80"
      style={{ borderColor: `${accent}66`, color: accent }}
    >
      {icon}
      {children}
    </button>
  );
}

function CardStat({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="rounded-lg bg-[var(--deck-raised)] px-3 py-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-[var(--deck-dim)]">{label}</p>
      <p
        className="mt-0.5 font-mono text-[11px]"
        style={{ color: tone === "amber" ? "var(--deck-amber)" : "var(--deck-text)" }}
      >
        {value}
      </p>
    </div>
  );
}

function here(m: Mover, epoch: 0 | 1) {
  return m[epoch === 0 ? "epoch1" : "epoch2"];
}

function bandColour(centre: number) {
  if (centre < 2.2) return "var(--deck-cyan)";
  if (centre < 3.4) return "var(--deck-violet)";
  if (centre < 4.2) return "var(--deck-amber)";
  return "var(--deck-green)";
}
