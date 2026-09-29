import { motion } from "framer-motion";
import { Link } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { FIELDS, SURVEY_REPEAT_DAYS } from "@/lib/spherex/fields";

const STEPS = [
  {
    n: "01",
    title: "Read the field",
    body: "A real SPHEREx exposure of 3.15° of sky, pulled straight out of the NASA/IPAC archive. Every star, galaxy and hot pixel on screen is measured data.",
  },
  {
    n: "02",
    title: "Blink two epochs",
    body: "The comparator flips between the epoch the exposure was taken and the next whole-sky visit 184 days later. Stars hold still. Anything that jumps is not a star.",
  },
  {
    n: "03",
    title: "Check the motion",
    body: "Each candidate is cross-checked against JPL Horizons. You get its real astrometry at both epochs, the vector it travelled, and how far it got from Earth.",
  },
];

const PROVENANCE = [
  { k: "Sky pixels", v: "SPHEREx Quick Release, level 2 calibrated spectral images" },
  { k: "Pointing, date, PSF", v: "FITS header of the exposure itself, read at runtime" },
  { k: "Moving objects", v: "NASA/JPL Horizons astrometric ephemerides" },
  { k: "Physical data", v: "JPL Small-Body Database: size, albedo, orbit class" },
  { k: "Epoch baseline", v: `${SURVEY_REPEAT_DAYS} days — the SPHEREx all-sky survey repeat` },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const target = isAuthenticated ? "/dashboard" : "/auth?returnTo=%2Fdashboard";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-semibold tracking-[0.2em]">SPHEREX</span>
            <span className="text-[13px] text-muted-foreground">Blink Comparator</span>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to={target}>{isAuthenticated ? "Open comparator" : "Sign in"}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="grid gap-16 border-b border-border py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-32">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              NASA SPHEREx · moving-object search
            </p>
            <h1 className="mt-6 text-balance text-4xl font-medium leading-[1.08] tracking-[-0.02em] sm:text-5xl lg:text-6xl">
              Two epochs of the same sky.
              <br />
              One of them is moving.
            </h1>
            <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              Asteroids and trans-Neptunian objects are too cold and too faint to see in
              visible light, but they glow in the near-infrared. SPHEREx maps the whole sky
              in 102 infrared bands every six months, and between one visit and the next
              everything nearby has walked across the sky. This is the instrument that
              catches it: you do.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to={target}>Start blinking</Link>
              </Button>
              <span className="text-[13px] text-muted-foreground">
                No download. Runs in the browser.
              </span>
            </div>
          </motion.div>

          <BlinkDiagram />
        </section>

        <section className="border-b border-border py-20">
          <div className="grid gap-px overflow-hidden rounded-sm border border-border md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} className="bg-background p-8">
                <p className="font-mono text-[11px] text-muted-foreground">{step.n}</p>
                <h2 className="mt-5 text-lg font-medium tracking-tight">{step.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-16 border-b border-border py-20 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 className="text-2xl font-medium tracking-tight">Nothing here is invented</h2>
            <p className="mt-4 max-w-md text-[14px] leading-relaxed text-muted-foreground">
              A science tool that fakes its data teaches nothing. Every number in the
              comparator is read from a public archive at the moment you open it.
            </p>
          </div>
          <dl className="space-y-0">
            {PROVENANCE.map((row) => (
              <div
                key={row.k}
                className="flex flex-col gap-1 border-t border-border py-3 sm:flex-row sm:items-baseline sm:gap-8"
              >
                <dt className="w-48 shrink-0 text-[13px] text-muted-foreground">{row.k}</dt>
                <dd className="text-[13px]">{row.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="grid gap-16 border-b border-border py-20 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <h2 className="max-w-2xl text-3xl font-medium leading-tight tracking-[-0.02em]">
              {FIELDS.length} fields are open right now, each with a body that will not stay
              where it was.
            </h2>
            <ul className="mt-8 flex flex-wrap gap-2">
              {FIELDS.map((f) => (
                <li
                  key={f.id}
                  className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {f.name}
                </li>
              ))}
            </ul>
          </div>
          <Button asChild size="lg">
            <Link to={target}>Open the comparator</Link>
          </Button>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-10 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Sky data: NASA/IPAC IRSA · Motions: NASA/JPL Horizons · Built for the SPHEREx
          citizen-science challenge.
        </p>
        <p className="font-mono text-[11px]">registry.opendata.aws/spherex-qr</p>
      </footer>
    </div>
  );
}

/** A small, self-contained sketch of the blink technique. */
function BlinkDiagram() {
  const stars = [
    [18, 22], [34, 61], [47, 15], [58, 78], [63, 40], [71, 9], [76, 55], [82, 30],
    [12, 70], [29, 88], [44, 47], [52, 90], [68, 68], [86, 84], [91, 47], [24, 38],
    [39, 27], [66, 24], [79, 70], [8, 48], [95, 18], [55, 58], [37, 74], [73, 45],
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.15 }}
      className="rounded-sm border border-border"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] text-muted-foreground">EPOCH A</span>
        <motion.span
          className="font-mono text-[11px] text-muted-foreground"
          animate={{ opacity: [1, 1, 0.25, 0.25] }}
          transition={{ duration: 2.4, repeat: Infinity, times: [0, 0.45, 0.5, 1] }}
        >
          184 days
        </motion.span>
        <span className="font-mono text-[11px] text-muted-foreground">EPOCH B</span>
      </div>

      <div className="relative aspect-[4/3] w-full">
        <svg viewBox="0 0 100 75" className="absolute inset-0 size-full">
          {stars.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={0.7} className="fill-foreground" opacity={0.28} />
          ))}
          <motion.circle
            r={1.9}
            className="fill-[#c2703d]"
            animate={{ cx: [41, 41, 76, 76, 41], cy: [33, 33, 57, 57, 33] }}
            transition={{ duration: 4, repeat: Infinity, times: [0, 0.42, 0.58, 0.92, 1], ease: "easeInOut" }}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 grid grid-cols-2">
          <div className="border-r border-border/60" />
          <div />
        </div>
      </div>

      <p className="border-t border-border px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
        Stars stay pinned. The orange dot does not — and that is the whole trick.
      </p>
    </motion.div>
  );
}
