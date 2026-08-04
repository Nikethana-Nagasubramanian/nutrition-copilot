import { addDevLog } from './devLogs';

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const file = new File([audioBlob], `meal-audio.${audioExtension(audioBlob.type)}`, {
    type: audioBlob.type || 'audio/webm',
  });
  const form = new FormData();
  form.append('file', file);
  form.append('model', 'gpt-4o-mini-transcribe');
  form.append('language', 'en');
  form.append('prompt', 'Food and meal descriptions for a nutrition tracker. Return only the spoken words.');

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: form,
  });

  const text = await response.text();
  if (!response.ok) {
    addDevLog({
      level: 'error',
      source: 'Voice',
      message: `Audio transcription failed (${response.status}).`,
      details: text,
    });
    throw new Error(`Audio transcription failed (${response.status}).`);
  }

  const parsed = safeParseJson(text);
  const transcript = typeof parsed?.text === 'string' ? parsed.text.trim() : text.trim();
  if (!transcript) throw new Error('Audio transcription returned no text.');

  addDevLog({
    level: 'info',
    source: 'Voice',
    message: 'Audio recording transcribed successfully.',
  });
  return transcript;
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

function safeParseJson(value: string): { text?: unknown } | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
