import { useCallback, useEffect, useState } from 'react';
import { AskResultCard } from '../components/AskResultCard';
import { getEntriesForDate, todayKey } from '../db/logEntries';
import { getDailyTargets } from '../db/settings';
import { askNutritionQuestion } from '../services/openai';
import type { AskNutritionResult, DailyTargets, LoggedEntry, Macros } from '../types/nutrition';

const ZERO_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const ZERO_RANGE = { min: 0, max: 0 };
const ZERO_TARGETS: DailyTargets = {
  calories: ZERO_RANGE,
  protein: ZERO_RANGE,
  carbs: ZERO_RANGE,
  fat: ZERO_RANGE,
};

function sumEntries(entries: LoggedEntry[]): Macros {
  return entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      protein: acc.protein + entry.protein,
      carbs: acc.carbs + entry.carbs,
      fat: acc.fat + entry.fat,
    }),
    ZERO_MACROS
  );
}

export default function Ask() {
  const [totals, setTotals] = useState<Macros>(ZERO_MACROS);
  const [targets, setTargets] = useState<DailyTargets>(ZERO_TARGETS);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskNutritionResult | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [entries, dailyTargets] = await Promise.all([getEntriesForDate(todayKey()), getDailyTargets()]);
    setTotals(sumEntries(entries));
    setTargets(dailyTargets);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setIsAsking(true);
    setAnswer(null);
    setError(null);
    try {
      const totalsStr = `${Math.round(totals.calories)} kcal, ${Math.round(totals.protein)}g protein, ${Math.round(totals.carbs)}g carbs, ${Math.round(totals.fat)}g fat`;
      const targetsStr = `${targets.calories.min}-${targets.calories.max} kcal, ${targets.protein.min}-${targets.protein.max}g protein, ${targets.carbs.min}-${targets.carbs.max}g carbs, ${targets.fat.min}-${targets.fat.max}g fat`;
      const result = await askNutritionQuestion(trimmed, totalsStr, targetsStr);
      setAnswer(result);
    } catch (err: any) {
      setError(err?.message ?? 'Could not get an answer.');
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-5">
      <h1 className="text-[2rem] font-bold leading-tight tracking-normal text-neutral-950">Ask Nutri</h1>
      <p className="mt-1 text-sm leading-5 text-neutral-500">
        Ask Nutri how a meal fits into your meal plan today.
      </p>

      <div className="ask-composer mt-6">
        <textarea
          className="h-full w-full resize-none bg-transparent px-4 py-4 pb-16 text-base leading-6 text-neutral-950 outline-none placeholder:text-neutral-400"
          placeholder="Can I have pizza tonight?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handleAsk();
          }}
          disabled={isAsking}
        />
        <button className="ask-composer-mic" type="button" aria-label="Voice input">
          <MicIcon />
        </button>
        <button
          className="ask-composer-action"
          onClick={handleAsk}
          disabled={isAsking || !question.trim()}
        >
          <span>{isAsking ? 'Checking...' : 'Ask'}</span>
          {!isAsking && <ArrowUpIcon />}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <TodayMini label="Calories" value={totals.calories} target={targets.calories.max} unit="kcal" />
        <TodayMini label="Protein" value={totals.protein} target={targets.protein.max} unit="g" />
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {answer && <AskResultCard result={answer} targets={targets} />}
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function TodayMini({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm shadow-neutral-200/70">
      <div className="text-xs font-semibold text-neutral-500">{label} today</div>
      <div className="mt-1 text-sm font-bold text-neutral-950">
        {Math.round(value)} / {Math.round(target)} {unit}
      </div>
    </div>
  );
}
