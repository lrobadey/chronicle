import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useAnimation } from "framer-motion";

/**
 * ChronicleLanding
 * Asymmetrical left-weighted hero with a massive shimmering title, inline logo,
 * cycling placeholder hints, pill input, and a large CTA. Includes a subtle
 * animated starfield/constellation on the right for balance.
 *
 * TailwindCSS is assumed. Colors roughly match Luca's palette:
 *  - abyss: #0B1E34 (bg)
 *  - icefield: #CFE9FF (text)
 *  - silver-slate: #A3AFBF (muted)
 *  - aurora: #00E0FF (accents)
 */

export default function ChronicleLanding({
  onCreate,
  defaultValue = "",
}: {
  onCreate?: (seed: string) => void;
  defaultValue?: string;
}) {
  const [seed, setSeed] = useState(defaultValue);
  const [focused, setFocused] = useState(false);

  // Rotating placeholder hints
  const hints = useMemo(
    () => [
      "A botanist uncovering a conspiracy in an Arctic biosphere",
      "A detective chasing a ghost through a neon city",
      "Two civilizations racing to harness a dying sun",
      "A traveler discovering music older than the stars",
      "A world ruled entirely by oceans",
    ],
    []
  );
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    if (seed.trim() !== "" || focused) return; // pause cycling while user is typing/focused
    const id = setInterval(() => {
      setHintIndex((i) => (i + 1) % hints.length);
    }, 3500);
    return () => clearInterval(id);
  }, [hints.length, seed, focused]);

  const currentHint = hints[hintIndex];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = seed.trim();
    if (!trimmed) return;
    if (onCreate) onCreate(trimmed);
    else console.log("Create world:", trimmed);
  };

  return (
    <div className="min-h-screen w-full overflow-hidden bg-[#0B1E34] text-[#CFE9FF]">
      <div className="relative mx-auto max-w-7xl px-6 py-14 md:py-20">
        {/* Decorative right-side starfield */}
        <div className="pointer-events-none absolute inset-0">
          <Starfield />
        </div>

        {/* Content grid */}
        <div className="relative grid grid-cols-1 gap-10 md:grid-cols-12">
          {/* Left column: identity + form */}
          <div className="md:col-span-7 flex flex-col">
            {/* Title row */}
            <div className="flex items-end gap-4">
              <img src="/chronicle_logo.png" alt="Chronicle logo" className="h-16 w-16 md:h-20 md:w-20 object-contain drop-shadow-[0_0_18px_rgba(0,224,255,0.35)]" />
              <ShimmerTitle>Chronicle</ShimmerTitle>
            </div>

            {/* Prompt */}
            <h2 className="mt-10 text-2xl md:text-3xl font-medium tracking-tight text-[#CFE9FF]">
              What experience would you like?
            </h2>

            {/* Form */}
            <form onSubmit={submit} className="mt-6">
              <label htmlFor="world-seed" className="sr-only">
                Describe your world seed
              </label>
              <div className="flex flex-col gap-5 md:flex-row md:items-center">
                <div className="relative flex-1">
                  {/* input background and border hues borrow from Luca's CSS */}
                  <input
                    id="world-seed"
                    type="text"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={currentHint}
                    autoComplete="off"
                    className="w-full rounded-full border border-white/20 bg-white/10 backdrop-blur-md px-6 py-5 text-lg text-[#CFE9FF] placeholder-[#A3AFBF] outline-none transition shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] focus:border-[#00E0FF]/60 focus:ring-4 focus:ring-cyan-400/20"
                  />
                  {/* subtle inner shine */}
                  <div className="pointer-events-none absolute inset-0 rounded-full">
                    <div className="absolute inset-0 rounded-full ring-1 ring-white/10" />
                    <div className="absolute -top-1 left-0 right-0 h-1/2 rounded-full bg-gradient-to-b from-white/20 to-transparent" />
                  </div>
                </div>

                <motion.button
                  type="submit"
                  disabled={!seed.trim()}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="rounded-full bg-[#00E0FF] px-8 py-5 text-lg font-semibold text-[#0B1E34] shadow-lg shadow-cyan-500/20 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create World
                </motion.button>
              </div>
              <p className="mt-3 text-sm text-[#A3AFBF]">Press Enter to create.</p>
            </form>
          </div>

          {/* Right column: constellation panel (purely decorative) */}
          <div className="relative hidden md:col-span-5 md:block">
            <ConstellationPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Massive shimmering title with glow */
function ShimmerTitle({ children }: { children: React.ReactNode }) {
  const controls = useAnimation();
  useEffect(() => {
    controls.start({
      backgroundPositionX: ["0%", "200%"],
      transition: { duration: 6, repeat: Infinity, ease: "linear" },
    });
  }, [controls]);

  return (
    <motion.h1
      aria-label="Chronicle"
      animate={controls}
      className="select-none bg-gradient-to-r from-[#CFE9FF] via-[#00E0FF] to-[#CFE9FF] bg-[length:200%_100%] bg-clip-text text-6xl font-extrabold tracking-tight text-transparent drop-shadow-[0_0_25px_rgba(0,224,255,0.35)] md:text-8xl"
      style={{ lineHeight: 0.9 }}
    >
      {children}
    </motion.h1>
  );
}



/** Decorative starfield with soft random twinkle + micro drift */
function Starfield() {
  // Generate a deterministic set of stars once
  const stars = useMemo(() => {
    const count = 120;
    const arr: { x: number; y: number; size: number; delay: number; dur: number; dx: number; dy: number; sc: number }[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2.2 + 0.6,
        delay: Math.random() * 6,
        dur: Math.random() * 4 + 3,
        dx: (Math.random() - 0.5) * 1.2, // micro-drift horizontally
        dy: (Math.random() - 0.5) * 1.2, // micro-drift vertically
        sc: 0.85 + Math.random() * 0.3,  // subtle scale pulse
      });
    }
    return arr;
  }, []);

  return (
    <div className="absolute inset-0">
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white/70"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size }}
          initial={{ opacity: 0.2 }}
          animate={{
            opacity: [0.18, 0.9, 0.18],
            x: [0, s.dx, 0],
            y: [0, s.dy, 0],
            scale: [1, s.sc, 1],
          }}
          transition={{ duration: s.dur, repeat: Infinity, delay: s.delay, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

/** Right-side constellation card */
function ConstellationPanel() {
  return (
    <div className="absolute inset-y-0 right-0 flex items-center">
      <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/5 to-transparent p-6 shadow-xl shadow-black/20 backdrop-blur-sm md:w-[420px]">
        <svg viewBox="0 0 420 520" className="h-[520px] w-[420px]">
          <defs>
            <radialGradient id="glow" r="60%">
              <stop offset="0%" stopColor="#00E0FF" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#00E0FF" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* soft gradient glow */}
          <circle cx="320" cy="120" r="120" fill="url(#glow)" />

          {/* constellation points */}
          <g stroke="#CFE9FF" strokeWidth="1.5" fill="#CFE9FF">
            {[
              [60, 440],
              [120, 360],
              [180, 400],
              [240, 300],
              [320, 340],
              [360, 220],
              [260, 160],
              [200, 220],
              [140, 180],
            ].map(([x, y], i, arr) => (
              <React.Fragment key={i}>
                <motion.circle
                  cx={x}
                  cy={y}
                  r={3}
                  initial={{ opacity: 0.3 }}
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 4 + (i % 4), repeat: Infinity, ease: "easeInOut" }}
                />
                {i > 0 && (
                  <motion.line
                    x1={(arr as number[][])[i - 1][0]}
                    y1={(arr as number[][])[i - 1][1]}
                    x2={x}
                    y2={y}
                    initial={{ opacity: 0.2 }}
                    animate={{ opacity: [0.2, 0.8, 0.2] }}
                    transition={{ duration: 6 + (i % 3), repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
              </React.Fragment>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}