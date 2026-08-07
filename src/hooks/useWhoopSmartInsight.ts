import { useEffect, useState } from 'react';
import { todayKey } from '../db/logEntries';
import { generateWhoopDailyInsight } from '../services/openai';
import { whoopDailyInsight, whoopInsightTone, type WhoopInsight } from '../services/whoop';
import type { DailyTargets, Macros, WhoopSummary } from '../types/nutrition';

// Module-level so Home and Ask share one cache and neither refetches on every render/mount.
const cache = new Map<string, WhoopInsight | null>();

function cacheKey(summary: WhoopSummary, totals: Macros): string {
  return JSON.stringify({
    day: todayKey(),
    strain: summary.cycle?.strain ?? null,
    recovery: summary.recovery?.score ?? null,
    sleep: summary.sleep?.performancePercentage ?? null,
    // Bucket macros so small deltas (a few kcal from rounding) don't bust the cache.
    cal: Math.round(totals.calories / 25),
    protein: Math.round(totals.protein / 5),
    carbs: Math.round(totals.carbs / 5),
    fat: Math.round(totals.fat / 5),
  });
}

export function useWhoopSmartInsight(
  summary: WhoopSummary | null,
  totals: Macros,
  targets: DailyTargets
): WhoopInsight | null {
  const [insight, setInsight] = useState<WhoopInsight | null>(summary ? whoopDailyInsight(summary) : null);

  useEffect(() => {
    if (!summary) {
      setInsight(null);
      return;
    }

    const key = cacheKey(summary, totals);
    const cached = cache.get(key);
    if (cached !== undefined) {
      setInsight(cached);
      return;
    }

    let cancelled = false;
    generateWhoopDailyInsight(summary, totals, targets)
      .then((text) => {
        const result: WhoopInsight | null = text ? { text, tone: whoopInsightTone(summary) } : whoopDailyInsight(summary);
        cache.set(key, result);
        if (!cancelled) setInsight(result);
      })
      .catch(() => {
        const result = whoopDailyInsight(summary);
        cache.set(key, result);
        if (!cancelled) setInsight(result);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, totals.calories, totals.protein, totals.carbs, totals.fat, targets]);

  return insight;
}
