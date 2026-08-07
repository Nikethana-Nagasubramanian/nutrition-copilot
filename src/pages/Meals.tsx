import { useEffect, useState } from 'react';
import {
  createRecurringMeal,
  deleteRecurringMeal,
  getAllRecurringMeals,
  updateRecurringMeal,
} from '../db/recurringMeals';
import { addLoggedEntry } from '../db/logEntries';
import { PAGE_CONTAINER_CLASS } from '../lib/layout';
import { parseMealDescription } from '../services/openai';
import type { RecurringMeal } from '../types/nutrition';
import dumplingIcon from '../assets/image.png';

interface FormState {
  id: string | null;
  name: string;
  description: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

const emptyForm: FormState = {
  id: null,
  name: '',
  description: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
};

export default function Meals() {
  const [meals, setMeals] = useState<RecurringMeal[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toast, setToast] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const refresh = async () => setMeals(await getAllRecurringMeals());

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  const openCreate = () => {
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (meal: RecurringMeal) => {
    setForm({
      id: meal.id,
      name: meal.name,
      description: meal.description,
      calories: String(meal.calories),
      protein: String(meal.protein),
      carbs: String(meal.carbs),
      fat: String(meal.fat),
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || isSaving) return;
    setIsSaving(true);
    setEstimateError(null);
    try {
      let macros = {
        calories: Number(form.calories) || 0,
        protein: Number(form.protein) || 0,
        carbs: Number(form.carbs) || 0,
        fat: Number(form.fat) || 0,
      };
      const hasMacros = macros.calories || macros.protein || macros.carbs || macros.fat;
      if (!form.id && !hasMacros && form.description.trim()) {
        setIsEstimating(true);
        try {
          const parsed = await parseMealDescription(form.description.trim());
          macros = {
            calories: Math.round(parsed.totals.calories),
            protein: Math.round(parsed.totals.protein),
            carbs: Math.round(parsed.totals.carbs),
            fat: Math.round(parsed.totals.fat),
          };
        } catch (err: any) {
          setEstimateError(err?.message ?? 'Could not estimate macros.');
        } finally {
          setIsEstimating(false);
        }
      }
      if (form.id) {
        await updateRecurringMeal(form.id, form.name.trim(), form.description.trim(), macros);
      } else {
        await createRecurringMeal(form.name.trim(), form.description.trim(), macros);
      }
      setFormOpen(false);
      setForm(emptyForm);
      await refresh();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteRecurringMeal(id);
    await refresh();
  };

  const handleLogNow = async (meal: RecurringMeal) => {
    await addLoggedEntry(meal.name, meal, meal.id);
    setToast(`${meal.name} logged`);
  };

  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-[0.96] text-neutral-950">Meals</h1>
          {meals.length > 0 && (
            <p className="mt-2 text-sm leading-5 text-neutral-500">Save your go-to meals for faster logging.</p>
          )}
        </div>
        {meals.length > 0 && (
          <button className="btn-base btn-primary" onClick={openCreate}>
            Add
          </button>
        )}
      </div>

      {formOpen && (
        <div className="meal-sheet-layer" role="presentation">
          <button
            className="meal-sheet-scrim"
            type="button"
            aria-label="Dismiss meal form"
            onClick={() => {
              setFormOpen(false);
              setForm(emptyForm);
            }}
            disabled={isSaving}
          />
          <section className="meal-bottom-sheet" role="dialog" aria-modal="true" aria-label={form.id ? 'Edit meal' : 'New meal'}>
            <div className="meal-sheet-handle-zone">
              <div className="meal-sheet-handle" />
            </div>
            <div className="meal-sheet-content">
              <input
                className="input-base"
                placeholder="Name (e.g. Protein Shake)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <textarea
                className="input-base mt-3 resize-none"
                style={{ minHeight: '70px' }}
                rows={3}
                placeholder="Ingredients (e.g. 1.5 scoop whey, 2 tbsp yogurt...)"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />

              {form.id && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      className="input-base pr-11"
                      placeholder="Calories"
                      inputMode="numeric"
                      value={form.calories}
                      onChange={(e) => setForm((f) => ({ ...f, calories: e.target.value }))}
                    />
                    <span className="input-unit-badge">kcal</span>
                  </div>
                  <div className="relative">
                    <input
                      className="input-base pr-8"
                      placeholder="Protein"
                      inputMode="numeric"
                      value={form.protein}
                      onChange={(e) => setForm((f) => ({ ...f, protein: e.target.value }))}
                    />
                    <span className="input-unit-badge">g</span>
                  </div>
                  <div className="relative">
                    <input
                      className="input-base pr-8"
                      placeholder="Carbs"
                      inputMode="numeric"
                      value={form.carbs}
                      onChange={(e) => setForm((f) => ({ ...f, carbs: e.target.value }))}
                    />
                    <span className="input-unit-badge">g</span>
                  </div>
                  <div className="relative">
                    <input
                      className="input-base pr-8"
                      placeholder="Fat"
                      inputMode="numeric"
                      value={form.fat}
                      onChange={(e) => setForm((f) => ({ ...f, fat: e.target.value }))}
                    />
                    <span className="input-unit-badge">g</span>
                  </div>
                </div>
              )}
              {estimateError && <p className="mt-2 text-xs font-semibold text-red-600">{estimateError}</p>}

              <button
                className="btn-base btn-primary mt-4 w-full"
                onClick={handleSave}
                disabled={!form.name.trim() || isSaving}
              >
                {isSaving ? (isEstimating ? 'Calculating nutrition…' : 'Saving...') : form.id ? 'Save changes' : 'Save meal'}
              </button>

              {form.id && (
                <button
                  className="mt-3 w-full text-center text-[13px] font-medium text-red-600"
                  onClick={async () => {
                    if (!window.confirm(`Delete "${form.name}"? This can't be undone.`)) return;
                    await handleDelete(form.id!);
                    setFormOpen(false);
                    setForm(emptyForm);
                  }}
                >
                  Delete meal
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {meals.length === 0 && !formOpen ? (
        <div className="mt-10 flex flex-col items-center text-center">
          <img src={dumplingIcon} alt="" className="h-40 w-40" />
          <p className="mt-4 text-sm text-neutral-400">
            Save your go-to meals for faster logging.
          </p>
          <button className="btn-base btn-primary mt-4" onClick={openCreate}>
            Add a meal
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {meals.map((meal) => (
            <li key={meal.id}>
              <button
                className="flex w-full items-center gap-3 rounded-[1.25rem] bg-white p-4 text-left shadow-sm shadow-neutral-200/70"
                onClick={() => openEdit(meal)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-neutral-900">{meal.name}</div>
                  {meal.description && (
                    <div className="mt-0.5 truncate text-xs text-neutral-400">{meal.description}</div>
                  )}
                  <div className="mt-1 text-xs text-neutral-400">
                    <span className="font-medium text-neutral-600">{Math.round(meal.calories)} kcal</span>
                    {' · '}
                    {Math.round(meal.protein)}g P · {Math.round(meal.carbs)}g C · {Math.round(meal.fat)}g F
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  className="btn-base btn-primary btn-sm shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLogNow(meal);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      e.preventDefault();
                      handleLogNow(meal);
                    }
                  }}
                >
                  Log meal
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
