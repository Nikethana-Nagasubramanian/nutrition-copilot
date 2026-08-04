import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { MacroSummary } from '../components/MacroSummary';
import { addLoggedEntry, deleteLoggedEntry, getEntriesForDate, todayKey, updateLoggedEntry } from '../db/logEntries';
import { createRecurringMeal, findRecurringMealByName } from '../db/recurringMeals';
import { getDailyTargets, getWhoopConfig } from '../db/settings';
import { addDevLog } from '../services/devLogs';
import { parseMealDescription } from '../services/openai';
import { transcribeAudio } from '../services/transcription';
import { whoopMealNudge } from '../services/whoop';
import type { DailyTargets, LoggedEntry, Macros, WhoopSummary } from '../types/nutrition';

const ZERO_MACROS: Macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const ZERO_RANGE = { min: 0, max: 0 };
const ZERO_TARGETS: DailyTargets = {
  calories: ZERO_RANGE,
  protein: ZERO_RANGE,
  carbs: ZERO_RANGE,
  fat: ZERO_RANGE,
};
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MEAL_ACTION_WIDTH = 96;

type ViewMode = 'today' | 'week' | 'month';
type FeedbackTone = 'green' | 'blue' | 'pink' | 'orange';
type MealBadge = {
  label: string;
  className: string;
};
type DaySummary = {
  dateKey: string;
  label: string;
  entries: LoggedEntry[];
  totals: Macros;
};
type MealFeedback = {
  text: string;
  tone: FeedbackTone;
};
type ComposerState = 'idle' | 'logging' | 'logged';
type VoiceState = 'idle' | 'recording' | 'transcribing';
type SwipeLock = 'x' | 'y' | null;
type SwipeGesture = {
  id: string;
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  lock: SwipeLock;
  moved: boolean;
  history: Array<{ x: number; t: number }>;
};
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'bad-grammar'
  | 'language-not-supported'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'phrases-not-supported'
  | 'service-not-allowed'
  | string;
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

function looksLikeMealName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length <= 4 && !/\d/.test(text);
}

function voiceDebugDetails(error?: SpeechRecognitionErrorCode): string {
  return JSON.stringify(
    {
      error,
      href: window.location.href,
      isSecureContext: window.isSecureContext,
      hasSpeechRecognition: Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
      hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
      userAgent: navigator.userAgent,
    },
    null,
    2
  );
}

function isIosBrowser(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function speechErrorMessage(error?: SpeechRecognitionErrorCode): string | null {
  if (error === 'no-speech') return "I didn't catch anything. Try speaking again.";
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone permission was blocked. Allow mic access, or use the iPhone keyboard mic.';
  }
  if (error === 'audio-capture') return 'I could not access a microphone on this device.';
  if (error === 'network') {
    return 'Browser transcription needs a working secure connection. Try the HTTPS app URL, or use the iPhone keyboard mic.';
  }
  if (error === 'aborted') return null;
  return 'Voice transcription hit a browser issue. Try again, or use the iPhone keyboard mic.';
}

async function requestMicrophoneAccess(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    addDevLog({
      level: 'warn',
      source: 'Voice',
      message: 'getUserMedia is not available before starting voice transcription.',
      details: voiceDebugDetails(),
    });
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    addDevLog({
      level: 'info',
      source: 'Voice',
      message: 'Microphone permission preflight succeeded.',
      details: voiceDebugDetails(),
    });
    return stream;
  } catch (err) {
    addDevLog({
      level: 'warn',
      source: 'Voice',
      message: 'Microphone permission preflight failed.',
      details: `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n${voiceDebugDetails()}`,
    });
    return null;
  }
}

function pickAudioMimeType(): string {
  if (!('MediaRecorder' in window)) return '';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function pastDaysKeys(days: number): string[] {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getTime() - (days - 1 - index) * DAY_MS);
    return toDateKey(date);
  });
}

function dayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

function sumEntries(entries: LoggedEntry[]): Macros {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    ZERO_MACROS
  );
}

function addMacros(a: Macros, b: Macros): Macros {
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
  };
}

function mealFeedback(meal: Macros, dayAfterMeal: Macros, targets: DailyTargets, whoopSummary?: WhoopSummary | null): MealFeedback {
  const whoopNudge = whoopMealNudge(whoopSummary, meal);
  if (whoopNudge) return { text: whoopNudge, tone: 'blue' };

  const proteinRemaining = Math.max(0, targets.protein.max - dayAfterMeal.protein);
  const proteinRatio = meal.protein / Math.max(meal.calories, 1);
  const carbHeavy = meal.carbs >= 45 && meal.protein < 18;
  const nearCalories = dayAfterMeal.calories >= targets.calories.max * 0.82;

  if (meal.protein >= 25) {
    return { text: `Nice. This moved you ${Math.round(meal.protein)}g closer to your protein goal.`, tone: 'green' };
  }
  if (carbHeavy) {
    return { text: 'This leaned carb-heavy. Protein is the next thing to prioritize today.', tone: 'orange' };
  }
  if (nearCalories && proteinRemaining > 25) {
    return { text: `Calories are getting close, but protein still has about ${Math.round(proteinRemaining)}g to go.`, tone: 'pink' };
  }
  if (proteinRatio < 0.045 && meal.calories > 250) {
    return { text: 'This filled calories more than protein. A protein-forward next meal would balance the day.', tone: 'blue' };
  }
  return { text: 'Logged. This keeps your day moving without throwing your targets off.', tone: 'green' };
}

function mealBadge(entry: Macros): MealBadge {
  const calories = Math.max(entry.calories, 1);
  const proteinDensity = entry.protein / calories;
  const carbHeavy = entry.carbs >= 45 && entry.protein < 18;
  const proteinFilled = entry.protein >= 25 || proteinDensity >= 0.075;

  if (proteinFilled) {
    return {
      label: 'Protein filled',
      className: 'bg-[#262626] text-white',
    };
  }
  if (carbHeavy) {
    return {
      label: 'Carb heavy',
      className: 'bg-[#262626] text-white',
    };
  }
  return {
    label: 'Balanced',
    className: 'bg-[#262626] text-white',
  };
}

function rubberband(value: number, min: number, max: number) {
  if (value < min) return min + (value - min) * 0.22;
  if (value > max) return max + (value - max) * 0.22;
  return value;
}

function projectedSwipeEndpoint(offset: number, velocity: number) {
  return offset + velocity * 0.18;
}

export default function Home() {
  const [entries, setEntries] = useState<LoggedEntry[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<DaySummary[]>([]);
  const [monthSummaries, setMonthSummaries] = useState<DaySummary[]>([]);
  const [targets, setTargets] = useState<DailyTargets>(ZERO_TARGETS);
  const [whoopSummary, setWhoopSummary] = useState<WhoopSummary | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MealFeedback | null>(null);
  const [composerState, setComposerState] = useState<ComposerState>('idle');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceInterim, setVoiceInterim] = useState('');
  const [voiceStartedAt, setVoiceStartedAt] = useState<number | null>(null);
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopRequestedRef = useRef(false);
  const voiceTranscriptRef = useRef('');
  const voiceInterimRef = useRef('');
  const voiceHadResultRef = useRef(false);
  const speechFailedRef = useRef(false);

  const [pendingRecipeName, setPendingRecipeName] = useState<string | null>(null);
  const [recipeText, setRecipeText] = useState('');

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [swipeDrag, setSwipeDrag] = useState<{ id: string; offset: number; isDragging: boolean } | null>(null);
  const [suppressClickId, setSuppressClickId] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const swipeGestureRef = useRef<SwipeGesture | null>(null);

  const refresh = useCallback(async () => {
    const monthKeys = pastDaysKeys(MONTH_DAYS);
    const weekKeys = monthKeys.slice(-WEEK_DAYS);
    const [e, t, weekEntries, whoopConfig] = await Promise.all([
      getEntriesForDate(todayKey()),
      getDailyTargets(),
      Promise.all(monthKeys.map((key) => getEntriesForDate(key))),
      getWhoopConfig(),
    ]);
    setEntries(e);
    const monthData = monthKeys.map((key, index) => ({
        dateKey: key,
        label: key === todayKey() ? 'Today' : dayLabel(key),
        entries: weekEntries[index],
        totals: sumEntries(weekEntries[index]),
      }));
    setMonthSummaries(monthData);
    setWeekSummaries(monthData.filter((day) => weekKeys.includes(day.dateKey)));
    setTargets(t);
    setWhoopSummary(whoopConfig.lastSummary);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (voiceState !== 'recording' || voiceStartedAt === null) return;
    const id = window.setInterval(() => {
      setVoiceElapsed(Math.floor((Date.now() - voiceStartedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [voiceStartedAt, voiceState]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
    };
  }, []);

  const totals = sumEntries(entries);
  const selectedEntry = selectedEntryId ? entries.find((e) => e.id === selectedEntryId) : null;
  const chartTotals = selectedEntry ?? totals;

  useEffect(() => {
    if (selectedEntryId && !entries.some((e) => e.id === selectedEntryId)) {
      setSelectedEntryId(null);
    }
  }, [entries, selectedEntryId]);

  const logDirect = async (description: string, macros: Macros, sourceMealId: string | null = null) => {
    setFeedback(mealFeedback(macros, addMacros(totals, macros), targets, whoopSummary));
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
      setComposerState('logging');
      try {
        const parsed = await parseMealDescription(trimmed);
        await updateLoggedEntry(editingEntryId, trimmed, parsed.totals);
        setSelectedEntryId(editingEntryId);
        setEditingEntryId(null);
        setInput('');
        setComposerState('idle');
        await refresh();
        if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
      } catch (err: any) {
        setError(err?.message ?? 'Something went wrong.');
        setComposerState('idle');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    const recurring = await findRecurringMealByName(trimmed);
    if (recurring) {
      setIsBusy(true);
      setComposerState('logging');
      try {
        await logDirect(recurring.name, recurring, recurring.id);
        setInput('');
        setComposerState('logged');
      } catch (err: any) {
        setError(err?.message ?? 'Something went wrong.');
        setComposerState('idle');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (looksLikeMealName(trimmed)) {
      setPendingRecipeName(trimmed);
      setInput('');
      return;
    }

    setIsBusy(true);
    setComposerState('logging');
    try {
      const parsed = await parseMealDescription(trimmed);
      await logDirect(trimmed, parsed.totals);
      setInput('');
      setComposerState('logged');
      if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
      setComposerState('idle');
    } finally {
      setIsBusy(false);
    }
  };

  const startAudioRecording = async (): Promise<boolean> => {
    const stream = await requestMicrophoneAccess();
    if (!stream) return false;

    if (!('MediaRecorder' in window)) {
      mediaStreamRef.current = stream;
      addDevLog({
        level: 'warn',
        source: 'Voice',
        message: 'MediaRecorder is not available; browser speech will be the only voice path.',
        details: voiceDebugDetails(),
      });
      return true;
    }

    const mimeType = pickAudioMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    audioChunksRef.current = [];
    mediaStreamRef.current = stream;
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.start();
    addDevLog({
      level: 'info',
      source: 'Voice',
      message: 'Audio recording fallback started.',
      details: JSON.stringify({ mimeType: recorder.mimeType || mimeType || 'browser-default' }, null, 2),
    });
    return true;
  };

  const stopAudioRecording = (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    const stream = mediaStreamRef.current;
    if (!recorder || recorder.state === 'inactive') {
      stream?.getTracks().forEach((track) => track.stop());
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = audioChunksRef.current.length
          ? new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          : null;
        stream?.getTracks().forEach((track) => track.stop());
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        resolve(blob);
      };
      recorder.stop();
    });
  };

  const discardAudioRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioChunksRef.current = [];
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
  };

  const startVoice = async () => {
    if (isBusy || composerState === 'logged') return;
    if (!window.isSecureContext) {
      addDevLog({
        level: 'warn',
        source: 'Voice',
        message: 'Voice transcription was started from an insecure origin.',
        details: voiceDebugDetails(),
      });
      setError('Mic transcription needs HTTPS on iPhone. Use an HTTPS/Tailscale URL, or tap the text box and use the iPhone keyboard mic.');
      return;
    }

    const hasMicAccess = await startAudioRecording();
    if (!hasMicAccess) {
      setError('Microphone permission was blocked. Allow mic access for this site, then try again.');
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      addDevLog({
        level: 'warn',
        source: 'Voice',
        message: 'SpeechRecognition is not available; using recorded-audio transcription only.',
        details: voiceDebugDetails(),
      });
      setError(null);
      setVoiceTranscript('');
      setVoiceInterim('Recording. Tap stop to transcribe.');
      voiceTranscriptRef.current = '';
      voiceInterimRef.current = '';
      voiceHadResultRef.current = false;
      speechFailedRef.current = true;
      setVoiceElapsed(0);
      setVoiceStartedAt(Date.now());
      setVoiceState('recording');
      return;
    }

    stopRequestedRef.current = true;
    recognitionRef.current?.abort();
    const recognition = new Recognition();
    const iosBrowser = isIosBrowser();
    recognition.continuous = !iosBrowser;
    recognition.interimResults = !iosBrowser;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    stopRequestedRef.current = false;
    recognitionRef.current = recognition;
    setError(null);
    setVoiceTranscript('');
    setVoiceInterim('');
    voiceTranscriptRef.current = '';
    voiceInterimRef.current = '';
    voiceHadResultRef.current = false;
    speechFailedRef.current = false;
    setVoiceElapsed(0);
    setVoiceStartedAt(Date.now());
    setVoiceState('recording');
    addDevLog({
      level: 'info',
      source: 'Voice',
      message: `Started browser voice transcription${iosBrowser ? ' in iOS-friendly mode' : ''}.`,
      details: voiceDebugDetails(),
    });

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      if (finalText.trim() || interimText.trim()) {
        voiceHadResultRef.current = true;
      }
      if (finalText.trim()) {
        setVoiceTranscript((current) => {
          const next = `${current}${current ? ' ' : ''}${finalText.trim()}`;
          voiceTranscriptRef.current = next;
          return next;
        });
      }
      voiceInterimRef.current = interimText.trim();
      setVoiceInterim(interimText.trim());
    };

    recognition.onerror = (event) => {
      const message = speechErrorMessage(event.error);
      addDevLog({
        level: message ? 'warn' : 'info',
        source: 'Voice',
        message: message ? 'Browser voice transcription error.' : 'Browser voice transcription stopped intentionally.',
        details: voiceDebugDetails(event.error),
      });
      if (stopRequestedRef.current) return;
      speechFailedRef.current = true;
      if (!voiceTranscriptRef.current && !voiceInterimRef.current && mediaRecorderRef.current?.state === 'recording') {
        recognitionRef.current = null;
        setVoiceInterim('Recording. Tap stop to transcribe.');
        return;
      }
      setVoiceState('idle');
      setVoiceStartedAt(null);
      setVoiceInterim('');
      if (voiceTranscriptRef.current || voiceInterimRef.current) {
        commitVoiceTranscript();
        return;
      }
      if (message) setError(message);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceStartedAt(null);
      if (voiceTranscriptRef.current || voiceInterimRef.current) {
        commitVoiceTranscript();
        return;
      }
      setVoiceState('idle');
      if (!stopRequestedRef.current && voiceHadResultRef.current) {
        addDevLog({
          level: 'info',
          source: 'Voice',
          message: 'Browser voice transcription ended after receiving speech.',
          details: voiceDebugDetails(),
        });
      }
      if (!stopRequestedRef.current && !voiceHadResultRef.current && mediaRecorderRef.current?.state === 'recording') {
        speechFailedRef.current = true;
        setVoiceInterim('Recording. Tap stop to transcribe.');
        setVoiceStartedAt((current) => current ?? Date.now());
        setVoiceState('recording');
      }
    };

    try {
      recognition.start();
    } catch (err) {
      speechFailedRef.current = true;
      addDevLog({
        level: 'error',
        source: 'Voice',
        message: 'SpeechRecognition failed to start.',
        details: `${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n${voiceDebugDetails()}`,
      });
      if (mediaRecorderRef.current?.state === 'recording') {
        setVoiceInterim('Recording. Tap stop to transcribe.');
        return;
      }
      setVoiceState('idle');
      setVoiceStartedAt(null);
      setError('Voice transcription could not start. Try again, or use the iPhone keyboard mic.');
    }
  };

  const stopVoice = async () => {
    stopRequestedRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      try {
        recognitionRef.current.stop();
      } catch {
        recognitionRef.current.abort();
      }
      recognitionRef.current = null;
    }
    setVoiceStartedAt(null);
    const speechTranscript = [voiceTranscriptRef.current, voiceInterimRef.current].filter(Boolean).join(' ').trim();
    const audioBlob = await stopAudioRecording();
    if (speechTranscript) {
      commitVoiceTranscript();
      return;
    }

    if (!audioBlob || audioBlob.size === 0) {
      commitVoiceTranscript();
      return;
    }

    setVoiceState('transcribing');
    setVoiceInterim('Transcribing...');
    try {
      const transcript = await transcribeAudio(audioBlob);
      appendVoiceTranscript(transcript);
      clearVoiceState();
    } catch (err) {
      addDevLog({
        level: 'error',
        source: 'Voice',
        message: 'Recorded-audio transcription failed.',
        details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      setError('Audio was recorded, but transcription failed. Check Developer Logs for the real error.');
      clearVoiceState();
    }
  };

  const appendVoiceTranscript = (transcript: string) => {
    setInput((current) => `${current.trim()}${current.trim() ? ', ' : ''}${transcript}`);
  };

  const commitVoiceTranscript = (): boolean => {
    const transcript = [voiceTranscriptRef.current, voiceInterimRef.current].filter(Boolean).join(' ').trim();
    if (!transcript) {
      setVoiceState('idle');
      setVoiceInterim('');
      return false;
    }
    appendVoiceTranscript(transcript);
    discardAudioRecording();
    clearVoiceState();
    return true;
  };

  const clearVoiceState = () => {
    setVoiceTranscript('');
    setVoiceInterim('');
    voiceTranscriptRef.current = '';
    voiceInterimRef.current = '';
    voiceHadResultRef.current = false;
    speechFailedRef.current = false;
    setVoiceStartedAt(null);
    setVoiceElapsed(0);
    setVoiceState('idle');
  };

  const cancelVoice = () => {
    stopRequestedRef.current = true;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    discardAudioRecording();
    clearVoiceState();
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
      setComposerState('logged');
      if (parsed.lowConfidenceNote) setNote(parsed.lowConfidenceNote);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong.');
    } finally {
      setIsBusy(false);
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

  const startMealSwipe = (entryId: string, event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const startOffset = actionsOpenId === entryId ? -MEAL_ACTION_WIDTH : 0;
    swipeGestureRef.current = {
      id: entryId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
      lock: null,
      moved: false,
      history: [{ x: event.clientX, t: performance.now() }],
    };
    setActionsOpenId((current) => (current === entryId ? current : null));
    setSwipeDrag({ id: entryId, offset: startOffset, isDragging: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveMealSwipe = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = swipeGestureRef.current;
    if (!gesture) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const distanceX = Math.abs(dx);
    const distanceY = Math.abs(dy);

    if (!gesture.lock && (distanceX > 8 || distanceY > 8)) {
      gesture.lock = distanceX > distanceY * 1.15 ? 'x' : 'y';
    }
    if (gesture.lock !== 'x') return;

    event.preventDefault();
    const offset = rubberband(gesture.startOffset + dx, -MEAL_ACTION_WIDTH, 0);
    gesture.offset = offset;
    gesture.moved = gesture.moved || distanceX > 8;
    const now = performance.now();
    gesture.history = [...gesture.history.filter((sample) => now - sample.t < 120), { x: event.clientX, t: now }];
    setSwipeDrag({ id: gesture.id, offset, isDragging: true });
  };

  const finishMealSwipe = (entryId: string, event: PointerEvent<HTMLButtonElement>) => {
    const gesture = swipeGestureRef.current;
    if (!gesture || gesture.id !== entryId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gesture.lock === 'x') {
      const first = gesture.history[0];
      const last = gesture.history[gesture.history.length - 1];
      const elapsed = Math.max(last.t - first.t, 1);
      const velocity = ((last.x - first.x) / elapsed) * 1000;
      const projected = projectedSwipeEndpoint(gesture.offset, velocity);
      const shouldOpen = velocity < -420 || (velocity <= 420 && projected < -MEAL_ACTION_WIDTH * 0.48);
      setActionsOpenId(shouldOpen ? entryId : null);
      setSuppressClickId(entryId);
      window.setTimeout(() => setSuppressClickId(null), 260);
    }

    setSwipeDrag(null);
    swipeGestureRef.current = null;
  };

  const cancelMealSwipe = (entryId: string, event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (swipeGestureRef.current?.id === entryId) {
      swipeGestureRef.current = null;
      setSwipeDrag(null);
    }
  };

  const mealRowOffset = (entryId: string) => {
    if (swipeDrag?.id === entryId) return swipeDrag.offset;
    return actionsOpenId === entryId ? -MEAL_ACTION_WIDTH : 0;
  };

  const selectEntry = (entryId: string, shouldScroll = true) => {
    setSelectedEntryId(entryId);
    setActionsOpenId(null);
    if (shouldScroll) {
      chartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="log-paper-screen mx-auto max-w-md px-3 pb-24 pt-[72px]">
      <h1 className="text-[26px] font-semibold leading-[0.96] tracking-normal text-neutral-950">Let's hit those macros</h1>

      <div className="mt-11 flex items-center justify-center gap-7">
        {(['today', 'week', 'month'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            className={`border-b pb-1 text-xs font-semibold leading-none transition ${
              viewMode === mode ? 'border-neutral-950 text-neutral-950' : 'border-transparent text-neutral-400'
            }`}
            onClick={() => setViewMode(mode)}
          >
            {mode === 'today' ? 'Today' : mode === 'week' ? 'Past Week' : 'Past Month'}
          </button>
        ))}
      </div>

      {viewMode === 'week' ? (
        <PeriodSummary days={weekSummaries} targets={targets} title="Past 7 days" />
      ) : viewMode === 'month' ? (
        <PeriodSummary days={monthSummaries} targets={targets} title="Past 30 days" />
      ) : (
        <>
      <div className="mt-4 scroll-mt-4" ref={chartRef}>
        <MacroSummary
          totals={chartTotals}
          targets={targets}
          showingLabel={selectedEntry?.description ?? null}
          onClearShowing={() => setSelectedEntryId(null)}
        />
      </div>

      {pendingRecipeName ? (
        <div className="mt-6">
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
        <div className="mt-5">
          <div>
            {editingEntryId && (
              <div className="mb-3 flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                <span>Editing logged item</span>
                <button
                  className="rounded-full px-2 py-1 text-amber-900"
                  onClick={() => {
                    setEditingEntryId(null);
                    setInput('');
                    setFeedback(null);
                    setComposerState('idle');
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            <div className={`meal-flip-slot ${composerState === 'logged' && feedback ? 'is-logged' : ''}`}>
              <textarea
                className="meal-flip-face meal-flip-front resize-none rounded-[1.5rem] border border-neutral-200 bg-white px-4 py-4 pb-16 text-base leading-6 text-neutral-950 outline-none focus:border-neutral-300 disabled:text-neutral-400"
                placeholder="2 eggs, half an avocado, one roti, handful of spinach"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setNote(null);
                  setFeedback(null);
                  setComposerState('idle');
                  if (voiceState !== 'idle') cancelVoice();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitText(input);
                }}
                disabled={isBusy || composerState === 'logged' || voiceState !== 'idle'}
              />
              <button
                className="meal-flip-mic"
                type="button"
                aria-label="Start voice transcription"
                onClick={startVoice}
                disabled={isBusy || composerState === 'logged' || voiceState !== 'idle'}
              >
                <MicIcon />
              </button>
              <button
                className="meal-flip-action"
                onClick={() => {
                  if (composerState === 'logged') {
                    setComposerState('idle');
                    setFeedback(null);
                    setInput('');
                    return;
                  }
                  submitText(input);
                }}
                disabled={isBusy || voiceState !== 'idle' || (!input.trim() && composerState !== 'logged')}
              >
                <span>{composerState === 'logged' ? 'Meal Logged!' : isBusy ? 'Logging...' : editingEntryId ? 'Save' : 'Log meal'}</span>
                {composerState !== 'logged' && !isBusy && <ArrowUpIcon />}
              </button>
              {voiceState !== 'idle' && (
                <div className="voice-recorder meal-flip-face rounded-[1.5rem] border border-neutral-200 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-3 text-sm leading-[1.4] text-neutral-950">
                      {voiceState === 'transcribing'
                        ? 'Transcribing...'
                        : [voiceTranscript, voiceInterim].filter(Boolean).join(' ') || 'Say what you ate...'}
                    </div>
                  </div>
                  <div className="voice-controls">
                    <VoiceWaveform isRecording />
                    <span className="voice-timer">{formatVoiceTime(voiceElapsed)}</span>
                    <button
                      className="voice-stop-button"
                      type="button"
                      aria-label="Stop voice transcription"
                      onClick={stopVoice}
                      disabled={voiceState === 'transcribing'}
                    >
                      <span />
                    </button>
                  </div>
                </div>
              )}
              <div className="meal-flip-face meal-flip-back flex items-center justify-center rounded-[1.5rem] border border-dashed border-neutral-300 bg-neutral-50 px-5 py-4 pb-16 text-center text-sm font-medium leading-[1.44] text-neutral-950">
                {feedback?.text ?? 'Meal logged.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {note && <p className="mt-3 text-sm text-amber-600">{note}</p>}

      <div className="mt-7">
        <h2 className="px-1 text-sm font-semibold uppercase leading-[1.2] text-neutral-950">Today's meals</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Nothing logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {entries.map((e) => {
              const badge = mealBadge(e);
              const rowOffset = mealRowOffset(e.id);
              const isDragging = swipeDrag?.id === e.id && swipeDrag.isDragging;
              return (
              <li
                key={e.id}
                className={`rounded bg-white p-2 shadow-[0_2px_5px_rgba(0,0,0,0.05)] ${
                  selectedEntryId === e.id ? 'ring-2 ring-green-500' : ''
                }`}
              >
                <div className="relative overflow-hidden rounded">
                  <div className="absolute inset-y-0 right-2 flex items-center gap-3">
                    <button
                      className="grid h-10 w-10 place-items-center text-neutral-950"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleEdit(e);
                      }}
                      aria-label="Edit"
                    >
                      <EditIcon />
                    </button>
                    <button
                      className="grid h-10 w-10 place-items-center text-[#e7000b]"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDelete(e.id);
                      }}
                      aria-label="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <button
                    className="relative flex w-full touch-pan-y flex-col items-start gap-2 rounded bg-white text-left will-change-transform"
                    style={{
                      transform: `translate3d(${rowOffset}px, 0, 0)`,
                      transition: isDragging ? 'none' : 'transform 380ms cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                    onPointerDown={(event) => startMealSwipe(e.id, event)}
                    onPointerMove={moveMealSwipe}
                    onPointerUp={(event) => finishMealSwipe(e.id, event)}
                    onPointerCancel={(event) => cancelMealSwipe(e.id, event)}
                    onClick={() => {
                      if (suppressClickId === e.id) return;
                      selectEntry(e.id);
                    }}
                  >
                    <div className="flex w-full items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-[1.2] tracking-[0.015em] text-neutral-950">
                        {e.description}
                      </div>
                      <span className={`shrink-0 rounded px-2 py-1 font-mono text-[11px] leading-none ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="w-full text-xs leading-[1.333] tracking-[0.015em] text-[#737373]">
                      {Math.round(e.calories)} kcal · {Math.round(e.protein)}g protein · {Math.round(e.carbs)}g carbs · {Math.round(e.fat)}g fat
                    </div>
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>
        </>
      )}
    </div>
  );
}

function PeriodSummary({
  days,
  targets,
  title,
}: {
  days: DaySummary[];
  targets: DailyTargets;
  title: string;
}) {
  const loggedDays = days.filter((day) => day.entries.length > 0);
  const loggedCount = loggedDays.length || 1;
  const averageTotals = loggedDays.reduce((acc, day) => addMacros(acc, day.totals), ZERO_MACROS);
  const averages: Macros = {
    calories: averageTotals.calories / loggedCount,
    protein: averageTotals.protein / loggedCount,
    carbs: averageTotals.carbs / loggedCount,
    fat: averageTotals.fat / loggedCount,
  };
  const hitCounts = {
    calories: daysInRange(loggedDays, 'calories', targets),
    protein: daysInRange(loggedDays, 'protein', targets),
    carbs: daysInRange(loggedDays, 'carbs', targets),
    fat: daysInRange(loggedDays, 'fat', targets),
  };
  const statLabels = {
    calories: `${hitCounts.calories}/${loggedDays.length} days in range`,
    protein: `${hitCounts.protein}/${loggedDays.length} days in range`,
    carbs: `${hitCounts.carbs}/${loggedDays.length} days in range`,
    fat: `${hitCounts.fat}/${loggedDays.length} days in range`,
  };
  const summary = periodSummaryText({ loggedCount: loggedDays.length, hitCounts, averages, targets });
  const helper = `${title} average · ${loggedDays.length} of ${days.length} days logged so far. ${summary}`;

  return (
    <div className="mt-3">
      <MacroSummary
        totals={loggedDays.length ? averages : ZERO_MACROS}
        targets={targets}
        statLabels={statLabels}
        helperText={helper}
      />
    </div>
  );
}

function daysInRange(days: DaySummary[], metric: keyof Macros, targets: DailyTargets): number {
  return days.filter((day) => day.totals[metric] >= targets[metric].min && day.totals[metric] <= targets[metric].max).length;
}

function periodSummaryText({
  loggedCount,
  hitCounts,
  averages,
  targets,
}: {
  loggedCount: number;
  hitCounts: Record<keyof Macros, number>;
  averages: Macros;
  targets: DailyTargets;
}) {
  if (!loggedCount) return 'Log a few meals this week and this will turn into a useful pattern read.';
  if (averages.protein < targets.protein.min) {
    return `Protein averaged ${Math.round(averages.protein)}g, below your range. Protein-forward meals are the clearest next focus.`;
  }
  if (averages.calories > targets.calories.max) {
    return `Calories averaged ${Math.round(averages.calories)} kcal, above your range. Keep protein steady, but tighten portions around the higher-calorie meals.`;
  }
  if (hitCounts.calories >= Math.ceil(loggedCount * 0.7) && hitCounts.protein >= Math.ceil(loggedCount * 0.7)) {
    return `Good consistency. Calories and protein were in range on most logged days.`;
  }
  return `You are close. The averages are useful, but consistency is the thing to improve next.`;
}

function EditIcon() {
  return (
    <svg className="h-7 w-7" viewBox="28 8 224 224" fill="currentColor" aria-hidden="true">
      <path d="M221.657 34.344a8 8 0 0 0-11.314 0L196 48.687 191.314 44a24 24 0 0 0-33.941 0L48 153.373A24 24 0 0 0 40.971 170.343V204a16 16 0 0 0 16 16h33.657A24 24 0 0 0 107.598 212.971L216.971 103.598a24 24 0 0 0 0-33.941L212.284 64.971 226.627 50.628a8 8 0 0 0 0-11.314ZM68 180.687 79.314 192H57.971v-21.343ZM96.284 201.657a8 8 0 0 1-11.314 0L59.314 176a8 8 0 0 1 0-11.314L136 88 172.971 124.971ZM205.657 92.284 184.284 113.657 147.314 76.686 168.686 55.314a8 8 0 0 1 11.314 0L205.657 80.971A8 8 0 0 1 205.657 92.284Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-7 w-7" viewBox="4 8 224 224" fill="currentColor" aria-hidden="true">
      <path d="M216 48H176V40a24 24 0 0 0-24-24H104A24 24 0 0 0 80 40v8H40a8 8 0 0 0 0 16h8V208a16 16 0 0 0 16 16H192a16 16 0 0 0 16-16V64h8a8 8 0 0 0 0-16ZM96 40a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96ZM192 208H64V64H192ZM112 104v64a8 8 0 0 1-16 0V104a8 8 0 0 1 16 0Zm48 0v64a8 8 0 0 1-16 0V104a8 8 0 0 1 16 0Z" />
    </svg>
  );
}

function formatVoiceTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function VoiceWaveform({ isRecording }: { isRecording: boolean }) {
  const bars = [5, 10, 16, 22, 12, 28, 18, 9, 24, 14, 20, 7, 17, 11, 25, 13];
  return (
    <div className={`voice-waveform ${isRecording ? 'is-recording' : ''}`} aria-hidden="true">
      {bars.map((height, index) => (
        <span key={`${height}-${index}`} style={{ height: `${height}px`, animationDelay: `${index * 42}ms` }} />
      ))}
    </div>
  );
}

function MicIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
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
