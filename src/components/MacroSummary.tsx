import { useEffect, useRef, useState } from 'react';
import type { DailyTargets, Macros } from '../types/nutrition';

interface Props {
  totals: Macros;
  targets: DailyTargets;
  showingLabel?: string | null;
  onClearShowing?: () => void;
}

export function MacroSummary({ totals, targets, showingLabel, onClearShowing }: Props) {
  // The chip must outlive `showingLabel` by the length of its exit transition,
  // so its presence is tracked locally rather than read straight from the prop.
  const [chip, setChip] = useState<{ label: string; closing: boolean } | null>(
    showingLabel ? { label: showingLabel, closing: false } : null
  );
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (exitTimer.current) clearTimeout(exitTimer.current);

    if (showingLabel) {
      // Re-showing mid-exit must cancel the exit, not queue behind it.
      setChip({ label: showingLabel, closing: false });
      return;
    }

    setChip((current) => (current ? { ...current, closing: true } : null));
    // Safety net: if transitionend never fires (interrupted layout, unsupported
    // property), unmount anyway.
    exitTimer.current = setTimeout(() => setChip(null), 400);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [showingLabel]);

  const items = [
    { key: 'calories', label: 'Calories', unit: 'kcal', value: Math.round(totals.calories), range: targets.calories, color: 'bg-amber-500' },
    { key: 'protein', label: 'Protein', unit: 'g', value: Math.round(totals.protein), range: targets.protein, color: 'bg-emerald-600' },
    { key: 'carbs', label: 'Carbs', unit: 'g', value: Math.round(totals.carbs), range: targets.carbs, color: 'bg-blue-500' },
    { key: 'fat', label: 'Fat', unit: 'g', value: Math.round(totals.fat), range: targets.fat, color: 'bg-violet-500' },
  ] as const;

  return (
    <div className="relative pt-12">
      {chip && (
        <div
          className="macro-chip absolute left-8 right-8 top-0 z-0 rounded-t-2xl bg-white px-4 pb-5 pt-3 shadow-md shadow-neutral-200/80"
          data-closing={chip.closing ? '' : undefined}
          onTransitionEnd={(event) => {
            if (chip.closing && event.propertyName === 'opacity') setChip(null);
          }}
        >
          <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onClearShowing}>
            <span className="truncate text-sm text-neutral-950">Showing {chip.label}</span>
            <span className="shrink-0 text-sm font-semibold text-red-600">Remove</span>
          </button>
        </div>
      )}
      <div className="relative z-10 space-y-3 rounded-[1.75rem] bg-white p-4 shadow-sm shadow-neutral-200/70">
        {items.map((item) => {
          const over = item.value > item.range.max;
          const progress = Math.min(100, Math.round((item.value / Math.max(item.range.max, 1)) * 100));
          return (
            <div key={item.key}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-semibold text-neutral-800">{item.label}</div>
                <div className={`text-sm font-semibold tabular-nums ${over ? 'text-amber-600' : 'text-neutral-600'}`}>
                  {item.value} / {item.range.max} {item.unit}
                </div>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className={`h-full w-full origin-left rounded-full ${item.color} transition-transform duration-300 ease-strong`}
                  style={{ transform: `scaleX(${progress / 100})` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
