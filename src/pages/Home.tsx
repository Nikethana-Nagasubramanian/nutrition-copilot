import { useCallback, useEffect, useRef, useState } from 'react';
import { MacroSummary } from '../components/MacroSummary';
import { addLoggedEntry, deleteLoggedEntry, getEntriesForDate, todayKey, updateLoggedEntry } from '../db/logEntries';
import { createRecurringMeal, findRecurringMealByName } from '../db/recurringMeals';
import { getDailyTargets } from '../db/settings';
import { askNutritionQuestion, parseMealDescription } from '../services/openai';
import type { AskNutritionResult, DailyTargets, LoggedEntry, Macros } from '../types/nutrition';

const ZERO_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const ZERO_RANGE = { min: 0, max: 0 };
const ZERO_TARGETS: DailyTargets = {
  calories: ZERO_RANGE,
  protein: ZERO_RANGE,
  carbs: ZERO_RANGE,
  fat: ZERO_RANGE,
};

function looksLikeMealName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length <= 4 && !/\d/.test(text);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export default function Home() {
  const [entries, setEntries] = useState<LoggedEntry[]>([]);
  const [targets, setTargets] = useState<DailyTargets>(ZERO_TARGETS);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [pendingRecipeName, setPendingRecipeName] = useState<string | null>(null);
  const [recipeText, setRecipeText] = useState('');

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskNutritionResult | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const [suppressClickId, setSuppressClickId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const [e, t] = await Promise.all([getEntriesForDate(todayKey()), getDailyTargets()]);
    setEntries(e);
    setTargets(t);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totals = entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    ZERO_MACROS
  );
  const selectedEntry = selectedEntryId ? entries.find((e) => e.id === selectedEntryId) : null;
  const chartTotals = selectedEntry ?? totals;

  useEffect(() => {
    if (selectedEntryId && !entries.some((e) => e.id === selectedEntryId)) {
      setSelectedEntryId(null);
    }
  }, [entries, selectedEntryId]);

  const logDirect = async (description: string, macros: Macros, sourceMealId: string | null = null) => {
    await addLoggedEntry(description, macros, sourceMealId);
    await refresh();
  };

  const submitText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setNote(null);

    if (editingEntryId) {
      setIsBusy(true);
      try {
        const parsed = await parseMealDescription(trimmed);
        await updateLoggedEntry(editingEntryId, trimmed, parsed.totals);
        setSelectedEntryId(editingEntryId);
        setEditingEntryId(null);
        setInput('');
        await refresh();
        if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
      } catch (err: any) {
        setError(err?.message ?? 'Something went wrong.');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    const recurring = await findRecurringMealByName(trimmed);
    if (recurring) {
      await logDirect(recurring.name, recurring, recurring.id);
      setInput('');
      return;
    }

    if (looksLikeMealName(trimmed)) {
      setPendingRecipeName(trimmed);
      setInput('');
      return;
    }

    setIsBusy(true);
    try {
      const parsed = await parseMealDescription(trimmed);
      await logDirect(trimmed, parsed.totals);
      setInput('');
      if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setIsBusy(false);
    }
  };

  const submitRecipe = async () => {
    if (!pendingRecipeName || !recipeText.trim()) return;
    setIsBusy(true);
    setError(null);
    try {
      const parsed = await parseMealDescription(recipeText.trim());
      const meal = await createRecurringMeal(pendingRecipeName, recipeText.trim(), parsed.totals);
      await logDirect(pendingRecipeName, parsed.totals, meal.id);
      setPendingRecipeName(null);
      setRecipeText('');
      if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setIsAsking(true);
    setAnswer(null);
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

  const handleDelete = async (id: string) => {
    await deleteLoggedEntry(id);
    if (selectedEntryId === id) setSelectedEntryId(null);
    if (editingEntryId === id) {
      setEditingEntryId(null);
      setInput('');
    }
    await refresh();
  };

  const handleEdit = (entry: LoggedEntry) => {
    setEditingEntryId(entry.id);
    setInput(entry.description);
    setActionsOpenId(null);
  };

  const handleTouchEnd = (entryId: string, x: number) => {
    if (touchStartX === null) return;
    const delta = x - touchStartX;
    if (delta < -44) {
      setActionsOpenId((current) => (current === entryId ? null : entryId));
      setSuppressClickId(entryId);
      setTimeout(() => setSuppressClickId(null), 250);
    } else if (delta > 44 && actionsOpenId === entryId) {
      setActionsOpenId(null);
    }
    setTouchDeltaX(0);
    setTouchStartX(null);
  };

  const selectEntry = (entryId: string) => {
    setSelectedEntryId(entryId);
    setActionsOpenId(null);
    chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-5">
      <h1 className="text-[2rem] font-bold leading-tight tracking-normal text-neutral-950">{greeting()}, Nike</h1>
      <p className="mt-1 text-sm text-neutral-500">Speak with the iPhone keyboard mic, then log it.</p>

      <div className="mt-4 scroll-mt-4" ref={chartRef}>
        <MacroSummary
          totals={chartTotals}
          targets={targets}
          showingLabel={selectedEntry?.description ?? null}
          onClearShowing={() => setSelectedEntryId(null)}
        />
      </div>

      {pendingRecipeName ? (
        <div className="mt-6 rounded-[1.5rem] bg-white p-4 shadow-sm shadow-neutral-200/70">
          <p className="text-sm font-semibold text-neutral-900">What's in "{pendingRecipeName}"?</p>
          <p className="mt-1 text-xs text-neutral-500">
            I'll remember this so next time you just say the name.
          </p>
          <textarea
            className="mt-3 w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-green-500"
            rows={3}
            placeholder="1.5 scoop whey, 2 tbsp yogurt, ½ cup berries..."
            value={recipeText}
            onChange={(e) => setRecipeText(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded-2xl bg-neutral-100 py-3 text-sm font-semibold text-neutral-700"
              onClick={() => {
                setPendingRecipeName(null);
                setRecipeText('');
              }}
            >
              Cancel
            </button>
            <button
              className="flex-1 rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
              onClick={submitRecipe}
              disabled={isBusy || !recipeText.trim()}
            >
              {isBusy ? 'Saving...' : 'Save & Log'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="rounded-[1.5rem] bg-white p-3 shadow-sm shadow-neutral-200/70">
            {editingEntryId && (
              <div className="mb-3 flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <span>Editing logged item</span>
                <button
                  className="rounded-full px-2 py-1 text-amber-900"
                  onClick={() => {
                    setEditingEntryId(null);
                    setInput('');
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            <textarea
              className="min-h-24 w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-base leading-6 outline-none focus:border-green-500"
              placeholder="2 eggs, half an avocado, one roti..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitText(input);
              }}
              disabled={isBusy}
            />
            <button
              className="mt-3 w-full rounded-2xl bg-neutral-950 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => submitText(input)}
              disabled={isBusy || !input.trim()}
            >
              {editingEntryId ? 'Save changes' : 'Log'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {note && <p className="mt-3 text-sm text-amber-600">{note}</p>}
      {isBusy && <p className="mt-3 text-sm text-neutral-400">Thinking...</p>}

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Today</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Nothing logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className={`rounded-2xl bg-white p-2 shadow-sm shadow-neutral-200/70 ${
                  selectedEntryId === e.id ? 'ring-2 ring-green-500' : ''
                }`}
                onTouchStart={(event) => {
                  setTouchStartX(event.changedTouches[0]?.clientX ?? null);
                  setTouchDeltaX(0);
                }}
                onTouchMove={(event) => {
                  if (touchStartX === null) return;
                  const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX;
                  setTouchDeltaX(Math.min(0, Math.max(delta, -96)));
                }}
                onTouchEnd={(event) => handleTouchEnd(e.id, event.changedTouches[0]?.clientX ?? 0)}
              >
                <div className="relative overflow-hidden rounded-xl">
                  <div className="absolute inset-y-0 right-2 flex items-center gap-3">
                    <button className="grid h-10 w-10 place-items-center text-blue-600" onClick={() => handleEdit(e)} aria-label="Edit">
                      <EditIcon />
                    </button>
                    <button className="grid h-10 w-10 place-items-center text-red-600" onClick={() => handleDelete(e.id)} aria-label="Delete">
                      <TrashIcon />
                    </button>
                  </div>
                  <button
                    className="relative w-full rounded-xl bg-white px-2 py-2 text-left transition-transform duration-300"
                    style={{ transform: `translateX(${actionsOpenId === e.id ? -92 : touchDeltaX}px)` }}
                    onClick={() => {
                      if (suppressClickId === e.id) return;
                      selectEntry(e.id);
                    }}
                  >
                    <div className="text-sm font-medium text-neutral-900">{e.description}</div>
                    <div className="text-xs text-neutral-500">
                      {Math.round(e.calories)} kcal · {Math.round(e.protein)}g protein · {Math.round(e.carbs)}g carbs · {Math.round(e.fat)}g fat
                    </div>
                  </button>
                </div>
                {actionsOpenId === e.id && (
                  <div className="mt-1 text-right text-[11px] font-medium text-neutral-400">
                    Swipe right to close
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Ask anything</h2>
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-base outline-none focus:border-blue-500"
            placeholder="Can I eat ice cream?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAsk();
            }}
          />
          <button
            className="rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={handleAsk}
            disabled={isAsking || !question.trim()}
          >
            {isAsking ? '...' : 'Ask'}
          </button>
        </div>
        {answer && <AskResultCard result={answer} targets={targets} />}
      </div>
    </div>
  );
}

function AskResultCard({ result, targets }: { result: AskNutritionResult; targets: DailyTargets }) {
  const verdictStyles = {
    yes: 'bg-green-100 text-green-800',
    caution: 'bg-amber-100 text-amber-800',
    no: 'bg-red-100 text-red-800',
  }[result.verdict];

  return (
    <div className="mt-3 rounded-[1.5rem] bg-white p-4 shadow-sm shadow-neutral-200/70">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase ${verdictStyles}`}>
            {result.verdict}
          </div>
          <h3 className="mt-2 text-base font-bold text-neutral-950">{result.foodName}</h3>
          <p className="text-xs text-neutral-500">{result.assumption}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MacroMini label="Adds" macros={result.adds} />
        <MacroMini label="Remaining" macros={result.remaining} />
      </div>

      <div className="mt-4 space-y-2">
        <AskBar label="Calories" value={result.newTotals.calories} target={targets.calories.max} unit="kcal" color="bg-amber-500" />
        <AskBar label="Protein" value={result.newTotals.protein} target={targets.protein.max} unit="g" color="bg-emerald-600" />
        <AskBar label="Carbs" value={result.newTotals.carbs} target={targets.carbs.max} unit="g" color="bg-blue-500" />
        <AskBar label="Fat" value={result.newTotals.fat} target={targets.fat.max} unit="g" color="bg-violet-500" />
      </div>

      <p className="mt-4 text-sm font-medium text-neutral-800">{result.summary}</p>
      {result.suggestion && <p className="mt-1 text-sm text-neutral-500">{result.suggestion}</p>}
    </div>
  );
}

function EditIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function MacroMini({ label, macros }: { label: string; macros: Macros }) {
  return (
    <div className="rounded-2xl bg-neutral-50 p-3">
      <div className="text-xs font-semibold text-neutral-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-neutral-950">{Math.round(macros.calories)} kcal</div>
      <div className="text-xs text-neutral-500">
        {Math.round(macros.protein)}p · {Math.round(macros.carbs)}c · {Math.round(macros.fat)}f
      </div>
    </div>
  );
}

function AskBar({ label, value, target, unit, color }: { label: string; value: number; target: number; unit: string; color: string }) {
  const progress = Math.min(100, Math.max(0, Math.round((value / Math.max(target, 1)) * 100)));
  const over = value > target;
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-neutral-700">{label}</span>
        <span className={over ? 'text-amber-600' : 'text-neutral-500'}>
          {Math.round(value)} / {Math.round(target)} {unit}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
