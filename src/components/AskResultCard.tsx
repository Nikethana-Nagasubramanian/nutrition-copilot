import { useEffect, useRef, useState } from 'react';
import type { AskNutritionResult, DailyTargets, Macros } from '../types/nutrition';

export function AskResultCard({ result, targets }: { result: AskNutritionResult; targets: DailyTargets }) {
  const [showNewCalories, setShowNewCalories] = useState(true);
  const verdictStyles = {
    yes: 'bg-[#d0fae5] text-emerald-800',
    caution: 'bg-orange-100 text-orange-800',
    no: 'bg-red-100 text-red-800',
  }[result.verdict];
  const verdictCopy = {
    yes: 'Fits today',
    caution: 'Fits with care',
    no: 'Tight fit',
  }[result.verdict];

  const beforeTotals = subtractMacros(result.newTotals, result.adds);
  const displayTotals = showNewCalories ? result.newTotals : beforeTotals;

  return (
    <div className="mt-7 space-y-[14px] border-y border-neutral-200 bg-white py-4">
      <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-3 pb-3">
        <div>
          <div className={`inline-flex rounded-xl px-2.5 py-1 text-xs font-semibold leading-[1.5] ${verdictStyles}`}>
            {verdictCopy}
          </div>
          <h3 className="mt-2 text-xl font-semibold leading-[1.25] text-neutral-950">{result.foodName}</h3>
          <p className="mt-1 text-xs font-medium leading-5 text-neutral-500">Assumed: {result.assumption}</p>
        </div>
      </div>

      <div className="px-3">
        <p className="text-sm font-semibold leading-5 text-neutral-950">{result.summary}</p>
      </div>
      {result.suggestion && (
        <div className="px-3">
          <p className="text-sm leading-5 text-neutral-600">{result.suggestion}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 px-3 pt-2">
        <MacroMini label="Adds" macros={result.adds} />
        <MacroMini label="New total" macros={result.newTotals} />
        <MacroMini label="Left" macros={result.remaining} />
      </div>

      <div className="space-y-1.5 px-3">
        <AskRange label="CAL" value={displayTotals.calories} previous={beforeTotals.calories} max={targets.calories.max} unit="kcal" color="#FC9900" />
        <AskRange label="PROTEIN" value={displayTotals.protein} previous={beforeTotals.protein} max={targets.protein.max} unit="g" color="#1B9966" />
        <AskRange label="CARB" value={displayTotals.carbs} previous={beforeTotals.carbs} max={targets.carbs.max} unit="g" color="#2B7FFF" />
        <AskRange label="FAT" value={displayTotals.fat} previous={beforeTotals.fat} max={targets.fat.max} unit="g" color="#8E51FF" />
      </div>

      <label className="flex items-center gap-1.5 px-3">
        <input
          className="h-4 w-4 accent-black"
          type="checkbox"
          checked={showNewCalories}
          onChange={(event) => setShowNewCalories(event.target.checked)}
        />
        <span className="text-[10px] leading-none text-black/95">Show new calories</span>
      </label>
      </div>
  );
}

function MacroMini({ label, macros }: { label: string; macros: Macros }) {
  const hasNegative = macros.calories < 0 || macros.protein < 0 || macros.carbs < 0 || macros.fat < 0;
  return (
    <div className={`rounded-md p-2 ${hasNegative ? 'bg-red-50 ring-1 ring-red-200' : 'bg-neutral-50'}`}>
      <div className={`text-[10px] font-bold uppercase ${hasNegative ? 'text-red-500' : 'text-neutral-400'}`}>{label}</div>
      <div className={`mt-1 text-sm font-semibold leading-none ${hasNegative ? 'text-red-600' : 'text-neutral-950'}`}>{Math.round(macros.calories)} kcal</div>
      <div className={`mt-1 text-[11px] leading-4 ${hasNegative ? 'text-red-500' : 'text-neutral-500'}`}>
        {Math.round(macros.protein)}p · {Math.round(macros.carbs)}c · {Math.round(macros.fat)}f
      </div>
    </div>
  );
}

function AskRange({
  label,
  value,
  previous,
  max,
  unit,
  color,
}: {
  label: string;
  value: number;
  previous: number;
  max: number;
  unit: string;
  color: string;
}) {
  const isOver = value > max;
  const visualMax = Math.max(isOver ? max : max * 1.22, 1);
  const baseValue = Math.min(previous, value);
  const deltaValue = Math.max(0, value - previous);
  const basePosition = Math.min(100, Math.max(0, (baseValue / visualMax) * 100));
  const deltaPosition = isOver ? 100 - basePosition : Math.min(100, Math.max(0, (deltaValue / visualMax) * 100));
  return (
    <div className="flex h-8 items-center gap-1.5">
      <div className="relative h-8 min-w-0 flex-1 overflow-hidden rounded-lg bg-black/[0.04]">
        <div className="absolute inset-0">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((tick) => (
            <span
              key={tick}
              className="absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/[0.06]"
              style={{ left: `${tick}%` }}
            />
          ))}
          <div
            className="absolute inset-y-0 rounded-l-lg transition-[width,opacity] duration-300 motion-reduce:transition-none"
            style={{
              left: '-5px',
              width: `calc(${basePosition}% + 5px)`,
              backgroundColor: `${color}${isOver ? '99' : '4D'}`,
              transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          />
          <div
            className="absolute inset-y-0 rounded-r-lg transition-[left,width,opacity] duration-300 motion-reduce:transition-none"
            style={{
              left: `${basePosition}%`,
              width: `${deltaValue > 0 ? Math.max(3, deltaPosition) : 0}%`,
              backgroundColor: `${color}99`,
              opacity: deltaValue > 0 ? 1 : 0,
              transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
            }}
          />
        </div>
        <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase leading-none text-black">
          {label}
        </div>
      </div>
      <div className={`flex h-8 w-10 shrink-0 items-center rounded-lg px-1.5 font-mono text-[10px] leading-none ${isOver ? 'text-red-600' : 'text-black/95'}`}>
        <AnimatedNumber value={Math.round(value)} />
      </div>
      <span className="sr-only">{unit}</span>
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    if (previousValue === value) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      previousValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const duration = 280;
    const startedAt = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(previousValue + (value - previousValue) * eased));

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previousValueRef.current = value;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span>{displayValue}</span>;
}

function subtractMacros(a: Macros, b: Macros): Macros {
  return {
    calories: a.calories - b.calories,
    protein: a.protein - b.protein,
    carbs: a.carbs - b.carbs,
    fat: a.fat - b.fat,
  };
}
