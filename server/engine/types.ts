export const SIGNS = ["breathless", "pain", "cough", "distress", "slurred"] as const;
export type Sign = (typeof SIGNS)[number];
export type HiddenSign = Sign | "none";

export const URGENCY = ["routine", "soon", "urgent"] as const;
export type Urgency = (typeof URGENCY)[number];

export const VOICES = ["Kore", "Puck", "Charon", "Leda", "Orus", "Aoede", "Callirrhoe", "Iapetus", "Umbriel", "Algieba"] as const;

/** What the patient author writes. */
export type PatientScript = {
  persona: string;
  spoken_text: string;
  tts_style: string;
  voice: string;
  hidden_sign: HiddenSign;
  expected_urgency: Urgency;
};

export const PROBE_KEYS = ["short_of_breath", "in_pain", "coughing", "distressed", "slurred", "long_pauses", "sounds_well"] as const;
export type ProbeKey = (typeof PROBE_KEYS)[number];
export type Probes = Record<ProbeKey, number>;

/** The probe that should fire for each sign. */
export const SIGN_PROBE: Record<Sign, ProbeKey> = {
  breathless: "short_of_breath",
  pain: "in_pain",
  cough: "coughing",
  distress: "distressed",
  slurred: "slurred",
};

export const SIGN_LABEL: Record<HiddenSign, string> = {
  breathless: "Short of breath",
  pain: "In pain",
  cough: "Coughing",
  distress: "Distressed",
  slurred: "Slurred speech",
  none: "Healthy control",
};

export const PROBE_LABEL: Record<ProbeKey, string> = {
  short_of_breath: "Short of breath",
  in_pain: "In pain",
  coughing: "Coughing",
  distressed: "Distressed",
  slurred: "Slurred speech",
  long_pauses: "Long pauses",
  sounds_well: "Sounds well",
};

export type GateResult = {
  kept: boolean;
  reason: string;
  attempts: number;
};

/** A patient after voice and gate. */
export type Patient = PatientScript & {
  id: string;
  set: string;
  author_model: string;
  clip: string; // path relative to the repo root
  seconds: number;
  probes: Probes;
  gate: GateResult;
};

export type Note = {
  observations: string[];
  red_flags: string[];
  urgency: Urgency;
};

export type ArmKey = "A" | "B" | "C";

export const ARM_LABEL: Record<ArmKey, string> = {
  A: "Transcript only",
  B: "Raw audio",
  C: "Transcript plus probes",
};

export type Grade = {
  /** P(the note identifies the hidden sign). Null for healthy controls. */
  identifies_sign: number | null;
  /** P(the note reports any abnormal sign in how the patient sounds). */
  flags_any_sign: number;
  caught: boolean | null;
  false_alarm: boolean | null;
  graded_urgency: Urgency;
  confidence: number;
  needs_review: boolean;
};

export type ArmResult = {
  arm: ArmKey;
  note: Note;
  grade: Grade;
  ms: number;
};

export type CaseResult = {
  patient: Patient;
  rung: string;
  transcript: string;
  arms: ArmResult[];
};
