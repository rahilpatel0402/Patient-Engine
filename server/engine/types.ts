// Every sign is something a listener can hear. None is a diagnosis or a symptom
// the patient would have to report. Pain itself cannot be heard, so the sign is
// the behaviour that goes with it: groaning or crying out.
export const SIGNS = ["breathless", "groaning", "cough", "distress", "slurred"] as const;
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
  /** For healthy controls: plain, or a harmless voice trait that could be mistaken for a sign. */
  control_kind?: string;
};

export const PROBE_KEYS = ["short_of_breath", "groaning", "coughing", "distressed", "slurred", "long_pauses", "sounds_well"] as const;
export type ProbeKey = (typeof PROBE_KEYS)[number];
export type Probes = Record<ProbeKey, number>;

/** The probe that should fire for each sign. */
export const SIGN_PROBE: Record<Sign, ProbeKey> = {
  breathless: "short_of_breath",
  groaning: "groaning",
  cough: "coughing",
  distress: "distressed",
  slurred: "slurred",
};

export const SIGN_LABEL: Record<HiddenSign, string> = {
  breathless: "Short of breath",
  groaning: "Groaning or crying out",
  cough: "Coughing",
  distress: "Tearful or frightened",
  slurred: "Slurred speech",
  none: "Healthy control",
};

export const PROBE_LABEL: Record<ProbeKey, string> = {
  short_of_breath: "Short of breath",
  groaning: "Groaning or crying out",
  coughing: "Coughing",
  distressed: "Tearful or frightened",
  slurred: "Slurred speech",
  long_pauses: "Long pauses",
  sounds_well: "Sounds well",
};

/** Signs one probe number cannot be trusted to validate. Two listeners vote, and a physician settles disagreements. */
export const PHYSICIAN_GATED: readonly HiddenSign[] = ["slurred"];

export type AutoGate = {
  decision: "keep" | "drop" | "review";
  probe: number;
  listener: "no" | "mild" | "clear";
  listener_model: string;
  why: string;
};

export type PhysicianVerdict = { valid: boolean; note: string; at: string };

export type GateResult = {
  kept: boolean;
  reason: string;
  attempts: number;
  /** Who decided: the probe alone, two automatic listeners agreeing, or a physician who listened. */
  by?: "probe" | "consensus" | "physician";
  /** What the automatic listeners said, kept even after a physician decides. */
  auto?: AutoGate;
  physician?: PhysicianVerdict;
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
  /**
   * Sign patients: caught, missed, or unclear. Controls: quiet, alarm, or unclear.
   * Unclear means the grader was not confident either way. It is never counted
   * as caught. It goes to physician review.
   */
  status: "caught" | "missed" | "quiet" | "alarm" | "unclear";
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
