import { useCallback, useEffect, useState } from 'react';
import { MacroSummary } from '../components/MacroSummary';
import { useRecorder } from '../hooks/useRecorder';
import { addLoggedEntry, deleteLoggedEntry, getEntriesForDate, todayKey } from '../db/logEntries';
import { createRecurringMeal, findRecurringMealByName } from '../db/recurringMeals';
import { getDailyTargets } from '../db/settings';
import { askNutritionQuestion, parseMealDescription, parseMealFromAudio } from '../services/openai';
import type { DailyTargets, LoggedEntry, Macros } from '../types/nutrition';

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
  const [answer, setAnswer] = useState('');
  const [isAsking, setIsAsking] = useState(false);

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

  const logDirect = async (description: string, macros: Macros, sourceMealId: string | null = null) => {
    await addLoggedEntry(description, macros, sourceMealId);
    await refresh();
  };

  const submitText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    setNote(null);

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

  const handleAudio = useCallback(async (blob: Blob) => {
    setIsBusy(true);
    setError(null);
    setNote(null);
    try {
      const parsed = await parseMealFromAudio(blob);
      const description = parsed.foods.map((f) => f.name).join(', ') || 'Voice log';
      await logDirect(description, parsed.totals);
      if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
    } catch (err: any) {
      setError(err?.message ?? 'Could not process audio.');
    } finally {
      setIsBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { isRecording, startRecording, stopRecording } = useRecorder(handleAudio);

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;
    setIsAsking(true);
    setAnswer('');
    try {
      const totalsStr = `${Math.round(totals.calories)} kcal, ${Math.round(totals.protein)}g protein, ${Math.round(totals.carbs)}g carbs, ${Math.round(totals.fat)}g fat`;
      const targetsStr = `${targets.calories.min}-${targets.calories.max} kcal, ${targets.protein.min}-${targets.protein.max}g protein, ${targets.carbs.min}-${targets.carbs.max}g carbs, ${targets.fat.min}-${targets.fat.max}g fat`;
      const result = await askNutritionQuestion(trimmed, totalsStr, targetsStr);
      setAnswer(result);
    } catch (err: any) {
      setAnswer(err?.message ?? 'Could not get an answer.');
    } finally {
      setIsAsking(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteLoggedEntry(id);
    await refresh();
  };

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <h1 className="text-2xl font-bold text-neutral-900">{greeting()}, Nike</h1>

      <div className="mt-4">
        <MacroSummary totals={totals} targets={targets} />
      </div>

      {pendingRecipeName ? (
        <div className="mt-6 rounded-2xl border border-neutral-200 p-4">
          <p className="text-sm font-semibold text-neutral-900">What's in "{pendingRecipeName}"?</p>
          <p className="mt-1 text-xs text-neutral-500">
            I'll remember this so next time you just say the name.
          </p>
          <textarea
            className="mt-3 w-full resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm"
            rows={3}
            placeholder="1.5 scoop whey, 2 tbsp yogurt, ½ cup berries..."
            value={recipeText}
            onChange={(e) => setRecipeText(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-neutral-200 py-2 text-sm font-semibold text-neutral-700"
              onClick={() => {
                setPendingRecipeName(null);
                setRecipeText('');
              }}
            >
              Cancel
            </button>
            <button
              className="flex-1 rounded-xl bg-green-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={submitRecipe}
              disabled={isBusy || !recipeText.trim()}
            >
              {isBusy ? 'Saving...' : 'Save & Log'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm"
              placeholder="2 eggs, half an avocado, one roti..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitText(input);
              }}
              disabled={isBusy}
            />
            <button
              className="rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => submitText(input)}
              disabled={isBusy || !input.trim()}
            >
              Log
            </button>
          </div>

          <button
            className={`mt-3 w-full select-none rounded-2xl py-4 text-sm font-semibold transition-colors ${
              isRecording ? 'bg-red-100 text-red-700' : 'bg-neutral-100 text-neutral-700'
            }`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={() => isRecording && stopRecording()}
            onTouchStart={(e) => {
              e.preventDefault();
              startRecording();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              stopRecording();
            }}
            disabled={isBusy}
          >
            {isRecording ? '● Listening... release to send' : '🎤 Hold to talk'}
          </button>
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
          <ul className="mt-2 divide-y divide-neutral-100">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <button className="text-left" onClick={() => handleDelete(e.id)}>
                  <div className="text-sm font-medium text-neutral-900">✓ {e.description}</div>
                  <div className="text-xs text-neutral-500">
                    {Math.round(e.calories)} kcal · {Math.round(e.protein)}g protein
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Ask anything</h2>
        <div className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm"
            placeholder="Can I eat ice cream?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAsk();
            }}
          />
          <button
            className="rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            onClick={handleAsk}
            disabled={isAsking || !question.trim()}
          >
            {isAsking ? '...' : 'Ask'}
          </button>
        </div>
        {answer && <p className="mt-3 rounded-xl bg-neutral-100 p-3 text-sm text-neutral-800">{answer}</p>}
      </div>
    </div>
  );
}
