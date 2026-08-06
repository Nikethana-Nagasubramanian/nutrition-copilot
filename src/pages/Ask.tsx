import { useCallback, useEffect, useState } from 'react';
import { AskResultCard } from '../components/AskResultCard';
import { MacroSummary } from '../components/MacroSummary';
import { getEntriesForDate, todayKey } from '../db/logEntries';
import { getDailyTargets, getWhoopConfig } from '../db/settings';
import { useRecorder } from '../hooks/useRecorder';
import { addDevLog } from '../services/devLogs';
import { askNutritionQuestion } from '../services/openai';
import { transcribeAudio } from '../services/transcription';
import { whoopNutritionContext } from '../services/whoop';
import type { AskNutritionResult, DailyTargets, LoggedEntry, Macros, WhoopSummary } from '../types/nutrition';

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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whoopSummary, setWhoopSummary] = useState<WhoopSummary | null>(null);

  const handleRecordingStop = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    setError(null);
    try {
      const transcript = await transcribeAudio(blob);
      setQuestion((current) => `${current.trim()}${current.trim() ? ' ' : ''}${transcript}`.trim());
    } catch (err) {
      addDevLog({
        level: 'error',
        source: 'Ask.Voice',
        message: 'Ask voice transcription failed.',
        details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      setError("I couldn't transcribe that. Try again, or use the keyboard mic.");
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const handleRecordingError = useCallback((err: unknown) => {
    addDevLog({
      level: 'error',
      source: 'Ask.Voice',
      message: 'Could not start Ask voice recording.',
      details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    setError('Microphone access was blocked. Allow access and try again.');
  }, []);

  const { isRecording, startRecording, stopRecording } = useRecorder(handleRecordingStop, handleRecordingError);

  const refresh = useCallback(async () => {
    const [entries, dailyTargets, whoopConfig] = await Promise.all([getEntriesForDate(todayKey()), getDailyTargets(), getWhoopConfig()]);
    setTotals(sumEntries(entries));
    setTargets(dailyTargets);
    setWhoopSummary(whoopConfig.lastSummary);
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
      const result = await askNutritionQuestion(trimmed, totalsStr, targetsStr, whoopNutritionContext(whoopSummary));
      setAnswer(result);
    } catch (err) {
      addDevLog({
        level: 'error',
        source: 'Ask',
        message: 'Nutrition question failed.',
        details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      setError("I couldn't check that yet. Try again, or check Developer Logs for details.");
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="log-paper-screen mx-auto max-w-md px-3 pb-24 pt-[72px]">
      <h1 className="text-[26px] font-semibold leading-[0.96] text-neutral-950">Ask Nutri</h1>
      <p className="mt-2 text-sm leading-5 text-neutral-500">
        Ask Nutri how a meal fits into your meal plan today.
      </p>

      <div className="ask-composer mt-7">
        <textarea
          className="ask-composer-input"
          placeholder="Can I have pizza tonight?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handleAsk();
          }}
          disabled={isAsking || isTranscribing}
        />
        <button
          className={`ask-composer-mic ${isRecording ? 'is-recording' : ''}`}
          type="button"
          aria-label={isRecording ? 'Stop recording' : 'Voice input'}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isAsking || isTranscribing}
        >
          {isRecording ? <span className="voice-stop-glyph" /> : <MicIcon />}
        </button>
        <button
          className="ask-composer-action"
          onClick={handleAsk}
          disabled={isAsking || isRecording || isTranscribing || !question.trim()}
        >
          <span>{isTranscribing ? 'Transcribing...' : isAsking ? 'Checking...' : 'Ask'}</span>
          {!isAsking && !isTranscribing && <ArrowUpIcon />}
        </button>
      </div>

      <div className="mt-6">
        <MacroSummary totals={totals} targets={targets} />
      </div>

      {whoopSummary && (
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs font-medium leading-5 text-neutral-500">
          WHOOP context on: {whoopNutritionContext(whoopSummary)}
        </p>
      )}

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
