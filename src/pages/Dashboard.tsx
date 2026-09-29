import { useAction } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "@/convex/_generated/api";
import { readHeader, readPlane, type SkyPlane, type SpherexHeader } from "@/lib/spherex/archive";
import {
  addDays,
  formatAngle,
  formatDec,
  formatRa,
  project,
  separation,
  shortDate,
} from "@/lib/spherex/astro";
import { FIELDS, SURVEY_REPEAT_DAYS, getField } from "@/lib/spherex/fields";
import { apparentMagnitude, motionOf, type Mover } from "@/lib/spherex/movers";
import { SkyCanvas, type Tone, type View } from "@/components/sky/SkyCanvas";
import { SpectralScrubber } from "@/components/sky/SpectralScrubber";
import { NeoWsDrawer } from "@/components/sky/NeoWsDrawer";
import {
  AllSkyLocator,
  BeginnerGuide,
  DiscoveryLog,
  ExplainerDialog,
  LogDialog,
  ThemeToggle,
  TourDialog,
  useDiscoveryLog,
  useSound,
} from "@/components/sky/Workbench";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Crosshair,
  Grid3x3,
  GraduationCap,
  Pause,
  Play,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";

const MIN_FOV = 0.15;
const MAX_FOV = 8;
const FILTERS: { id: Tone; label: string }[] = [
  { id: "ink", label: "True" },
  { id: "thermal", label: "Thermal" },
  { id: "paper", label: "Invert" },
];

export default function Dashboard() {
  const [fieldId, setFieldId] = useState(FIELDS[0].id);
  const field = useMemo(() => getField(fieldId), [fieldId]);

  const [header, setHeader] = useState<SpherexHeader | null>(null);
  const [plane, setPlane] = useState<SkyPlane | null>(null);
  const [status, setStatus] = useState<"header" | "plane" | "ready" | "error">("header");
  const [error, setError] = useState<string | null>(null);

  const [epoch, setEpoch] = useState<0 | 1>(0);
  const [playing, setPlaying] = useState(true);
  const [intervalMs, setIntervalMs] = useState(700);
  const [tone, setTone] = useState<Tone>("ink");
  const [showGrid, setShowGrid] = useState(true);
  const [view, setView] = useState<View>({ ra: field.fallbackRa, dec: field.fallbackDec, fovDeg: 3.15 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyInFrame, setOnlyInFrame] = useState(false);

  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const sound = useSound();
  const { entries, update: updateDiscoveries } = useDiscoveryLog();

  // --- the SPHEREx archive -------------------------------------------------
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

  // --- real ephemerides ----------------------------------------------------
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

  const zoom = useCallback((factor: number) => {
    setView((v) => ({ ...v, fovDeg: Math.min(MAX_FOV, Math.max(MIN_FOV, v.fovDeg * factor)) }));
  }, []);

  const focusMover = useCallback((m: Mover) => {
    const a = project(m.epoch1.ra, m.epoch1.dec, m.epoch2.ra, m.epoch2.dec);
    setView({
      ra: m.epoch1.ra,
      dec: m.epoch1.dec,
      fovDeg: Math.min(MAX_FOV, Math.max(0.3, Math.hypot(a.x, a.y) * 1.7)),
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setEpoch((v) => (v === 0 ? 1 : 0));
        setPlaying(false);
      } else if (e.code === "ArrowRight") {
        setEpoch(1);
        setPlaying(false);
      } else if (e.code === "ArrowLeft") {
        setEpoch(0);
        setPlaying(false);
      } else if (e.key === "+" || e.key === "=") zoom(1 / 1.3);
      else if (e.key === "-" || e.key === "_") zoom(1.3);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const selected = movers.find((m) => m.id === selectedId) ?? null;
  const visible = useMemo(
    () =>
      onlyInFrame
        ? movers.filter((m) => {
            const p = m[epoch === 0 ? "epoch1" : "epoch2"];
            return separation(p, { ra: view.ra, dec: view.dec }) < view.fovDeg;
          })
        : movers,
    [movers, onlyInFrame, epoch, view],
  );

  const labels: [string, string] = [
    `EPOCH A · ${shortDate(epoch1)}`,
    `EPOCH B · ${shortDate(epoch2)} (+${SURVEY_REPEAT_DAYS} d)`,
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-6 py-3">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold tracking-[0.18em]">SPHEREX</span>
            <span className="text-[13px] text-muted-foreground">Blink Comparator</span>
          </Link>
          <Separator orientation="vertical" className="hidden h-4 lg:block" />
          <nav className="flex flex-wrap items-center gap-1">
            {FIELDS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFieldId(f.id)}
                className={`rounded-sm px-2.5 py-1 text-[13px] transition-colors ${
                  f.id === fieldId
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {f.name}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setTourOpen(true)}>
              <GraduationCap className="size-3.5" />
              Tour
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setGuideOpen(true)}>
              <Sparkles className="size-3.5" />
              What am I seeing?
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setExplainerOpen(true)}>
              Explainer
            </Button>
            <NeoWsDrawer />
            <DiscoveryLog entries={entries} onChange={updateDiscoveries} />
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => sound.setOn(!sound.on)}
              aria-label="Toggle sound"
            >
              {sound.on ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_400px]">
          <section className="flex min-h-[560px] flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="relative flex-1">
              <SkyCanvas
                header={header}
                plane={plane}
                view={view}
                tone={tone}
                epoch={epoch}
                epochLabels={labels}
                movers={visible}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onViewChange={setView}
                showGrid={showGrid}
                busy={status === "header" || status === "plane"}
              />
              {status === "error" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-8 text-center">
                  <div className="max-w-sm space-y-2">
                    <p className="text-sm font-medium">The SPHEREx archive did not respond.</p>
                    <p className="text-xs text-muted-foreground">{error}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border px-6 py-3">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  className="size-8"
                  onClick={() => setPlaying((p) => !p)}
                  aria-label={playing ? "Pause blink" : "Play blink"}
                >
                  {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </Button>
                <div className="flex overflow-hidden rounded-sm border border-border">
                  {([0, 1] as const).map((e) => (
                    <button
                      key={e}
                      onClick={() => {
                        setEpoch(e);
                        setPlaying(false);
                      }}
                      className={`px-3 py-1 font-mono text-[11px] transition-colors ${
                        epoch === e ? "bg-foreground text-background" : "hover:bg-muted"
                      }`}
                    >
                      {e === 0 ? "A" : "B"}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex min-w-[170px] flex-1 items-center gap-3">
                <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                  {intervalMs} ms
                </span>
                <Slider
                  value={[intervalMs]}
                  min={150}
                  max={2000}
                  step={50}
                  onValueChange={([v]) => setIntervalMs(v)}
                  aria-label="Blink interval"
                />
              </label>

              <label className="flex min-w-[150px] items-center gap-3">
                <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                  {view.fovDeg.toFixed(2)}°
                </span>
                <Slider
                  value={[Math.log(view.fovDeg)]}
                  min={Math.log(MIN_FOV)}
                  max={Math.log(MAX_FOV)}
                  step={0.01}
                  onValueChange={([v]) => setView((s) => ({ ...s, fovDeg: Math.exp(v) }))}
                  aria-label="Field of view"
                />
              </label>

              <div className="flex flex-wrap items-center gap-1">
                <div className="flex overflow-hidden rounded-sm border border-border">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setTone(f.id)}
                      className={`px-2.5 py-1 font-mono text-[11px] transition-colors ${
                        tone === f.id ? "bg-foreground text-background" : "hover:bg-muted"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setOnlyInFrame((v) => !v)}
                  className={`rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    onlyInFrame
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground"
                  }`}
                >
                  In frame only
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant={showGrid ? "secondary" : "ghost"}
                      className="size-8"
                      onClick={() => setShowGrid((g) => !g)}
                      aria-label="Toggle coordinate grid"
                    >
                      <Grid3x3 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Coordinate grid</TooltipContent>
                </Tooltip>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() =>
                    header && setView({ ra: header.ra, dec: header.dec, fovDeg: 3.15 })
                  }
                  aria-label="Reset to the whole field"
                >
                  <Crosshair className="size-3.5" />
                </Button>
              </div>
            </div>
          </section>

          <aside className="px-6 py-6">
            <Tabs defaultValue="targets">
              <TabsList className="w-full">
                <TabsTrigger value="targets">Targets</TabsTrigger>
                <TabsTrigger value="spectrum">Spectrum</TabsTrigger>
                <TabsTrigger value="context">Context</TabsTrigger>
              </TabsList>

              <TabsContent value="targets" className="mt-6 space-y-6">
                <div>
                  <h1 className="text-base font-semibold tracking-tight">{field.name}</h1>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    {field.blurb}
                  </p>
                  <p className="mt-4 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
                    <span>
                      <span className="text-[#c2703d]">○</span> marks a tracked body. The
                      dashed line is the ground it covers between the two epochs.
                    </span>
                    <span className="block font-mono text-[10px]">
                      SPACE flip · ← → epoch · + − zoom · drag to pan
                    </span>
                  </p>
                </div>

                <Separator />

                <div>
                  <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Tracked bodies
                  </h2>
                  {moversError && <p className="text-xs text-destructive">{moversError}</p>}
                  <ul className="space-y-1">
                    {visible.map((m) => {
                      const motion = motionOf(m, SURVEY_REPEAT_DAYS);
                      const here = m[epoch === 0 ? "epoch1" : "epoch2"];
                      const inside =
                        separation(here, { ra: view.ra, dec: view.dec }) < view.fovDeg;
                      return (
                        <li key={m.id}>
                          <button
                            onClick={() => {
                              setSelectedId(m.id);
                              focusMover(m);
                            }}
                            className={`w-full rounded-sm border px-3 py-2 text-left transition-colors ${
                              m.id === selectedId
                                ? "border-foreground"
                                : "border-transparent hover:border-border"
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-[13px] font-medium">{m.name}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">
                                {formatAngle(motion.separationDeg)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-baseline justify-between gap-3 font-mono text-[10px] text-muted-foreground">
                              <span>{m.class ?? "solar system body"}</span>
                              <span>{inside ? "in frame" : "out of frame"}</span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                    {visible.length === 0 && !moversError && (
                      <li className="text-[13px] text-muted-foreground">
                        {header ? "No body in view. Zoom out or clear the filter." : "Reading the archive header…"}
                      </li>
                    )}
                  </ul>
                </div>

                {selected && (
                  <>
                    <Separator />
                    <TargetDetail
                      mover={selected}
                      baselineDays={SURVEY_REPEAT_DAYS}
                      epoch={epoch}
                      onFocus={() => focusMover(selected)}
                      onLog={() => setLogOpen(true)}
                    />
                  </>
                )}

                <Separator />

                <dl className="space-y-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  <p>SKY · SPHEREx QR2 level 2, exposure {header?.obsid ?? "—"}</p>
                  <p>
                    {header
                      ? `OBSERVED ${header.dateObs.slice(0, 19).replace("T", " ")} UTC`
                      : "—"}
                  </p>
                  <p>
                    {header
                      ? `${(header.plateScale * 3600).toFixed(3)}″/px · ${(header.naxis1 * header.plateScale).toFixed(2)}° field · PSF ${header.psfFwhmArcsec.toFixed(1)}″`
                      : "—"}
                  </p>
                  <p className="pt-1">MOVERS · NASA/JPL Horizons astrometry</p>
                  <p>ARCHIVE · registry.opendata.aws/spherex-qr</p>
                </dl>
              </TabsContent>

              <TabsContent value="spectrum" className="mt-6">
                <SpectralScrubber mover={selected} />
              </TabsContent>

              <TabsContent value="context" className="mt-6 space-y-6">
                <div>
                  <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Where this is
                  </h2>
                  <AllSkyLocator
                    ra={header?.ra ?? view.ra}
                    dec={header?.dec ?? view.dec}
                  />
                </div>
                <Separator />
                <div className="space-y-3 text-[12px] leading-relaxed text-muted-foreground">
                  <p>
                    <span className="text-foreground">Why the epochs are 184 days apart.</span>{" "}
                    SPHEREx fixes its telescope in six directions and re-observes the whole
                    sky from each, so the same patch of sky returns once per survey repeat.
                  </p>
                  <p>
                    <span className="text-foreground">Why a nearby body leaves the frame.</span>{" "}
                    A main-belt asteroid crosses a few degrees of sky in six months. A
                    trans-Neptunian object moves far less. That difference is the whole
                    reason the search is worth doing.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>

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
    </TooltipProvider>
  );
}

function TargetDetail({
  mover,
  baselineDays,
  epoch,
  onFocus,
  onLog,
}: {
  mover: Mover;
  baselineDays: number;
  epoch: 0 | 1;
  onFocus: () => void;
  onLog: () => void;
}) {
  const motion = motionOf(mover, baselineDays);
  const here = mover[epoch === 0 ? "epoch1" : "epoch2"];
  const magnitude = apparentMagnitude(mover, epoch === 0 ? 1 : 2);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Selected · epoch {epoch === 0 ? "A" : "B"}
        </h2>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={onFocus}>
            Frame both
          </Button>
          <Button size="sm" className="h-7 text-[12px]" onClick={onLog}>
            Log
          </Button>
        </div>
      </div>
      <dl className="space-y-2 text-[13px]">
        <Row label="Right ascension" value={formatRa(here.ra)} mono />
        <Row label="Declination" value={formatDec(here.dec)} mono />
        <Row label="Distance from Earth" value={`${here.distanceAu.toFixed(3)} AU`} mono />
        <Row label="Motion over both epochs" value={formatAngle(motion.separationDeg)} mono />
        <Row
          label="Direction of travel"
          value={`${motion.positionAngle.toFixed(1)}° east of north`}
          mono
        />
        <Row label="Sky motion rate" value={`${(motion.rateDegPerDay * 60).toFixed(2)}′/day`} mono />
        {mover.diameterKm !== undefined && (
          <Row
            label="Diameter"
            value={
              mover.diameterKm > 1
                ? `${mover.diameterKm.toFixed(1)} km`
                : `${Math.round(mover.diameterKm * 1000)} m`
            }
            mono
          />
        )}
        {magnitude !== null && <Row label="Apparent magnitude (V)" value={magnitude.toFixed(2)} mono />}
        <Row label="Epoch baseline" value={`${baselineDays} days`} mono />
      </dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 pb-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-[11px]" : ""}>{value}</dd>
    </div>
  );
}
