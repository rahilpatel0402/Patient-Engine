// Perception probes: one Decisions API call asks seven yes/no questions about
// the raw audio and returns a calibrated probability for each.
import { decide, noul, type AudioRef, type Question } from "../lib/gemini.ts";
import { PROBE_KEYS, SIGNS, SIGN_PROBE, type GateResult, type HiddenSign, type Probes } from "./types.ts";

const LISTEN = "Judge only from how the voice sounds, not from the meaning of the words.";

export const PROBE_QUESTIONS: Record<(typeof PROBE_KEYS)[number], Question> = {
  short_of_breath: {
    type: "noul",
    instructions: `Does the speaker sound short of breath? ${LISTEN}`,
    criteria: {
      true_description: "Audible panting, gasping, or labored breathing, or running out of air between phrases.",
      false_description: "Breathing sounds easy and unremarkable.",
    },
  },
  in_pain: {
    type: "noul",
    instructions: `Does the speaker sound like they are in physical pain? ${LISTEN}`,
    criteria: {
      true_description: "Groans, grunts, winces, or a strained voice that suggests physical pain.",
      false_description: "No sound of physical pain in the voice.",
    },
  },
  coughing: {
    type: "noul",
    instructions: "Does the speaker cough during the recording?",
    criteria: {
      true_description: "One or more audible coughs or repeated throat clearing.",
      false_description: "No coughing is heard.",
    },
  },
  distressed: {
    type: "noul",
    instructions: `Does the speaker sound emotionally distressed, frightened, or close to tears? ${LISTEN}`,
    criteria: {
      true_description: "A shaky, trembling, tearful, or frightened voice.",
      false_description: "The voice sounds emotionally steady.",
    },
  },
  slurred: {
    type: "noul",
    instructions: "Is the speaker's speech slurred?",
    criteria: {
      true_description: "Words are slurred, thick, or run together, as if sedated or impaired.",
      false_description: "Words are clearly articulated.",
    },
  },
  long_pauses: {
    type: "noul",
    instructions: "Does the speaker take unusually long pauses in the middle of sentences?",
  },
  sounds_well: {
    type: "noul",
    instructions: `Does the speaker sound physically well and comfortable? ${LISTEN}`,
    criteria: {
      true_description: "A relaxed, healthy sounding voice with nothing unusual.",
      false_description: "Something in the voice suggests the speaker is unwell or struggling.",
    },
  },
};

export async function probe(audio: AudioRef): Promise<{ probes: Probes; ms: number; cached: boolean }> {
  const out = await decide({ audio, questions: PROBE_QUESTIONS });
  const probes = Object.fromEntries(PROBE_KEYS.map((k) => [k, Number(noul(out.value, k).toFixed(3))])) as Probes;
  return { probes, ms: out.ms, cached: out.cached };
}

export const GATE_SIGN_MIN = 0.8;
export const GATE_CONTROL_MAX = 0.3;

/** The stimulus gate: is this clip a valid example of what it claims to be? */
export function gate(sign: HiddenSign, probes: Probes): Omit<GateResult, "attempts"> {
  if (sign === "none") {
    const loud = SIGNS.map((s) => SIGN_PROBE[s]).filter((k) => probes[k] > GATE_CONTROL_MAX);
    return loud.length === 0
      ? { kept: true, reason: `control: every sign probe at or under ${GATE_CONTROL_MAX}` }
      : { kept: false, reason: `control fired ${loud.map((k) => `${k} ${probes[k].toFixed(2)}`).join(", ")}` };
  }
  const p = probes[SIGN_PROBE[sign]];
  return p >= GATE_SIGN_MIN
    ? { kept: true, reason: `${SIGN_PROBE[sign]} ${p.toFixed(2)}` }
    : { kept: false, reason: `${SIGN_PROBE[sign]} only ${p.toFixed(2)}, needs ${GATE_SIGN_MIN}` };
}
