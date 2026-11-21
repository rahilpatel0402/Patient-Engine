// Pure summaries of Station 1 results. No Node imports, so the client can use these too.
import { PHYSICIAN_GATED, SIGN_PROBE, type ArmKey, type CaseResult, type HiddenSign, type Patient } from "../engine/types.ts";

export const ARMS: ArmKey[] = ["A", "B", "C"];
export const BARS = [0.5, 0.6, 0.7, 0.8, 0.9];
export const CHOSEN_BAR = 0.8;

/** unclear: the grader was not confident either way. Not counted as caught. */
export type Tally = { caught: number; unclear: number; of: number };

export type SensitivityRow = {
  /** The pass mark tried. Null means no gate at all: every generated clip counts. */
  bar: number | null;
  kept: number;
  generated: number;
  arms: Record<ArmKey, Tally>;
};

const probeGated = (sign: HiddenSign) => sign !== "none" && !PHYSICIAN_GATED.includes(sign);

function tally(cases: CaseResult[]): Record<ArmKey, Tally> {
  const out = {} as Record<ArmKey, Tally>;
  for (const arm of ARMS) {
    const ran = cases.filter((c) => c.arms.some((a) => a.arm === arm));
    const grades = ran.map((c) => c.arms.find((a) => a.arm === arm)!.grade);
    out[arm] = { caught: grades.filter((g) => g.caught).length, unclear: grades.filter((g) => g.needs_review).length, of: ran.length };
  }
  return out;
}

/**
 * What the result would have been at other pass marks. Only signs gated by the
 * probe are included: for a physician-gated sign the number is not the pass mark.
 * Needs the arms to have been run on every generated clip, kept or dropped.
 */
export function sensitivity(patients: Patient[], cases: CaseResult[]): SensitivityRow[] {
  const eligible = patients.filter((p) => probeGated(p.hidden_sign));
  const caseFor = new Map(cases.map((c) => [c.patient.id, c]));
  const row = (bar: number | null): SensitivityRow => {
    const kept = eligible.filter((p) => bar === null || p.probes[SIGN_PROBE[p.hidden_sign as keyof typeof SIGN_PROBE]] >= bar);
    return {
      bar,
      kept: kept.length,
      generated: eligible.length,
      arms: tally(kept.map((p) => caseFor.get(p.id)).filter((c): c is CaseResult => Boolean(c))),
    };
  };
  return [...BARS.map(row), row(null)];
}

/** Headline counts for the clips that are in the test. */
export function headline(patients: Patient[], cases: CaseResult[]) {
  const kept = new Set(patients.filter((p) => p.gate.kept).map((p) => p.id));
  const counted = cases.filter((c) => kept.has(c.patient.id));
  const signCases = counted.filter((c) => c.patient.hidden_sign !== "none");
  const controls = counted.filter((c) => c.patient.hidden_sign === "none");
  const falseAlarms = {} as Record<ArmKey, Tally>;
  for (const arm of ARMS) {
    const grades = controls.map((c) => c.arms.find((a) => a.arm === arm)?.grade);
    falseAlarms[arm] = { caught: grades.filter((g) => g?.false_alarm).length, unclear: grades.filter((g) => g?.needs_review).length, of: controls.length };
  }
  return {
    generated: patients.length,
    left_out: patients.length - kept.size,
    signs: tally(signCases),
    false_alarms: falseAlarms,
    review: counted.reduce((n, c) => n + c.arms.filter((a) => a.grade.needs_review).length, 0),
  };
}
