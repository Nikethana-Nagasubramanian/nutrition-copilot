import type { DailyTargets, Macros } from '../types/nutrition';

interface Props {
  totals: Macros;
  targets: DailyTargets;
}

export function MacroSummary({ totals, targets }: Props) {
  const items = [
    { key: 'calories', icon: '🔥', label: 'kcal', value: Math.round(totals.calories), range: targets.calories },
    { key: 'protein', icon: '💪', label: 'g protein', value: Math.round(totals.protein), range: targets.protein },
    { key: 'fat', icon: '🥑', label: 'g fat', value: Math.round(totals.fat), range: targets.fat },
    { key: 'carbs', icon: '🍚', label: 'g carbs', value: Math.round(totals.carbs), range: targets.carbs },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => {
        const over = item.value > item.range.max;
        return (
          <div key={item.key} className="rounded-2xl bg-neutral-100 px-4 py-3">
            <div className={`text-2xl font-bold ${over ? 'text-amber-600' : 'text-neutral-900'}`}>
              {item.icon} {item.value}
            </div>
            <div className="text-xs text-neutral-500">
              {item.label} · goal {item.range.min}–{item.range.max}
            </div>
          </div>
        );
      })}
    </div>
  );
}
