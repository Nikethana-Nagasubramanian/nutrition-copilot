import { useEffect, useState } from 'react';
import { getDailyTargets, setDailyTargets } from '../db/settings';
import type { DailyTargets } from '../types/nutrition';

interface RangeFields {
  min: string;
  max: string;
}

type FormState = Record<keyof DailyTargets, RangeFields>;

const emptyRange: RangeFields = { min: '', max: '' };
const emptyForm: FormState = {
  calories: emptyRange,
  protein: emptyRange,
  carbs: emptyRange,
  fat: emptyRange,
};

const FIELDS: { key: keyof DailyTargets; label: string }[] = [
  { key: 'calories', label: 'Calories' },
  { key: 'protein', label: 'Protein (g)' },
  { key: 'carbs', label: 'Carbs (g)' },
  { key: 'fat', label: 'Fat (g)' },
];

export default function Settings() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getDailyTargets().then((t) => {
      setForm({
        calories: { min: String(t.calories.min), max: String(t.calories.max) },
        protein: { min: String(t.protein.min), max: String(t.protein.max) },
        carbs: { min: String(t.carbs.min), max: String(t.carbs.max) },
        fat: { min: String(t.fat.min), max: String(t.fat.max) },
      });
    });
  }, []);

  const updateField = (key: keyof DailyTargets, side: 'min' | 'max', value: string) => {
    setForm((f) => ({ ...f, [key]: { ...f[key], [side]: value } }));
  };

  const handleSave = async () => {
    const targets: DailyTargets = {
      calories: { min: Number(form.calories.min) || 0, max: Number(form.calories.max) || 0 },
      protein: { min: Number(form.protein.min) || 0, max: Number(form.protein.max) || 0 },
      carbs: { min: Number(form.carbs.min) || 0, max: Number(form.carbs.max) || 0 },
      fat: { min: Number(form.fat.min) || 0, max: Number(form.fat.max) || 0 },
    };
    await setDailyTargets(targets);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-md px-5 pb-28 pt-6">
      <h1 className="text-2xl font-bold text-neutral-900">Daily Targets</h1>
      <p className="mt-1 text-xs text-neutral-500">
        Set a range instead of an exact number if you're not sure yet.
      </p>

      <div className="mt-6 space-y-4">
        {FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-semibold text-neutral-500">{label}</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                inputMode="numeric"
                placeholder="Min"
                value={form[key].min}
                onChange={(e) => updateField(key, 'min', e.target.value)}
              />
              <span className="text-sm text-neutral-400">–</span>
              <input
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                inputMode="numeric"
                placeholder="Max"
                value={form[key].max}
                onChange={(e) => updateField(key, 'max', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        className="mt-6 w-full rounded-xl bg-green-600 py-3 text-sm font-semibold text-white"
        onClick={handleSave}
      >
        {saved ? 'Saved!' : 'Save'}
      </button>
    </div>
  );
}
