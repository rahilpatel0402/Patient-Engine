// Consensus gate for slurred speech.
// The Decisions API under-hears slurring, so one number is not enough to judge a
// clip. Two automatic listeners vote: the Decisions API probe and a second Gemini 4
// model that hears the audio. When they agree, the clip is kept or dropped with no
// human. Only when they disagree does a physician listen.
import { MODELS, generateJson, type AudioRef } from "../lib/gemini.ts";
import type { AutoGate } from "./types.ts";

export const SECOND_LISTENER = MODELS.carbon;

// Chosen on the practice clips a physician labelled. With so few labelled clips
// these are a starting point, not a calibrated threshold.
export const SLUR_KEEP_AT = 0.7;
export const SLUR_DROP_BELOW = 0.4;

const SCHEMA = {
  type: "object",
  properties: {
    articulation: { type: "string", description: "One sentence on how the words are articulated." },
    slurred: { type: "string", enum: ["no", "mild", "clear"] },
  },
  required: ["articulation", "slurred"],
};

const SYSTEM =
  "You are listening to a short recording of a person speaking. Judge only the articulation of the words: are they slurred? Slow, breathless, hoarse, coughing, or tearful speech is not slurred unless the words themselves are blurred.";

export async function secondListener(audio: AudioRef): Promise<{ slurred: "no" | "mild" | "clear"; articulation: string }> {
  const out = await generateJson<{ slurred: "no" | "mild" | "clear"; articulation: string }>({
    model: SECOND_LISTENER,
    system: SYSTEM,
    text: "Recording attached.",
    audio,
    schema: SCHEMA,
    thinking: "low",
  });
  return out.value;
}

export function slurConsensus(probe: number, listener: "no" | "mild" | "clear"): AutoGate {
  const base = { probe: Number(probe.toFixed(3)), listener, listener_model: SECOND_LISTENER };
  if (probe >= SLUR_KEEP_AT && listener !== "no") return { ...base, decision: "keep", why: `both listeners heard slurred speech (probe ${probe.toFixed(2)}, second listener: ${listener})` };
  if (probe < SLUR_DROP_BELOW && listener === "no") return { ...base, decision: "drop", why: `neither listener heard slurred speech (probe ${probe.toFixed(2)}, second listener: no)` };
  return { ...base, decision: "review", why: `the listeners are not sure or disagree (probe ${probe.toFixed(2)}, second listener: ${listener})` };
}
