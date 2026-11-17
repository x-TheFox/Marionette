'use client';

/**
 * Magic UI-style accents implemented locally with framer-motion (no extra
 * dependencies): Number Ticker, Border Beam, and an Animated Circular
 * Progress Bar. Sized/colored for the charcoal + amber puppeteer theme.
 */
import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

/** Number Ticker: animates a counter whenever the value changes. */
export function NumberTicker({
  value,
  format,
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const motionValue = useMotionValue(value);
  const spring = useSpring(motionValue, { damping: 30, stiffness: 120 });
  const [display, setDisplay] = useState(() => (format ? format(value) : String(value)));
  const prev = useRef(value);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const fmt = format ?? ((v: number) => String(Math.round(v * 100) / 100));
    const unsub = spring.on('change', (v) => setDisplay(fmt(v)));
    return unsub;
  }, [spring, format]);

  return (
    <span className={className} aria-live="polite">
      {display}
    </span>
  );
}

/**
 * Border Beam: a light beam sweeping along the border of its parent.
 * The parent must be `relative` and rounded. Runs while `active`.
 */
export function BorderBeam({ active, color = 'oklch(0.8 0.16 85)' }: { active: boolean; color?: string }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden>
      <motion.div
        className="absolute top-0 h-full w-24"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}66, transparent)`,
          filter: 'blur(2px)',
        }}
        initial={{ left: '-10%' }}
        animate={{ left: ['-10%', '105%'] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
      />
      <div
        className="absolute inset-0 rounded-2xl"
        style={{ boxShadow: `0 0 18px ${color}33 inset`, border: `1px solid ${color}55` }}
      />
    </div>
  );
}

/**
 * Animated Circular Progress Bar: SVG ring + ticking percentage in the middle.
 * status drives the ring color (emerald completed, amber active, rose dropped,
 * muted pending).
 */
export function CircularProgress({
  value,
  status,
  size = 56,
  stroke = 6,
}: {
  value: number; // 0..1
  status: 'completed' | 'active' | 'dropped' | 'pending';
  size?: number;
  stroke?: number;
}) {
  const pct = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color =
    status === 'completed'
      ? 'oklch(0.72 0.17 160)' // emerald
      : status === 'active'
        ? 'oklch(0.8 0.16 85)' // amber
        : status === 'dropped'
          ? 'oklch(0.63 0.2 18)' // rose
          : 'oklch(0.4 0.01 260)'; // muted

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(1 0 0 / 8%)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute text-[10px] font-semibold tabular-nums" style={{ color }}>
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}
