import { useMemo, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import type { Mover } from "@/lib/spherex/movers";

/**
 * SPHEREx spectral model.
 *
 * The mission splits the whole 0.75–5 µm range into 102 channels at a resolving
 * power of roughly R = 30, which is how a spectrograph samples: wavelengths are
 * spaced by a fixed fraction of themselves, so the bands crowd together in the
 * infrared. That is the sampling used here.
 *
 * IMPORTANT: the curve below is a *modelled* spectrum for the composition class
 * of the targeted body, built from the published absorption features of water
 * ice, methane, carbon dioxide, carbon monoxide and silicate dust. It is not a
 * measured SPHEREx spectrum — the spectral image cubes in the archive are far
 * too large to read in a browser tab, and they are not wired up yet. The
 * scrubber is here so a citizen can learn which band carries which molecule.
 */

const R = 30;
const LAMBDA_START = 0.75; // µm
export const BAND_COUNT = 102;

export const BAND_WAVELENGTHS: number[] = Array.from(
  { length: BAND_COUNT },
  (_, i) => LAMBDA_START * (1 + i / R),
);

/**
 * A false colour for one band, so the slider can show what it is pointing at
 * instead of being an anonymous 1px line. The wavelengths themselves are all
 * infrared, which the eye cannot see, so these are chosen to be evenly
 * distinguishable rather than physically meaningful, and the label underneath
 * says so. 0.75 um is the short-wavelength end and 5 um the long.
 */
export function bandColour(lambdaUm: number): string {
  const t = Math.max(0, Math.min(1, (lambdaUm - LAMBDA_START) / (5.2 - LAMBDA_START)));
  // Deep blue through cyan, green, yellow, orange, to a warm red. Monotonic in
  // lightness and hue together, so neighbouring bands never look the same.
  const hue = 255 - t * 255;
  return `hsl(${hue.toFixed(0)} 62% ${(38 + t * 14).toFixed(0)}%)`;
}

/** A plain-language name for where a band sits, for someone who has never seen a spectrograph. */
export function bandPlainName(lambdaUm: number): string {
  if (lambdaUm < 1.1) return "just past red";
  if (lambdaUm < 1.6) return "warm infrared";
  if (lambdaUm < 2.4) return "infrared";
  if (lambdaUm < 3.6) return "deep infrared";
  return "very deep infrared";
}

export type Molecule = {
  name: string;
  plain: string;
  centre: number;
  width: number;
  strength: number;
  blurb: string;
};

/** The absorption features a citizen can hunt for inside the bandpass. */
export const MARKERS: Molecule[] = [
  { name: "H₂O gas", plain: "steam", centre: 1.87, width: 0.16, strength: 0.34,
    blurb: "Water vapour in a planet's or comet's atmosphere swallows near-infrared light." },
  { name: "H₂O ice", plain: "frozen water", centre: 3.05, width: 0.42, strength: 0.52,
    blurb: "The deep, wide dip that water ice carves into any outer-system body." },
  { name: "CH₄", plain: "methane", centre: 3.31, width: 0.13, strength: 0.46,
    blurb: "Methane is what makes ice worlds and brown dwarfs look so red." },
  { name: "Organics", plain: "carbon dust", centre: 3.42, width: 0.1, strength: 0.2,
    blurb: "A broad haze of complex carbon molecules — tholins — on the surface." },
  { name: "CO₂", plain: "carbon dioxide", centre: 4.27, width: 0.1, strength: 0.44,
    blurb: "How you tell a Mars-like or Venus-like world apart from a bare rock." },
  { name: "CO", plain: "carbon monoxide", centre: 4.67, width: 0.12, strength: 0.4,
    blurb: "Carbon monoxide ice, common on the cold outer bodies." },
];

export type Composition = "ice" | "gas" | "rock";

export const COMPOSITIONS: Record<
  Composition,
  { label: string; plain: string; note: string; tint: string }
> = {
  ice: {
    label: "Volatile ice",
    plain: "an icy world",
    note: "Deep water-ice absorption with methane on top: a Kuiper-belt or Centaur-style body.",
    tint: "#8fb4d9",
  },
  gas: {
    label: "Gas giant / ice giant",
    plain: "a giant planet",
    note: "Strong gaseous water and methane bands with a deep carbon-dioxide feature.",
    tint: "#d9a066",
  },
  rock: {
    label: "Silicate rock",
    plain: "a rocky world",
    note: "A smooth grey continuum with weak features — a bare rock or a dusty asteroid.",
    tint: "#b9b3a9",
  },
};

function gaussian(x: number, centre: number, width: number) {
  return Math.exp(-0.5 * ((x - centre) / width) ** 2);
}

/** Modelled bandpass response for a composition class. */
export function modelSpectrum(kind: Composition): number[] {
  return BAND_WAVELENGTHS.map((lambda) => {
    let f = 1;
    if (kind === "ice") {
      f -= 0.5 * gaussian(lambda, 3.05, 0.45);
      f -= 0.3 * gaussian(lambda, 3.31, 0.12);
      f -= 0.12 * gaussian(lambda, 2.0, 0.2);
      f -= 0.16 * gaussian(lambda, 1.55, 0.12);
    } else if (kind === "gas") {
      f -= 0.42 * gaussian(lambda, 3.3, 0.2);
      f -= 0.34 * gaussian(lambda, 1.9, 0.22);
      f -= 0.3 * gaussian(lambda, 4.3, 0.12);
      f -= 0.18 * gaussian(lambda, 1.3, 0.18);
    } else {
      f -= 0.12 * gaussian(lambda, 1.1, 0.25);
      f -= 0.14 * gaussian(lambda, 2.2, 0.3);
      f -= 0.06 * gaussian(lambda, 3.4, 0.2);
    }
    // Faint red noise floor, as every real detector has.
    return Math.max(0.05, f * (0.985 + 0.015 * Math.sin(lambda * 9.1)));
  });
}

/** Which marker is deepest in the modelled spectrum, for the readout. */
export function strongestMarker(kind: Composition): Molecule {
  const curve = modelSpectrum(kind);
  let best = MARKERS[0];
  let bestDepth = 0;
  for (const m of MARKERS) {
    const i = BAND_WAVELENGTHS.findIndex((l) => Math.abs(l - m.centre) < 0.06);
    if (i < 0) continue;
    const depth = 1 - curve[i];
    const score = depth * (m.strength / 0.5);
    if (score > bestDepth) {
      bestDepth = score;
      best = m;
    }
  }
  return best;
}

export function defaultComposition(mover: Mover | null): Composition {
  if (!mover) return "ice";
  const d = mover.diameterKm ?? 0;
  if (d > 100_000) return "gas"; // not reachable for asteroids, but keeps the model honest
  if (d > 400) return "ice";
  return "rock";
}

export function SpectralScrubber({ mover }: { mover: Mover | null }) {
  const [band, setBand] = useState(48);
  const [kind, setKind] = useState<Composition>(() => defaultComposition(mover));

  const curve = useMemo(() => modelSpectrum(kind), [kind]);
  const lambda = BAND_WAVELENGTHS[band];
  const flux = curve[band];
  const marker = strongestMarker(kind);

  const path = curve
    .map((v, i) => {
      const x = (i / (curve.length - 1)) * 100;
      const y = 100 - ((v - 0.05) / 0.95) * 100;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          102-band spectrum
        </h2>
        <div className="flex gap-1">
          {(Object.keys(COMPOSITIONS) as Composition[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-sm px-2 py-0.5 text-[11px] transition-colors ${
                kind === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {COMPOSITIONS[k].label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-sm border border-border">
        <svg viewBox="0 0 100 108" className="w-full" role="img" aria-label="Modelled spectrum">
          <rect x="0" y="0" width="100" height="100" className="fill-muted/40" />
          <path d={`${path} L100,100 L0,100 Z`} className="fill-foreground/5" />
          <path d={path} className="fill-none stroke-foreground" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          {MARKERS.map((m) => {
            const i = BAND_WAVELENGTHS.findIndex((l) => l >= m.centre);
            if (i < 0) return null;
            const x = (i / (curve.length - 1)) * 100;
            return (
              <g key={m.name}>
                <line x1={x} y1={0} x2={x} y2={100} className="stroke-foreground/20" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                <text x={x + 1} y={6} className="fill-muted-foreground" style={{ fontSize: "3px" }}>
                  {m.name}
                </text>
              </g>
            );
          })}
          <line
            x1={(band / (curve.length - 1)) * 100}
            y1={0}
            x2={(band / (curve.length - 1)) * 100}
            y2={100}
            className="stroke-[#c2703d]"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
          />
          <text x="1" y="106" className="fill-muted-foreground" style={{ fontSize: "3.2px" }}>
            0.75 µm
          </text>
          <text x="99" y="106" textAnchor="end" className="fill-muted-foreground" style={{ fontSize: "3.2px" }}>
            5.0 µm
          </text>
        </svg>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between font-mono text-[11px]">
          <span className="text-muted-foreground">
            band {band + 1} / {BAND_COUNT}
          </span>
          <span>
            {lambda.toFixed(3)} µm · flux {flux.toFixed(3)}
          </span>
        </div>
        <Slider
          value={[band]}
          min={0}
          max={BAND_COUNT - 1}
          step={1}
          onValueChange={([v]) => setBand(v)}
          aria-label="Spectral band"
        />
      </div>

      <div className="space-y-2 border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
        <p>
          <span className="text-foreground">{COMPOSITIONS[kind].label}</span> — {COMPOSITIONS[kind].note}
        </p>
        <p>
          Strongest feature: <span className="text-foreground">{marker.name}</span> at{" "}
          {marker.centre.toFixed(2)} µm. {marker.blurb}
        </p>
        {mover ? (
          <p>
            Modelled for {mover.name}
            {mover.diameterKm ? ` (${mover.diameterKm.toFixed(0)} km)` : ""}. Real SPHEREx
            spectra for this field are not loaded yet.
          </p>
        ) : (
          <p>Select a body to model its bandpass response.</p>
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          {MARKERS.map((m) => (
            <Badge key={m.name} variant="outline" className="rounded-sm font-mono text-[10px]">
              {m.name} {m.centre.toFixed(2)} µm
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
