// Patient author. A Gemini 4 model writes a synthetic patient whose words
// deny any problem while the voice direction carries one hidden sign.
import { generateJson } from "../lib/gemini.ts";
import { URGENCY, VOICES, type HiddenSign, type PatientScript } from "./types.ts";

const SIGN_BRIEF: Record<HiddenSign, string> = {
  breathless:
    "The patient is short of breath. tts_style should describe winded, breathless delivery with air running out between phrases. Use several inline tags from: <pant>, <heavy breath>, <breath>, <gasp>.",
  pain: "The patient is in physical pain. tts_style should describe a strained, tight voice, wincing and speaking through pain. Use several inline tags from: <groan>, <grunt>, <whimper>, <exhales>.",
  cough:
    "The patient keeps coughing. tts_style should describe a hoarse voice interrupted by coughing. Use several inline tags from: <cough>, <throat-clearing>.",
  distress:
    "The patient is frightened and emotionally distressed, not in physical pain. tts_style should describe a shaky, trembling voice close to tears. Use a few inline tags from: <sob>, <whimper>, <sigh>, <short pause>.",
  slurred:
    "The patient's speech is slurred. tts_style should describe slow, thick, slurred speech with words running together, as if heavily sedated. Use several <long pause> tags. The words themselves must stay coherent and make complete sense.",
  none: "The patient is a healthy control and sounds completely well. tts_style should describe a calm, relaxed, even conversational tone. Use no inline tags at all.",
};

const REASONS = [
  "a prescription refill",
  "rescheduling an appointment",
  "a form that needs a signature",
  "picking up test results",
  "a referral letter",
  "a question about pharmacy hours",
  "a routine check-up booking",
  "updating their address on file",
];

const PEOPLE = [
  "a retired bus driver in his seventies",
  "a nurse in her forties calling on her break",
  "a college student in his twenties",
  "a grandmother in her eighties who lives alone",
  "a construction foreman in his fifties",
  "a new mother in her thirties",
  "a restaurant owner in her sixties",
  "a long-haul trucker in his forties",
  "a schoolteacher in her fifties",
  "a software engineer in his thirties",
  "a farmer in his sixties",
  "a hairdresser in her twenties",
];

const SCHEMA = {
  type: "object",
  properties: {
    persona: { type: "string", description: "One sentence: who the patient is and why they are calling." },
    spoken_text: {
      type: "string",
      description: "Exactly what the patient says aloud, 30 to 45 words, first person, with inline TTS tags in angle brackets.",
    },
    tts_style: { type: "string", description: "Sustained delivery style for the whole turn, under 20 words." },
    voice: { type: "string", enum: [...VOICES] },
    expected_urgency: { type: "string", enum: [...URGENCY] },
  },
  required: ["persona", "spoken_text", "tts_style", "voice", "expected_urgency"],
};

const SYSTEM = `You write synthetic patients for a test of clinical AI listening. Every patient is fictional. No real person is described.

Each patient speaks one short opening statement to a clinic. The rules:
1. The WORDS always minimize. The patient says they are fine and only wants something routine.
2. The words must never name, describe, or hint at any symptom, illness, body part, medicine type, or feeling unwell. A reader of the bare transcript must find nothing to worry about.
3. The hidden sign lives ONLY in the voice: in tts_style and in inline tags in angle brackets placed where the sound happens.
4. Use only these inline tags: <pant>, <heavy breath>, <breath>, <gasp>, <groan>, <grunt>, <whimper>, <exhales>, <cough>, <throat-clearing>, <sob>, <sigh>, <short pause>, <long pause>.
5. spoken_text is 30 to 45 words so it lasts 10 to 20 seconds. Natural spoken English, no stage directions outside the angle bracket tags.
6. expected_urgency is how soon a clinician who heard the voice should act: routine, soon, or urgent. Healthy controls are routine.`;

export type Slot = { index: number; sign: HiddenSign; set: string };

export async function writePatient(model: string, slot: Slot): Promise<PatientScript> {
  // Different sets draw different people and reasons, so wording does not repeat.
  const offset = slot.set === "exam" ? 5 : 0;
  const person = PEOPLE[(slot.index * 5 + offset) % PEOPLE.length];
  const reason = REASONS[(slot.index * 3 + offset) % REASONS.length];
  const text = `Write patient number ${slot.index + 1} for the "${slot.set}" set.
Who: ${person}.
Stated reason for the call: ${reason}.
Hidden sign: ${slot.sign}. ${SIGN_BRIEF[slot.sign]}`;

  const out = await generateJson<Omit<PatientScript, "hidden_sign">>({ model, system: SYSTEM, text, schema: SCHEMA, thinking: "low" });
  return { ...out.value, hidden_sign: slot.sign };
}
