import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MacroSummary } from '../components/MacroSummary';
import { addLoggedEntry, deleteLoggedEntry, getEntriesForDate, todayKey, updateLoggedEntry } from '../db/logEntries';
import { createRecurringMeal, findRecurringMealByName } from '../db/recurringMeals';
import { getDailyTargets, getWhoopConfig } from '../db/settings';
import { addDevLog } from '../services/devLogs';
import { parseMealDescription } from '../services/openai';
import { transcribeAudio } from '../services/transcription';
import { whoopDailyInsight, whoopMealNudge } from '../services/whoop';
import { PAGE_CONTAINER_CLASS } from '../lib/layout';
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
const SERVER_TRANSCRIPTION_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SERVER_TRANSCRIPTION === 'true';

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
type ComposerUiState = 'idle' | 'typing' | 'recording' | 'transcribing' | 'transcribed' | 'sending' | 'feedback';
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

function mealComposerPlaceholder(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'What did you have for breakfast?';
  if (hour < 17) return 'What did you have for lunch?';
  if (hour < 21) return 'What did you have for a snack?';
  return 'Did you have your dinner?';
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
      className: 'bg-emerald-50 text-emerald-700',
    };
  }
  if (carbHeavy) {
    return {
      label: 'Carb heavy',
      className: 'bg-amber-50 text-amber-700',
    };
  }
  return {
    label: 'Balanced',
    className: 'bg-[#eaf5ef] text-[#16703a]',
  };
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
  const [isMealSheetOpen, setIsMealSheetOpen] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [isVoiceReview, setIsVoiceReview] = useState(false);
  const [isComposerMultiline, setIsComposerMultiline] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const sheetDragRef = useRef<{ startY: number; lastY: number; lastT: number; velocity: number } | null>(null);
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
  const chartRef = useRef<HTMLDivElement | null>(null);
  const periodTabsRef = useRef<HTMLDivElement | null>(null);

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
    const inputEl = composerInputRef.current;
    if (!inputEl || voiceState !== 'idle') {
      setIsComposerMultiline(false);
      return;
    }
    inputEl.style.height = '32px';
    const isWrapped = inputEl.scrollHeight > 36;
    setIsComposerMultiline(isWrapped);
    inputEl.style.height = isWrapped ? `${Math.min(inputEl.scrollHeight, 96)}px` : '32px';
  }, [input, voiceState]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      stopVoiceMeter();
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

  const showMealError = (message: string, err: unknown) => {
    addDevLog({
      level: 'error',
      source: 'LogMeal',
      message,
      details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    setError("I couldn't calculate that yet. Try again, or check Developer Logs for details.");
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
      } catch (err) {
        showMealError('Editing a logged meal failed.', err);
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
      } catch (err) {
        showMealError('Logging a recurring meal failed.', err);
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
    } catch (err) {
      showMealError('Logging a meal from text failed.', err);
      setComposerState('idle');
    } finally {
      setIsBusy(false);
    }
  };

  const startAudioRecording = async (): Promise<boolean> => {
    const stream = await requestMicrophoneAccess();
    if (!stream) return false;
    startVoiceMeter(stream);

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
      stopVoiceMeter();
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
        stopVoiceMeter();
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
    stopVoiceMeter();
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
        message: SERVER_TRANSCRIPTION_ENABLED
          ? 'SpeechRecognition is not available; using recorded-audio transcription only.'
          : 'SpeechRecognition is not available and server transcription is disabled.',
        details: voiceDebugDetails(),
      });
      if (!SERVER_TRANSCRIPTION_ENABLED) {
        discardAudioRecording();
        setError('Browser voice transcription is not available here. Tap the text box and use the iPhone keyboard mic.');
        return;
      }
      setError(null);
      voiceTranscriptRef.current = '';
      voiceInterimRef.current = '';
      voiceHadResultRef.current = false;
      speechFailedRef.current = true;
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
    voiceTranscriptRef.current = '';
    voiceInterimRef.current = '';
    voiceHadResultRef.current = false;
    speechFailedRef.current = false;
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
        voiceTranscriptRef.current = `${voiceTranscriptRef.current}${voiceTranscriptRef.current ? ' ' : ''}${finalText.trim()}`;
      }
      voiceInterimRef.current = interimText.trim();
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
        voiceInterimRef.current = '';
        return;
      }
      setVoiceState('idle');
      voiceInterimRef.current = '';
      if (voiceTranscriptRef.current || voiceInterimRef.current) {
        commitVoiceTranscript();
        return;
      }
      if (message) setError(message);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
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
        if (!SERVER_TRANSCRIPTION_ENABLED) {
          discardAudioRecording();
          setError('Browser voice transcription stopped without text. Try the iPhone keyboard mic.');
          return;
        }
        voiceInterimRef.current = '';
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
        if (!SERVER_TRANSCRIPTION_ENABLED) {
          discardAudioRecording();
          setVoiceState('idle');
          setError('Voice transcription could not start. Try the iPhone keyboard mic.');
          return;
        }
        voiceInterimRef.current = '';
        return;
      }
      setVoiceState('idle');
      setError('Voice transcription could not start. Try again, or use the iPhone keyboard mic.');
    }
  };

  const stopVoice = async () => {
    stopRequestedRef.current = true;
    setVoiceState('transcribing');
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

    if (!SERVER_TRANSCRIPTION_ENABLED) {
      clearVoiceState();
      setError('Recorded-audio transcription is local-only. Use the iPhone keyboard mic on the deployed app.');
      return;
    }

    setVoiceState('transcribing');
    voiceInterimRef.current = '';
    try {
      const transcript = await transcribeAudio(audioBlob);
      clearVoiceState();
      reviewVoiceTranscript(transcript);
    } catch (err) {
      addDevLog({
        level: 'error',
        source: 'Voice',
        message: 'Recorded-audio transcription failed.',
        details: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      setError("Audio was recorded, but I couldn't transcribe it. Check Developer Logs for details.");
      clearVoiceState();
    }
  };

  const reviewVoiceTranscript = (transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    setInput((current) => mergeVoiceTranscript(current, trimmed));
    setIsVoiceReview(true);
  };

  const mergeVoiceTranscript = (current: string, transcript: string) => {
    const currentTrimmed = current.trim();
    const transcriptTrimmed = transcript.trim();
    return `${currentTrimmed}${currentTrimmed && transcriptTrimmed ? ', ' : ''}${transcriptTrimmed}`;
  };

  const commitVoiceTranscript = (): boolean => {
    const ignoredVoiceText = new Set(['Recording. Tap stop to transcribe.', 'Transcribing...']);
    const transcript = [voiceTranscriptRef.current, voiceInterimRef.current]
      .map((value) => value.trim())
      .filter((value) => value && !ignoredVoiceText.has(value))
      .join(' ')
      .trim();
    if (!transcript) {
      setVoiceState('idle');
      voiceInterimRef.current = '';
      return false;
    }
    reviewVoiceTranscript(transcript);
    discardAudioRecording();
    clearVoiceState();
    return true;
  };

  const clearVoiceState = () => {
    voiceTranscriptRef.current = '';
    voiceInterimRef.current = '';
    voiceHadResultRef.current = false;
    speechFailedRef.current = false;
    setVoiceLevel(0);
    setVoiceState('idle');
  };

  const clearComposerInput = () => {
    setInput('');
    setIsVoiceReview(false);
    setNote(null);
    setFeedback(null);
    setComposerState('idle');
  };

  const openMealSheet = () => {
    if (composerState === 'logged') {
      setComposerState('idle');
      setFeedback(null);
      setInput('');
      setIsVoiceReview(false);
    }
    setSheetDragY(0);
    setIsMealSheetOpen(true);
  };

  const closeMealSheet = ({ reset = false }: { reset?: boolean } = {}) => {
    if (isBusy) return;
    cancelVoice();
    setSheetDragY(0);
    setIsMealSheetOpen(false);
    if (reset) {
      setEditingEntryId(null);
      setPendingRecipeName(null);
      setRecipeText('');
      clearComposerInput();
    }
  };

  const startSheetDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (isBusy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sheetDragRef.current = { startY: event.clientY, lastY: event.clientY, lastT: performance.now(), velocity: 0 };
  };

  const moveSheetDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = sheetDragRef.current;
    if (!drag || isBusy) return;
    const now = performance.now();
    const dy = Math.max(0, event.clientY - drag.startY);
    const elapsed = Math.max(now - drag.lastT, 1);
    drag.velocity = ((event.clientY - drag.lastY) / elapsed) * 1000;
    drag.lastY = event.clientY;
    drag.lastT = now;
    setSheetDragY(Math.min(180, dy));
  };

  const finishSheetDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = sheetDragRef.current;
    sheetDragRef.current = null;
    if (!drag || isBusy) return;
    const dy = Math.max(0, event.clientY - drag.startY);
    if (dy > 92 || drag.velocity > 720) {
      closeMealSheet();
      return;
    }
    setSheetDragY(0);
  };

  const startVoiceMeter = (stream: MediaStream) => {
    stopVoiceMeter();
    const AudioContextCtor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const audioContext = new AudioContextCtor() as AudioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      audioContextRef.current = audioContext;

      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / samples.length);
        const nextLevel = Math.min(1, Math.max(0, (rms - 0.018) * 9));
        setVoiceLevel((current) => current * 0.72 + nextLevel * 0.28);
        audioFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      addDevLog({
        level: 'warn',
        source: 'Voice',
        message: 'Could not start live microphone meter.',
        details: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  };

  const stopVoiceMeter = () => {
    if (audioFrameRef.current !== null) {
      cancelAnimationFrame(audioFrameRef.current);
      audioFrameRef.current = null;
    }
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setVoiceLevel(0);
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
    } catch (err) {
      showMealError('Saving a recurring meal failed.', err);
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
    setIsMealSheetOpen(true);
  };

  const selectEntry = (entryId: string, shouldScroll = true) => {
    setSelectedEntryId(entryId);
    setActionsOpenId(null);
    if (shouldScroll) {
      periodTabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const composerUiState: ComposerUiState =
    composerState === 'logged' && feedback
      ? 'feedback'
      : isBusy
        ? 'sending'
        : voiceState === 'transcribing'
          ? 'transcribing'
        : voiceState === 'recording'
          ? 'recording'
          : isVoiceReview
            ? 'transcribed'
            : input.trim()
              ? 'typing'
              : 'idle';
  const composerExpanded = composerUiState === 'typing' || composerUiState === 'transcribed';

  return (
    <div className={`log-paper-screen ${PAGE_CONTAINER_CLASS}`}>
      <h1 className="text-[26px] font-semibold leading-[0.96] text-neutral-950">Let's hit those macros</h1>
      {viewMode === 'today' && whoopSummary && whoopDailyInsight(whoopSummary) && (
        <p className="mt-2 text-sm leading-5 text-neutral-500">{whoopDailyInsight(whoopSummary)}</p>
      )}

      <div className="period-tabs mt-8 scroll-mt-[52px]" ref={periodTabsRef}>
        {(['today', 'week', 'month'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            className={`period-tab ${viewMode === mode ? 'is-active' : ''}`}
            onClick={() => setViewMode(mode)}
          >
            {mode === 'today' ? 'Today' : mode === 'week' ? 'Past week' : 'Past month'}
          </button>
        ))}
      </div>

      {viewMode === 'week' ? (
        <PeriodSummary days={weekSummaries} targets={targets} title="Past 7 days" />
      ) : viewMode === 'month' ? (
        <PeriodSummary days={monthSummaries} targets={targets} title="Past 30 days" />
      ) : (
        <>
      <div className="mt-6 scroll-mt-4" ref={chartRef}>
        <MacroSummary
          totals={chartTotals}
          targets={targets}
          showingLabel={selectedEntry?.description ?? null}
          onClearShowing={() => setSelectedEntryId(null)}
        />
      </div>

      <div className="mt-7">
        <div className="today-meals-header">
          <h2 className="text-sm font-semibold uppercase leading-[1.2] text-neutral-950">Today's meals</h2>
          <button className="meal-log-cta" type="button" onClick={openMealSheet}>
            Log meal
          </button>
        </div>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-400">Nothing logged yet.</p>
        ) : (
          <ul className="mt-2">
            {entries.map((e) => {
              const badge = mealBadge(e);
              const isMenuOpen = actionsOpenId === e.id;
              return (
              <li
                key={e.id}
                className={`meal-list-item px-2 py-2 ${selectedEntryId === e.id ? 'is-selected' : ''}`}
              >
                <div className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex w-full flex-col items-start gap-1 bg-white text-left"
                    onClick={() => selectEntry(e.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectEntry(e.id);
                      }
                    }}
                  >
                    <div className="flex w-full items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 truncate text-[15px] font-medium leading-[1.25] text-neutral-950">
                        {e.description}
                      </div>
                      <span className={`shrink-0 rounded-xl px-2.5 py-1 text-[13px] font-semibold leading-none ${badge.className}`}>
                        {badge.label}
                      </span>
                      <DropdownMenu.Root
                        open={isMenuOpen}
                        onOpenChange={(open) => setActionsOpenId(open ? e.id : null)}
                      >
                        <DropdownMenu.Trigger asChild>
                          <button
                            className="grid h-8 w-8 shrink-0 place-items-center text-neutral-400"
                            onClick={(event) => event.stopPropagation()}
                            aria-label="More actions"
                          >
                            <MoreIcon />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content
                            align="end"
                            sideOffset={4}
                            collisionPadding={12}
                            className="z-20 w-[188px] rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg shadow-neutral-200/70"
                          >
                            <DropdownMenu.Item
                              className="flex h-9 w-full cursor-pointer items-center whitespace-nowrap rounded-lg px-3 text-left text-[14px] font-medium text-neutral-900 outline-none data-[highlighted]:bg-neutral-50"
                              onSelect={() => handleEdit(e)}
                            >
                              Edit meal
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="flex h-9 w-full cursor-pointer items-center whitespace-nowrap rounded-lg px-3 text-left text-[14px] font-medium text-red-600 outline-none data-[highlighted]:bg-red-50"
                              onSelect={() => handleDelete(e.id)}
                            >
                              Remove from today
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </div>
                    <div className="w-full text-[12px] leading-[1.4] text-[#737373]">
                      {Math.round(e.calories)} kcal · {Math.round(e.protein)}g protein · {Math.round(e.carbs)}g carbs · {Math.round(e.fat)}g fat
                    </div>
                  </div>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </div>
        </>
      )}
      {isMealSheetOpen && (
        <div className="meal-sheet-layer" role="presentation">
          <button
            className="meal-sheet-scrim"
            type="button"
            aria-label="Dismiss meal logger"
            onClick={() => closeMealSheet()}
            disabled={isBusy}
          />
          <section
            className="meal-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Log meal"
            style={{ '--sheet-drag-y': `${sheetDragY}px` } as CSSProperties}
          >
            <div
              className="meal-sheet-handle-zone"
              onPointerDown={startSheetDrag}
              onPointerMove={moveSheetDrag}
              onPointerUp={finishSheetDrag}
              onPointerCancel={finishSheetDrag}
            >
              <div className="meal-sheet-handle" />
            </div>
            <div className="meal-sheet-content">
              {pendingRecipeName ? (
                <div className="meal-sheet-recipe">
                  <p className="text-sm font-semibold text-neutral-900">What's in "{pendingRecipeName}"?</p>
                  <p className="mt-1 text-xs text-neutral-500">I'll remember this so next time you just say the name.</p>
                  <textarea
                    className="mt-3 w-full resize-none rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base outline-none focus:border-neutral-400"
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
                      className="flex-1 rounded-2xl bg-neutral-950 py-3 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={submitRecipe}
                      disabled={isBusy || !recipeText.trim()}
                    >
                      {isBusy ? 'Saving...' : 'Save & Log'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {editingEntryId && (
                    <div className="mb-3 flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      <span>Editing logged item</span>
                      <button
                        className="rounded-full px-2 py-1 text-amber-900"
                        onClick={() => {
                          setEditingEntryId(null);
                          clearComposerInput();
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <div
                    className={`nutri-composer ${
                      composerExpanded || isComposerMultiline ? 'is-expanded' : ''
                    } ${composerUiState === 'recording' ? 'is-recording' : ''} ${composerUiState === 'sending' ? 'is-sending' : ''} ${
                      composerUiState === 'feedback' ? 'is-feedback' : ''
                    }`}
                  >
                    {composerUiState === 'recording' && (
                      <div className="nutri-recording-row">
                        <VoiceWaveform level={voiceLevel} />
                        <button className="nutri-circle-button is-stop" type="button" aria-label="Stop recording" onClick={() => stopVoice()}>
                          <span className="voice-stop-glyph" />
                        </button>
                      </div>
                    )}
                    {composerUiState === 'transcribing' && (
                      <div className="nutri-sending-row">
                        <span>Transcribing...</span>
                        <span className="nutri-progress-dot" aria-hidden="true" />
                      </div>
                    )}
                    {composerUiState === 'sending' && (
                      <div className="nutri-sending-row">
                        <span>Calculating macros...</span>
                        <button className="nutri-circle-button" type="button" aria-label="Calculating macros" disabled>
                          <ArrowUpIcon />
                        </button>
                      </div>
                    )}
                    {composerUiState === 'feedback' && feedback && (
                      <div className="nutri-feedback-row">
                        <span>{feedback.text}</span>
                        <button type="button" aria-label="Done" onClick={() => closeMealSheet({ reset: true })}>
                          Done
                        </button>
                      </div>
                    )}
                    {(composerUiState === 'idle' || composerUiState === 'typing' || composerUiState === 'transcribed') && (
                      <>
                        <div className="nutri-input-row">
                          <textarea
                            ref={composerInputRef}
                            className="nutri-input"
                            rows={1}
                            placeholder={mealComposerPlaceholder()}
                            value={input}
                            onChange={(e) => {
                              setInput(e.target.value);
                              setNote(null);
                              setFeedback(null);
                              setIsVoiceReview(false);
                              setComposerState('idle');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                setIsVoiceReview(false);
                                submitText(input);
                              }
                            }}
                            disabled={composerState === 'logged'}
                          />
                          {composerUiState === 'idle' && (
                            <button className="nutri-inline-mic" type="button" aria-label="Record meal" onClick={startVoice}>
                              <MicIcon />
                            </button>
                          )}
                        </div>
                        {(composerUiState === 'typing' || composerUiState === 'transcribed') && (
                          <div className="nutri-control-row">
                            {composerUiState === 'transcribed' ? (
                              <button className="nutri-circle-button" type="button" aria-label="Discard transcript" onClick={clearComposerInput}>
                                <CloseIcon />
                              </button>
                            ) : (
                              <button className="nutri-circle-button is-ghost" type="button" aria-label="Record instead" onClick={startVoice}>
                                <MicIcon />
                              </button>
                            )}
                            <button
                              className="nutri-circle-button is-primary"
                              type="button"
                              aria-label={editingEntryId ? 'Save meal' : 'Log meal'}
                              onClick={() => {
                                setIsVoiceReview(false);
                                submitText(input);
                              }}
                              disabled={!input.trim()}
                            >
                              <ArrowUpIcon />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {composerUiState === 'idle' && (
                    <div className="nutri-composer-helper">
                      You don't have to give accurate values. Nutri will calculate the estimate.
                    </div>
                  )}
                  {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                  {note && <p className="mt-3 text-sm text-amber-600">{note}</p>}
                </>
              )}
            </div>
          </section>
        </div>
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

function EditIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg className={className} viewBox="28 8 224 224" fill="currentColor" aria-hidden="true">
      <path d="M221.657 34.344a8 8 0 0 0-11.314 0L196 48.687 191.314 44a24 24 0 0 0-33.941 0L48 153.373A24 24 0 0 0 40.971 170.343V204a16 16 0 0 0 16 16h33.657A24 24 0 0 0 107.598 212.971L216.971 103.598a24 24 0 0 0 0-33.941L212.284 64.971 226.627 50.628a8 8 0 0 0 0-11.314ZM68 180.687 79.314 192H57.971v-21.343ZM96.284 201.657a8 8 0 0 1-11.314 0L59.314 176a8 8 0 0 1 0-11.314L136 88 172.971 124.971ZM205.657 92.284 184.284 113.657 147.314 76.686 168.686 55.314a8 8 0 0 1 11.314 0L205.657 80.971A8 8 0 0 1 205.657 92.284Z" />
    </svg>
  );
}

function TrashIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg className={className} viewBox="4 8 224 224" fill="currentColor" aria-hidden="true">
      <path d="M216 48H176V40a24 24 0 0 0-24-24H104A24 24 0 0 0 80 40v8H40a8 8 0 0 0 0 16h8V208a16 16 0 0 0 16 16H192a16 16 0 0 0 16-16V64h8a8 8 0 0 0 0-16ZM96 40a8 8 0 0 1 8-8h48a8 8 0 0 1 8 8v8H96ZM192 208H64V64H192ZM112 104v64a8 8 0 0 1-16 0V104a8 8 0 0 1 16 0Zm48 0v64a8 8 0 0 1-16 0V104a8 8 0 0 1 16 0Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 128 128" fill="currentColor" aria-hidden="true">
      <path d="M102.83 97.17a4 4 0 0 1-5.66 5.66L64 69.655 30.83 102.83a4 4 0 0 1-5.66-5.66L58.345 64 25.17 30.83A4 4 0 0 1 30.83 25.17L64 58.345l33.17-33.175a4 4 0 0 1 5.66 5.66L69.655 64Z" />
    </svg>
  );
}

function VoiceWaveform({ level }: { level: number }) {
  const bars = [5, 10, 16, 22, 12, 28, 18, 9, 24, 14, 20, 7, 17, 11, 25, 13];
  const activeLevel = level > 0.08 ? level : 0;
  return (
    <div className={`voice-waveform ${activeLevel > 0 ? 'is-speaking' : ''}`} aria-hidden="true">
      {bars.map((height, index) => {
        const wave = 0.55 + Math.abs(Math.sin(index * 1.7)) * 0.55;
        const liveHeight = Math.max(2, height * activeLevel * wave);
        return <span key={`${height}-${index}`} style={{ height: `${liveHeight}px` }} />;
      })}
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
