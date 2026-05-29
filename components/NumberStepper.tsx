'use client';

/**
 * Touch-friendly number input. Renders as [−] [value] [+] with clamping
 * at min/max. The center value is read-only by default — built for cases
 * where mobile numeric input has UX problems (iOS Safari + PWA refuses to
 * clear the existing value, requires backspace before typing, etc).
 *
 * For higher ranges where stepping is tedious, set `editable` to make the
 * center value tap-to-edit. When focused, the field auto-selects so the
 * next keypress replaces the value cleanly.
 *
 * Range expectations: small (≤20). For larger ranges, use a different
 * pattern (e.g. a select with bucketed options).
 */

import { useRef } from 'react';

type Props = {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  /** If true, the center value is also tap-editable. Default false (steppers only). */
  editable?: boolean;
  /** Optional aria-label for the whole control. */
  label?: string;
};

export function NumberStepper({ value, onChange, min, max, editable = false, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function clamp(n: number): number {
    if (Number.isNaN(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function step(delta: number) {
    onChange(clamp(value + delta));
  }

  return (
    <div
      className="inline-flex items-stretch border border-ink/15 bg-bone overflow-hidden"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={value <= min}
        aria-label="Decrease"
        className="w-10 h-10 text-lg font-display flex items-center justify-center hover:bg-cinnabar/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-r border-ink/15"
      >
        −
      </button>
      {editable ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return;  // allow transient empty state, don't clamp yet
            onChange(clamp(parseInt(raw, 10)));
          }}
          onBlur={(e) => {
            // Re-clamp on blur in case they left it empty or out of range
            const n = parseInt(e.target.value, 10);
            onChange(clamp(Number.isNaN(n) ? min : n));
          }}
          className="w-14 text-center bg-transparent outline-none font-display text-lg"
        />
      ) : (
        <span className="w-14 flex items-center justify-center font-display text-lg select-none">
          {value}
        </span>
      )}
      <button
        type="button"
        onClick={() => step(1)}
        disabled={value >= max}
        aria-label="Increase"
        className="w-10 h-10 text-lg font-display flex items-center justify-center hover:bg-cinnabar/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-l border-ink/15"
      >
        +
      </button>
    </div>
  );
}
