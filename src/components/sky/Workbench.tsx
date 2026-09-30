import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { BookMarked, Download, Star, Trash2 } from "lucide-react";
import { formatAngle, formatDec, formatRa } from "@/lib/spherex/astro";
import { motionOf, type Mover } from "@/lib/spherex/movers";

/* ------------------------------------------------------------------ *
 * Discovery logbook
 * ------------------------------------------------------------------ */

export type Discovery = {
  id: string;
  createdAt: string;
  fieldId: string;
  fieldName: string;
  designation: string;
  name: string;
  classification: string;
  confidence: number;
  notes: string;
  epoch1Ra: number;
  epoch1Dec: number;
  epoch2Ra: number;
  epoch2Dec: number;
  motionDeg: number;
  distanceAu: number;
  epoch1: string;
  epoch2: string;
};

const STORE_KEY = "spherex.discovery-log.v1";

export function loadDiscoveries(): Discovery[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Discovery[]) : [];
  } catch {
    return [];
  }
}

function saveDiscoveries(list: Discovery[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked — the session still works in memory */
  }
}

const CLASSES = [
  "Near-Earth asteroid",
  "Main-belt asteroid",
  "Jupiter trojan",
  "Trans-Neptunian object",
  "Brown dwarf",
  "Unknown transient",
];

export function logDiscovery(
  mover: Mover,
  field: { id: string; name: string },
  epoch1: string,
  epoch2: string,
  baselineDays: number,
  extra: { classification: string; confidence: number; notes: string },
): Discovery {
  const motion = motionOf(mover, baselineDays);
  return {
    id: `${Date.now()}-${mover.designation}`,
    createdAt: new Date().toISOString(),
    fieldId: field.id,
    fieldName: field.name,
    designation: mover.designation,
    name: mover.name,
    classification: extra.classification,
    confidence: extra.confidence,
    notes: extra.notes,
    epoch1Ra: mover.epoch1.ra,
    epoch1Dec: mover.epoch1.dec,
    epoch2Ra: mover.epoch2.ra,
    epoch2Dec: mover.epoch2.dec,
    motionDeg: motion.separationDeg,
    distanceAu: mover.epoch1.distanceAu,
    epoch1,
    epoch2,
  };
}

export function DiscoveryLog({
  entries,
  onChange,
}: {
  entries: Discovery[];
  onChange: (next: Discovery[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const download = (kind: "json" | "csv") => {
    const body =
      kind === "json"
        ? JSON.stringify(entries, null, 2)
        : [
            "logged_at,field,designation,name,classification,confidence,epoch1,epoch1_ra,epoch1_dec,epoch2,epoch2_ra,epoch2_dec,motion_deg,distance_au,notes",
            ...entries.map((e) =>
              [
                e.createdAt,
                e.fieldName,
                e.designation,
                `"${e.name.replace(/"/g, '""')}"`,
                `"${e.classification}"`,
                e.confidence,
                e.epoch1,
                e.epoch1Ra.toFixed(6),
                e.epoch1Dec.toFixed(6),
                e.epoch2,
                e.epoch2Ra.toFixed(6),
                e.epoch2Dec.toFixed(6),
                e.motionDeg.toFixed(4),
                e.distanceAu.toFixed(4),
                `"${e.notes.replace(/"/g, '""')}"`,
              ].join(","),
            ),
          ].join("\n");
    const blob = new Blob([body], { type: kind === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spherex-discoveries.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <BookMarked className="size-3.5" />
          Logbook
          {entries.length > 0 && (
            <Badge variant="secondary" className="ml-1 rounded-sm text-[10px]">
              {entries.length}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Discovery logbook</SheetTitle>
          <SheetDescription>
            Everything you have flagged, kept in this browser. Export it as JSON for a
            notebook or CSV for a spreadsheet.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => download("csv")} disabled={!entries.length}>
            <Download className="size-3.5" />
            CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => download("json")} disabled={!entries.length}>
            <Download className="size-3.5" />
            JSON
          </Button>
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange([])}
              className="ml-auto"
            >
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          )}
        </div>

        <ul className="mt-6 space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-sm border border-border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">{e.name}</span>
                <span className="flex gap-0.5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      className={`size-3 ${i < e.confidence ? "fill-[#c2703d] text-[#c2703d]" : "text-muted-foreground/40"}`}
                    />
                  ))}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {e.classification} · moved {formatAngle(e.motionDeg)} · {e.fieldName}
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {formatRa(e.epoch1Ra)} {formatDec(e.epoch1Dec)} → {formatRa(e.epoch2Ra)}{" "}
                {formatDec(e.epoch2Dec)}
              </p>
              {e.notes && <p className="mt-2 text-[12px] text-muted-foreground">{e.notes}</p>}
              <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
                {new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19)}
              </p>
            </li>
          ))}
        </ul>
        {entries.length === 0 && (
          <p className="mt-6 text-[13px] text-muted-foreground">
            Nothing logged yet. Find something that hops, select it, and press Log.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function LogDialog({
  mover,
  open,
  onOpenChange,
  onSave,
  epoch1,
  epoch2,
  field,
  baselineDays,
}: {
  mover: Mover;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (d: Discovery) => void;
  epoch1: string;
  epoch2: string;
  field: { id: string; name: string };
  baselineDays: number;
}) {
  const [classification, setClassification] = useState(CLASSES[1]);
  const [confidence, setConfidence] = useState(3);
  const [notes, setNotes] = useState("");
  const motion = motionOf(mover, baselineDays);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log {mover.name}</DialogTitle>
          <DialogDescription>
            Moved {formatAngle(motion.separationDeg)} between {epoch1} and {epoch2} in{" "}
            {field.name}. Add what you can see so the log means something later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Classification</Label>
            <div className="flex flex-wrap gap-1">
              {CLASSES.map((c) => (
                <button
                  key={c}
                  onClick={() => setClassification(c)}
                  className={`rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                    classification === c
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Detection confidence</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setConfidence(n)} aria-label={`${n} of 5`}>
                  <Star
                    className={`size-5 ${n <= confidence ? "fill-[#c2703d] text-[#c2703d]" : "text-muted-foreground/30"}`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Faint point source, brighter at epoch B, no match in the catalogue…"
              className="min-h-20"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(
                logDiscovery(mover, field, epoch1, epoch2, baselineDays, {
                  classification,
                  confidence,
                  notes,
                }),
              );
              onOpenChange(false);
              setNotes("");
            }}
          >
            Add to logbook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Beginner mode + guided tour
 * ------------------------------------------------------------------ */

export function useSound() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null;
    const tick = () => {
      ctx ??= new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    };
    const id = window.setInterval(tick, 900);
    return () => window.clearInterval(id);
  }, [on]);
  return { on, setOn };
}

const TOUR_STEPS = [
  {
    title: "Pick a field",
    body: "Each field is a patch of sky SPHEREx really photographed, about 3.5° across. Switch between them at the top.",
  },
  {
    title: "Choose two epochs",
    body: "Every field here was observed four times between April 2025 and May 2026. Mark any two as A and B in the rail; the dates are the real DATE-OBS of those exposures.",
  },
  {
    title: "Blink them",
    body: "Press play and the two exposures alternate. Stars hold still. Anything that hops is either a solar-system body or a discovery. Split, overlay and difference are there for when blinking is not enough.",
  },
  {
    title: "Watch the orange ring",
    body: "A ring marks a tracked body, dashed between its two positions. The move is computed by JPL Horizons from the real catalogue orbit.",
  },
  {
    title: "Read the motion",
    body: "Select the body. You get real coordinates at both dates, how far it moved and how fast it was closing.",
  },
  {
    title: "Log the discovery",
    body: "Flag it with a confidence rating and it goes into your logbook, ready to export.",
  },
];

export function TourDialog({
  open,
  onOpenChange,
  step,
  setStep,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  step: number;
  setStep: (n: number) => void;
}) {
  const current = TOUR_STEPS[step];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Step {step + 1} of {TOUR_STEPS.length}
          </DialogTitle>
          <DialogDescription>{current.title}</DialogDescription>
        </DialogHeader>
        <motion.p
          key={step}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[14px] leading-relaxed text-muted-foreground"
        >
          {current.body}
        </motion.p>
        <div className="flex items-center gap-1.5 pt-2">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === step ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            Back
          </Button>
          <Button
            onClick={() =>
              step === TOUR_STEPS.length - 1 ? onOpenChange(false) : setStep(step + 1)
            }
          >
            {step === TOUR_STEPS.length - 1 ? "Start blinking" : "Next"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BeginnerGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>What am I looking at?</DialogTitle>
          <DialogDescription>
            The short version, with no jargon left in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-[14px] leading-relaxed text-muted-foreground">
          <p>
            <span className="text-foreground">The picture</span> is a real photograph of the
            sky taken by a NASA spacecraft called SPHEREx. It looks grey and grainy
            because it is infrared light — the kind your eyes cannot see — and because
            there is a lot of it.
          </p>
          <p>
            <span className="text-foreground">The little dots</span> are stars, galaxies
            and sometimes the telescope&apos;s own hot pixels. Stars are so far away that
            they sit perfectly still while we move around the Sun.
          </p>
          <p>
            <span className="text-foreground">The two dates</span> are six months apart,
            because that is how long SPHEREx takes to do a full trip around the sky. Any
            dot that is in one picture and not the other has moved.
          </p>
          <p>
            <span className="text-foreground">The orange ring</span> is a nearby object — an
            asteroid or an ice world. Because it is close, it slides across the sky over
            months while the stars stay put. That slide is the whole experiment.
          </p>
          <p>
            <span className="text-foreground">The rainbow chart</span> is its chemical
            fingerprint. Water, methane and carbon dioxide each swallow light at their own
            wavelength, and those wavelengths are frozen into the 102 bands.
          </p>
          <p className="pt-2 text-[13px]">
            Keyboard: <span className="font-mono">space</span> flips the epochs,{" "}
            <span className="font-mono">← →</span> pick a date,{" "}
            <span className="font-mono">+ −</span> zoom, and dragging pans the field.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CHAPTERS = [
  { t: "A telescope built to see everything", d: "0:00" },
  { t: "Why infrared", d: "0:22" },
  { t: "The car-window trick", d: "0:44" },
  { t: "Blinking two epochs", d: "1:06" },
  { t: "Reading the fingerprint", d: "1:28" },
];

/** The in-app explainer: a chaptered, self-contained animated brief. */
export function ExplainerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!open || !playing) return;
    const id = window.setInterval(() => setChapter((c) => (c + 1) % CHAPTERS.length), 9000);
    return () => window.clearInterval(id);
  }, [open, playing]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cosmic explainer</DialogTitle>
          <DialogDescription>
            Five minutes, condensed to five chapters. Runs inside the page, no video file
            to download.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-video overflow-hidden rounded-sm border border-border bg-[#0b0b0c]">
          <ChapterStage chapter={chapter} />
          <button
            onClick={() => setPlaying((p) => !p)}
            className="absolute bottom-3 right-3 rounded-sm bg-background/85 px-2 py-1 font-mono text-[11px] text-foreground backdrop-blur-sm"
          >
            {playing ? "pause" : "play"}
          </button>
          <span className="absolute left-3 top-3 font-mono text-[11px] text-white/70">
            {CHAPTERS[chapter].d}
          </span>
        </div>

        <ul className="mt-2 space-y-1">
          {CHAPTERS.map((c, i) => (
            <li key={c.t}>
              <button
                onClick={() => setChapter(i)}
                className={`flex w-full items-baseline justify-between rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors ${
                  i === chapter ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <span>{c.t}</span>
                <span className="font-mono text-[11px]">{c.d}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function ChapterStage({ chapter }: { chapter: number }) {
  const stars = Array.from({ length: 40 }, (_, i) => ({
    x: (i * 37) % 100,
    y: (i * 61) % 100,
    r: 0.5 + ((i * 13) % 7) / 10,
  }));
  return (
    <svg viewBox="0 0 100 56" className="size-full">
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} className="fill-white" opacity={0.45} />
      ))}
      {chapter === 0 && (
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <rect x="30" y="18" width="40" height="20" className="fill-none stroke-white/70" strokeWidth="0.5" />
          <text x="50" y="30" textAnchor="middle" className="fill-white/80" style={{ fontSize: "3px" }}>
            all-sky, 102 bands
          </text>
        </motion.g>
      )}
      {chapter === 1 && (
        <motion.path
          d="M0 40 Q25 18 50 34 T100 26"
          className="fill-none stroke-[#c2703d]"
          strokeWidth="0.8"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 4, repeat: Infinity }}
        />
      )}
      {chapter === 2 && (
        <>
          <motion.rect
            x="20"
            y="14"
            width="14"
            height="28"
            className="fill-none stroke-white/80"
            strokeWidth="0.5"
            animate={{ x: [20, 30, 20, 46, 62, 46] }}
            transition={{ duration: 8, repeat: Infinity, times: [0, 0.16, 0.33, 0.5, 0.66, 1] }}
          />
          <motion.circle
            r="1.6"
            className="fill-[#c2703d]"
            animate={{ cx: [8, 12, 16, 40, 66, 72], cy: [30, 29, 30, 30, 29, 30] }}
            transition={{ duration: 8, repeat: Infinity, times: [0, 0.16, 0.33, 0.5, 0.66, 1] }}
          />
        </>
      )}
      {chapter === 3 && (
        <>
          <rect x="0" y="0" width="50" height="56" className="fill-white/5" />
          <rect x="50" y="0" width="50" height="56" className="fill-black/20" />
          <motion.circle
            r="1.6"
            className="fill-[#c2703d]"
            animate={{ cx: [28, 72], cy: [30, 30] }}
            transition={{ duration: 1.4, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
          />
        </>
      )}
      {chapter === 4 && (
        <motion.path
          d="M6 40 L20 22 L28 34 L40 14 L52 30 L64 18 L78 36 L94 24"
          className="fill-none stroke-white/80"
          strokeWidth="0.7"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
      )}
      <text x="50" y="53" textAnchor="middle" className="fill-white/60" style={{ fontSize: "3px" }}>
        {CHAPTERS[chapter].t}
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * All-sky locator
 * ------------------------------------------------------------------ */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Where the field sits relative to the galactic plane and the ecliptic. */
export function skyContext(ra: number, dec: number) {
  const galactic = Math.asin(
    Math.sin(dec * D2R) * Math.sin(27.13 * D2R) +
      Math.cos(dec * D2R) * Math.cos(27.13 * D2R) * Math.sin((ra - 192.86) * D2R),
  );
  // Ecliptic longitude via a rotation of the equatorial frame by the obliquity.
  const lambda = Math.atan2(
    Math.sin(ra * D2R) * Math.cos(23.4392911 * D2R) -
      Math.tan(dec * D2R) * Math.sin(23.4392911 * D2R),
    Math.cos(ra * D2R),
  );
  return {
    galacticLat: galactic / D2R,
    eclipticLon: ((lambda * R2D) % 360 + 360) % 360,
  };
}

/**
 * Mollweide projection of the whole celestial sphere, in a 0..100 box.
 * The outline is the 2:1 ellipse every Mollweide map has, and the field marker,
 * the celestial equator and the ecliptic all land in the right places relative
 * to each other because they go through the same projection.
 */
const MW_RX = 49;
const MW_RY = MW_RX / 2;

function mollweide(ra: number, dec: number) {
  const lambda = ((((ra + 180) % 360) - 180) * Math.PI) / 180;
  const phi = (dec * Math.PI) / 180;
  // Mollweide's auxiliary equation is 2θ + sin2θ = π sinφ. The left side rises
  // monotonically over [0, π/2] (d/dθ = 4cos²θ), so bisect the magnitude and put
  // the sign of φ back afterwards; a southern point would otherwise pin to the
  // equator.
  const target = Math.PI * Math.abs(Math.sin(phi));
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (2 * mid + Math.sin(2 * mid) < target) lo = mid;
    else hi = mid;
  }
  const theta = Math.sign(phi) * ((lo + hi) / 2);
  return {
    x: 50 + (MW_RX / Math.PI) * lambda * Math.cos(theta),
    y: 50 - MW_RY * Math.sin(theta),
  };
}

/** Ecliptic latitude/longitude -> equatorial RA/Dec, for drawing the ecliptic. */
function eclipticToEquatorial(lonDeg: number, latDeg: number) {
  const l = lonDeg * D2R;
  const b = latDeg * D2R;
  const e = 23.4392911 * D2R;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return { ra: ((ra * R2D) % 360 + 360) % 360, dec: dec * R2D };
}

function polyline(points: { x: number; y: number }[], close = false) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + (close ? " Z" : "");
}

export function AllSkyLocator({ ra, dec }: { ra: number; dec: number }) {
  const ctx = skyContext(ra, dec);
  const here = mollweide(ra, dec);

  // The celestial equator, and the ecliptic as the track the four fields sit near.
  const equator = Array.from({ length: 73 }, (_, i) => mollweide((i / 72) * 360 - 180, 0));
  const ecliptic = Array.from({ length: 73 }, (_, i) => {
    const p = eclipticToEquatorial((i / 72) * 360, 0);
    return mollweide(p.ra, p.dec);
  });
  // RA ticks every two hours along the equator.
  const ticks = Array.from({ length: 12 }, (_, i) => i * 2);

  return (
    <div className="space-y-3">
      <svg viewBox="0 0 100 100" className="w-full max-w-[220px]">
        <ellipse cx="50" cy="50" rx={MW_RX} ry={MW_RY} className="fill-muted/30 stroke-border" strokeWidth="0.4" />
        <path d={polyline(equator, true)} fill="none" strokeWidth="0.4" className="stroke-border" />
        <path d={polyline(ecliptic, true)} fill="none" strokeWidth="0.4" strokeDasharray="1.6 1.4" className="stroke-[#c2703d]/50" />
        {ticks.map((h) => {
          const p = mollweide(h * 15, 0);
          return (
            <text
              key={h}
              x={p.x}
              y={p.y - 1.4}
              textAnchor="middle"
              className="fill-muted-foreground"
              style={{ fontSize: "2.8px" }}
            >
              {h}h
            </text>
          );
        })}
        <circle cx={here.x} cy={here.y} r="4" className="fill-none stroke-[#c2703d]" strokeWidth="0.4" />
        <circle cx={here.x} cy={here.y} r="1.5" className="fill-[#c2703d]" />
      </svg>
      <dl className="space-y-1 font-mono text-[10px] text-muted-foreground">
        <div className="flex justify-between">
          <dt>galactic latitude</dt>
          <dd className="text-foreground">{ctx.galacticLat.toFixed(1)}°</dd>
        </div>
        <div className="flex justify-between">
          <dt>ecliptic longitude</dt>
          <dd className="text-foreground">{ctx.eclipticLon.toFixed(1)}°</dd>
        </div>
        <div className="flex justify-between">
          <dt>position</dt>
          <dd className="text-foreground">{dec >= 0 ? "north" : "south"} of the equator</dd>
        </div>
      </dl>
    </div>
  );
}

/* Discovery logbook, persisted locally and exportable. */
export function useDiscoveryLog() {
  const [entries, setEntries] = useState<Discovery[]>([]);
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    setEntries(loadDiscoveries());
  }, []);
  const update = (next: Discovery[]) => {
    setEntries(next);
    saveDiscoveries(next);
  };
  return { entries, update };
}
