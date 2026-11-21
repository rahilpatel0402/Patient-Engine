// Station 1: Listening. One patient clip goes through three arms on the same
// clinician model, and each note is graded against the hidden sign.
//   A. Transcript only: what most pipelines see today
//   B. Raw audio: what the model hears with no help
//   C. Transcript plus perception probes: the listen-first repair
import { abs } from "../engine/build.ts";
import {
  PROBE_KEYS,
  PROBE_LABEL,
  URGENCY,
  type ArmKey,
  type ArmResult,
  type CaseResult,
  type Grade,
  type HiddenSign,
  type Note,
  type Patient,
  type Probes,
  type Urgency,
} from "../engine/types.ts";
import { MODELS, decide, generateJson, noul, transcribe, type Question } from "../lib/gemini.ts";

export const REVIEW_BELOW = 0.7;

const CLINICIAN_SYSTEM = `You are a triage clinician. You are given the opening statement of one patient contacting a clinic. Every patient is synthetic and this is a software test.

Write a brief structured note based only on what you are given.
- observations: what you notice about the patient, in what they say and in how they present. Short factual phrases.
- red_flags: anything that concerns you. Use an empty list if nothing does.
- urgency: routine, soon, or urgent.`;

const NOTE_SCHEMA = {
  type: "object",
  properties: {
    observations: { type: "array", items: { type: "string" } },
    red_flags: { type: "array", items: { type: "string" } },
    urgency: { type: "string", enum: [...URGENCY] },
  },
  required: ["observations", "red_flags", "urgency"],
};

function probeLines(probes: Probes): string {
  return PROBE_KEYS.map((k) => `- ${PROBE_LABEL[k]}: ${probes[k].toFixed(2)}`).join("\n");
}

export type ArmInput = { transcript: string; clip: string; probes: Probes };

export async function runArm(arm: ArmKey, input: ArmInput, model: string = MODELS.hydrogen): Promise<{ note: Note; ms: number }> {
  const transcriptText = `Patient's opening statement, transcript:\n"${input.transcript}"`;
  const text =
    arm === "A"
      ? transcriptText
      : arm === "B"
        ? "Patient's opening statement, audio recording attached."
        : `${transcriptText}\n\nA listening model heard the recording. Each line is the probability from 0 to 1 that the statement is true of the patient's voice:\n${probeLines(input.probes)}`;

  const out = await generateJson<Note>({
    model,
    system: CLINICIAN_SYSTEM,
    text,
    audio: arm === "B" ? { file: input.clip } : undefined,
    schema: NOTE_SCHEMA,
    thinking: "low",
  });
  return { note: out.value, ms: out.ms };
}

// ---- grader ------------------------------------------------------------------

const SIGN_FINDING: Record<Exclude<HiddenSign, "none">, string> = {
  breathless: "sounds short of breath or is having difficulty breathing",
  pain: "sounds like they are in physical pain",
  cough: "is coughing",
  distress: "sounds emotionally distressed, frightened, or tearful",
  slurred: "has slurred speech (slow or laboured speech alone does not count)",
};

const ANY_SIGN: Question = {
  type: "noul",
  instructions:
    "Does the clinician's note report anything abnormal about how the patient sounds or presents, such as breathlessness, pain, coughing, emotional distress, or slurred speech?",
  criteria: {
    true_description: "The note reports at least one abnormal finding in the patient's voice or presentation.",
    false_description: "The note reports nothing abnormal, or says the patient seems well.",
  },
};

const URGENCY_Q: Question = {
  type: "choice",
  instructions: "How urgently does the clinician's note say this patient should be seen?",
  criteria: {
    routine: "No concern. Handle as an ordinary request.",
    soon: "Some concern. Follow up or assess soon.",
    urgent: "Serious concern. Assess immediately.",
  },
};

export async function grade(note: Note, sign: HiddenSign): Promise<Grade> {
  const questions: Record<string, Question> = { flags_any_sign: ANY_SIGN, urgency: URGENCY_Q };
  if (sign !== "none") {
    questions.identifies_sign = {
      type: "noul",
      instructions: `Does the clinician's note recognize that the patient ${SIGN_FINDING[sign]}?`,
      criteria: {
        true_description: "The note states or clearly implies this finding.",
        false_description: "The note does not mention this finding, or says the patient seems well.",
      },
    };
  }
  const out = await decide({ text: `Clinician's note:\n${JSON.stringify(note, null, 2)}`, questions });
  const flags = noul(out.value, "flags_any_sign");
  const identifies = sign === "none" ? null : noul(out.value, "identifies_sign");
  const urgency = out.value.urgency;
  const decisive = identifies ?? flags;
  const confidence = Math.max(decisive, 1 - decisive);
  return {
    identifies_sign: identifies === null ? null : Number(identifies.toFixed(3)),
    flags_any_sign: Number(flags.toFixed(3)),
    caught: identifies === null ? null : identifies >= 0.5,
    false_alarm: sign === "none" ? flags >= 0.5 : null,
    graded_urgency: (urgency?.type === "choice" ? urgency.choice : note.urgency) as Urgency,
    confidence: Number(confidence.toFixed(3)),
    needs_review: confidence < REVIEW_BELOW,
  };
}

// ---- one case ------------------------------------------------------------------

export async function runCase(
  patient: Patient,
  opts: { rung?: string; clip?: string; probes?: Probes; arms?: ArmKey[]; model?: string } = {},
): Promise<CaseResult> {
  const clip = opts.clip ?? abs(patient.clip);
  const probes = opts.probes ?? patient.probes;
  const transcript = (await transcribe({ file: clip })).value.trim();
  const arms = await Promise.all(
    (opts.arms ?? (["A", "B", "C"] as ArmKey[])).map(async (arm): Promise<ArmResult> => {
      const { note, ms } = await runArm(arm, { transcript, clip, probes }, opts.model);
      return { arm, note, ms, grade: await grade(note, patient.hidden_sign) };
    }),
  );
  return { patient, rung: opts.rung ?? "clean", transcript, arms };
}
