import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Aperture } from "lucide-react";

const SEEN_KEY = "spherex.intro.v2";

const BEATS = [
  {
    title: "This is a real photograph of the sky",
    body: "NASA's SPHEREx telescope, infrared light, pulled straight out of the public archive the moment you opened this page. Every dot is measured data.",
  },
  {
    title: "Stars do not move",
    body: "They are so far away that they sit perfectly still while Earth swings around the Sun. They are the fixed reference points.",
  },
  {
    title: "Nearby rocks do move",
    body: "SPHEREx came back to this patch of sky again and again, months apart. The orange ring marks something that shifted between two of those visits. That is the whole experiment — press play.",
  },
];

export function useIntro() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== "seen";
    } catch {
      return true;
    }
  });

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "seen");
    } catch {
      /* private mode: show it again next time, which is harmless */
    }
    setOpen(false);
  };

  const replay = () => {
    setOpen(true);
  };

  return { open, setOpen, dismiss, replay };
}

export function Intro({
  open,
  onDismiss,
  onStart,
}: {
  open: boolean;
  onDismiss: () => void;
  onStart: () => void;
}) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (!open) return;
    setBeat(0);
    const id = window.setInterval(() => setBeat((b) => (b + 1) % BEATS.length), 5200);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "Escape" || e.code === "Enter") {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onStart]);

  if (!open) return null;
  const current = BEATS[beat];

  return (
    <div
      className="absolute inset-0 z-40 grid place-items-center px-6"
      style={{ background: "color-mix(in srgb, var(--deck-bg) 88%, transparent)" }}
    >
      <div className="w-[min(520px,100%)] rounded-xl border border-[var(--deck-line)] p-7" style={{ background: "var(--deck-panel)" }}>
        <div className="flex items-center gap-2.5">
          <Aperture className="size-4 text-[var(--deck-accent)]" />
          <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--deck-dim)]">
            First visit · 20 seconds
          </span>
        </div>

        <div className="mt-6 flex items-end gap-2.5" style={{ height: 92 }}>
          {BEATS.map((b, i) => (
            <button
              key={b.title}
              onClick={() => setBeat(i)}
              aria-label={b.title}
              className="relative flex-1 overflow-hidden rounded-md border border-[var(--deck-line)]"
              style={{ height: 60 + i * 14 }}
            >
              <MiniScene index={i} active={i === beat} />
            </button>
          ))}
        </div>

        <motion.div
          key={beat}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mt-6 min-h-[104px]"
        >
          <h2 className="text-[17px] font-medium leading-snug">{current.title}</h2>
          <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--deck-muted)]">{current.body}</p>
        </motion.div>

        <div className="mt-6 flex items-center gap-3">
          <div className="flex gap-1.5">
            {BEATS.map((b, i) => (
              <span
                key={b.title}
                className="h-1 rounded-full transition-all"
                style={{
                  width: i === beat ? 20 : 6,
                  background: i === beat ? "var(--deck-text)" : "var(--deck-line)",
                }}
              />
            ))}
          </div>
          <button
            onClick={onDismiss}
            className="ml-auto text-[12px] text-[var(--deck-dim)] transition-colors hover:text-[var(--deck-text)]"
          >
            Skip
          </button>
          <button
            onClick={onStart}
            className="rounded-md bg-[var(--deck-text)] px-4 py-2 text-[12px] text-[var(--deck-bg)] transition-opacity hover:opacity-85"
          >
            Start blinking
          </button>
        </div>
        <p className="mt-3 text-[10px] text-[var(--deck-dim)]">
          Space bar also starts. The full walkthrough is under <span className="text-[var(--deck-muted)]">Tour</span> in
          the top bar.
        </p>
      </div>
    </div>
  );
}

/** Three tiny animated sketches: the sky, the fixed stars, the thing that moves. */
function MiniScene({ index, active }: { index: number; active: boolean }) {
  const stars = Array.from({ length: 14 }, (_, i) => ({
    x: 6 + ((i * 37) % 84),
    y: 8 + ((i * 53) % 78),
    r: 0.8 + ((i * 7) % 5) / 4,
  }));

  if (index === 0) {
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <rect width="100" height="100" className="fill-[#0a0a0a]" />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} className="fill-[#ededed]" opacity={0.75} />
        ))}
        <motion.circle
          r="2.4"
          className="fill-[#c2703d]"
          animate={active ? { opacity: [0.3, 1, 0.3] } : { opacity: 0.5 }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      </svg>
    );
  }

  if (index === 1) {
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        <rect width="100" height="100" className="fill-[#0a0a0a]" />
        {stars.map((s, i) => (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            className="fill-[#ededed]"
            animate={active ? { x: [0, 0] } : { x: [0, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, repeatType: "mirror" }}
          />
        ))}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
      <rect width="100" height="100" className="fill-[#0a0a0a]" />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} className="fill-[#ededed]" opacity={0.75} />
      ))}
      <motion.circle
        r="2.6"
        className="fill-[#c2703d]"
        animate={active ? { cx: [26, 74], opacity: [1, 0.15, 1] } : { cx: 26, opacity: 1 }}
        transition={{ duration: 2.2, repeat: Infinity, times: [0, 0.45, 1], ease: "easeInOut" }}
      />
    </svg>
  );
}
