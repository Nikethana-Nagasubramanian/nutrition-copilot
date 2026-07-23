import type { ParsedMeal } from '../types/nutrition';

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;

const MEAL_SYSTEM_PROMPT = `You are a nutrition estimation assistant for a personal calorie-tracking app.
The user will describe what they ate in casual, imprecise language (spoken or typed).

Rules:
- Always estimate conservatively.
- Never overestimate protein. If uncertain, use the lower bound of a reasonable protein range.
- Never underestimate calories. If uncertain, use the upper-reasonable bound of a reasonable calorie range.
- Break the meal into individual food items.
- Mark each item's confidence as "low" if the description was vague (e.g. no quantity given) or "high" if it was specific.
- Respond ONLY with valid JSON matching this exact shape, no prose, no markdown fences:
{
  "foods": [
    { "name": string, "calories": number, "protein": number, "carbs": number, "fat": number, "confidence": "high" | "low" }
  ],
  "totals": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "lowConfidenceNote": string | null
}
Set lowConfidenceNote to a short (<20 words) note if any item has low confidence, explaining what's uncertain. Otherwise null.`;

function requireApiKey() {
  if (!API_KEY) {
    throw new Error('VITE_OPENAI_API_KEY is not set. Add it to your .env file.');
  }
}

function extractJson(content: string): any {
  const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '');
  return JSON.parse(cleaned);
}

export async function parseMealDescription(description: string): Promise<ParsedMeal> {
  requireApiKey();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: MEAL_SYSTEM_PROMPT },
        { role: 'user', content: description },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response.');

  const parsed = extractJson(content) as ParsedMeal;
  if (!parsed.foods || !parsed.totals) throw new Error('OpenAI response was missing expected fields.');
  return parsed;
}

// Single multimodal call: audio in, structured meal JSON out. No separate transcription step.
export async function parseMealFromAudio(audioBlob: Blob): Promise<ParsedMeal> {
  requireApiKey();

  const base64Audio = await blobToBase64(audioBlob);
  const format = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('mp3') ? 'mp3' : 'wav';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-audio-preview',
      modalities: ['text'],
      messages: [
        { role: 'system', content: MEAL_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: base64Audio, format } },
          ],
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response.');

  const parsed = extractJson(content) as ParsedMeal;
  if (!parsed.foods || !parsed.totals) throw new Error('OpenAI response was missing expected fields.');
  return parsed;
}

export async function askNutritionQuestion(
  question: string,
  todayTotals: string,
  targets: string
): Promise<string> {
  requireApiKey();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a concise nutrition copilot for a single user tracking their own food intake.
Estimate conservatively (never overestimate protein, never underestimate calories).
Given the user's current daily totals and targets, answer their question directly and briefly.
Show the resulting numbers if they eat/drink what they're asking about. Keep replies under 80 words, no markdown headers.`,
        },
        {
          role: 'user',
          content: `Today so far: ${todayTotals}\nDaily targets: ${targets}\nQuestion: ${question}`,
        },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "Couldn't get an answer, try again.";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
