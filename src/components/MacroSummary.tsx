import type { DailyTargets, Macros } from '../types/nutrition';

interface Props {
  totals: Macros;
  targets: DailyTargets;
  statLabels?: Partial<Record<keyof Macros, string>>;
  helperText?: string;
  showingLabel?: string | null;
  onClearShowing?: () => void;
}

export function MacroSummary({ totals, targets, statLabels, helperText, showingLabel, onClearShowing }: Props) {
  const items = [
    { key: 'calories', label: 'CAL', unit: 'kcal', value: Math.round(totals.calories), range: targets.calories, color: '#FC990099' },
    { key: 'protein', label: 'PROTEIN', unit: 'g', value: Math.round(totals.protein), range: targets.protein, color: '#1B996699' },
    { key: 'carbs', label: 'CARB', unit: 'g', value: Math.round(totals.carbs), range: targets.carbs, color: '#2B7FFF99' },
    { key: 'fat', label: 'FAT', unit: 'g', value: Math.round(totals.fat), range: targets.fat, color: '#8E51FF99' },
  ] as const;
  const finalHelperText = helperText;

  return (
    <div className={`relative ${showingLabel ? 'pt-11' : ''}`}>
      {showingLabel && (
        <div className="attached-banner absolute left-6 right-6 top-2 z-0 rounded-t-2xl border border-[#f3f3f3] bg-white px-4 py-2 shadow-[0_4px_6px_-1px_rgba(229,229,229,0.8),0_2px_4px_-2px_rgba(229,229,229,0.8)]">
          <button className="flex w-full items-center justify-between gap-3 text-left" onClick={onClearShowing}>
            <span className="truncate text-sm leading-5 text-neutral-950">Showing {showingLabel}</span>
            <span className="shrink-0 text-sm font-semibold leading-5 text-red-600">Remove</span>
          </button>
        </div>
      )}
      <div className="relative z-10 rounded-2xl border border-neutral-100 bg-white p-2">
        <div className="space-y-1.5">
        {items.map((item) => {
          const visualMax = Math.max(item.range.max * 1.22, item.value * 1.08, 1);
          const fillWidth = item.value <= 0 ? 0 : Math.min(100, Math.max(3, (item.value / visualMax) * 100));
          return (
            <div key={item.key} className="flex h-8 items-center gap-1.5">
              <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-lg bg-black/[0.04]">
                <div className="absolute inset-0">
                  {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((tick) => (
                    <span
                      key={tick}
                      className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.06]"
                      style={{ left: `${tick}%` }}
                    />
                  ))}
                </div>
                <div
                  className="absolute inset-y-0 rounded-lg"
                  style={{ left: 0, width: `${fillWidth}%`, backgroundColor: item.color }}
                />
                <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase leading-none text-black">
                  {item.label}
                </div>
              </div>
              <div className="flex h-8 w-10 shrink-0 items-center rounded-lg px-1.5 font-mono text-[10px] leading-none text-black/95">
                {item.value}
              </div>
              {statLabels?.[item.key] && <span className="sr-only">{statLabels[item.key]}</span>}
            </div>
          );
        })}
        </div>
        {finalHelperText && (
          <div className="border-t border-neutral-100 pt-3 text-xs font-medium leading-5 text-neutral-400">
            {finalHelperText}
          </div>
        )}
      </div>
    </div>
  );
}
