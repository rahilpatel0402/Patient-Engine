// Pure summaries of Station 1 results. No Node imports, so the client can use these too.
import { PHYSICIAN_GATED, SIGNS, SIGN_PROBE, type ArmKey, type CaseResult, type HiddenSign, type Patient, type Probes, type Sign } from "../engine/types.ts";

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

// ---- model comparison ------------------------------------------------------------
// The same exam with a different Gemini 4 model as the clinician under test.

export type Comparison = { set: string; models: { model: string; cases: CaseResult[] }[] };

export type ComparisonRow = { model: string; main: boolean; signs: Record<ArmKey, Tally>; false_alarms: Record<ArmKey, Tally> };

/** One row per clinician model. `mainModel` and `mainCases` are the main Station 1 run. */
export function comparisonRows(patients: Patient[], mainModel: string, mainCases: CaseResult[], comparison: Comparison | null): ComparisonRow[] {
  const row = (model: string, cases: CaseResult[], main: boolean): ComparisonRow => {
    const h = headline(patients, cases);
    return { model, main, signs: h.signs, false_alarms: h.false_alarms };
  };
  return [row(mainModel, mainCases, true), ...(comparison?.models ?? []).map((m) => row(m.model, m.cases, false))];
}

// ---- stress ladder ---------------------------------------------------------------
// The same clips, degraded step by step: phone quality, then room noise recorded
// at the venue, mixed in at set ratios of voice to noise.

export type LadderRung = { id: string; label: string; kind: "clean" | "phone" | "noise"; snr: number | null };

export type Ladder = {
  set: string;
  noise: { seconds: number; level_db: number; uploaded: string } | null;
  rungs: LadderRung[];
  /** Probe results for every clip at every degraded rung: rung id, then patient id. */
  probes: Record<string, Record<string, Probes>>;
  /** The hardest rung where the probes still hold, and the first rung where they do not. */
  hold_rung: string;
  break_rung: string | null;
  /** All three arms on every clip, at the rungs the rule picked. */
  arms: Record<string, CaseResult[]>;
};

/** A sign counts as still heard at a rung while its own probe stays at or above this. */
export const HEARD_AT = 0.5;
/** The probes hold at a rung while at least this share of the sign clips are still heard. */
export const HOLD_SHARE = 0.75;

/** The clips the hold rule is judged on: sign clips in the test whose gate was the probe. */
const ladderClips = (patients: Patient[]) => patients.filter((p) => p.gate.kept && probeGated(p.hidden_sign));

export type RungStats = { clips: number; heard: number; strong: number; mean: number; holds: boolean };

export function rungStats(patients: Patient[], probes: Record<string, Probes> | undefined): RungStats {
  const values = ladderClips(patients).map((p) => probes?.[p.id]?.[SIGN_PROBE[p.hidden_sign as Sign]] ?? 0);
  const heard = values.filter((v) => v >= HEARD_AT).length;
  return {
    clips: values.length,
    heard,
    strong: values.filter((v) => v >= CHOSEN_BAR).length,
    mean: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0,
    holds: values.length > 0 && heard / values.length >= HOLD_SHARE,
  };
}

/**
 * The rule for picking rungs, written before any exam rung was looked at.
 * Walk the noise rungs from easiest to hardest. The break rung is the first one
 * that fails to hold. The hold rung is the one just before it.
 */
export function chooseRungs(patients: Patient[], rungs: LadderRung[], probes: Ladder["probes"]): { hold: string; brk: string | null } {
  let hold = "clean";
  for (const r of rungs.filter((x) => x.kind === "noise")) {
    if (!rungStats(patients, probes[r.id]).holds) return { hold, brk: r.id };
    hold = r.id;
  }
  return { hold, brk: null };
}

/** Healthy controls in the test where noise made any sign probe fire. */
export function controlAlarms(patients: Patient[], probes: Record<string, Probes> | undefined): { alarms: number; of: number } {
  const controls = patients.filter((p) => p.gate.kept && p.hidden_sign === "none");
  const signKeys = SIGNS.map((s) => SIGN_PROBE[s]);
  return { alarms: controls.filter((p) => signKeys.some((k) => (probes?.[p.id]?.[k] ?? 0) >= HEARD_AT)).length, of: controls.length };
}

export type LadderRow = RungStats & {
  rung: LadderRung;
  role: "hold" | "break" | null;
  control_alarms: number;
  controls: number;
  /** Arm results at this rung, where the arms were run. */
  arms: { signs: Record<ArmKey, Tally>; false_alarms: Record<ArmKey, Tally> } | null;
};

/**
 * One row per rung, for the page and the results file. `cleanCases` is the main
 * Station 1 run. Every column counts the same clips: the sign clips whose gate
 * was the probe, and the healthy controls. Physician-gated signs are left out,
 * because their probe is not their pass mark.
 */
export function ladderRows(patients: Patient[], ladder: Ladder, cleanCases: CaseResult[]): LadderRow[] {
  const cleanProbes = Object.fromEntries(patients.map((p) => [p.id, p.probes]));
  const scope = patients.filter((p) => p.hidden_sign === "none" || probeGated(p.hidden_sign));
  return ladder.rungs.map((rung) => {
    const probes = rung.id === "clean" ? cleanProbes : ladder.probes[rung.id];
    const cases = rung.id === "clean" ? cleanCases : ladder.arms[rung.id];
    const alarms = controlAlarms(patients, probes);
    const h = cases?.length ? headline(scope, cases) : null;
    return {
      ...rungStats(patients, probes),
      rung,
      role: rung.id === ladder.hold_rung ? "hold" : rung.id === ladder.break_rung ? "break" : null,
      control_alarms: alarms.alarms,
      controls: alarms.of,
      arms: h ? { signs: h.signs, false_alarms: h.false_alarms } : null,
    };
  });
}
