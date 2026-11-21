// Blind physician labels. A physician hears exam clips in random order with the
// sign hidden and says what they hear. This is the one check on the test material
// that does not come from a Gemini model.
//
// The labels are collected before any exam result is shown. For slurred clips,
// which the automatic listeners could not settle, the blind label is also the
// physician's verdict on whether the clip goes into the test.
import * as fs from "node:fs";
import * as path from "node:path";
import { abs, loadSet, setDir, setPhysicianVerdict } from "../engine/build.ts";
import { SIGNS, SIGN_LABEL, type HiddenSign, type Patient } from "../engine/types.ts";
import { readJson, sha, writeJson } from "../lib/cache.ts";

export type BlindItem = { key: string; id: string };
export type BlindLabel = { key: string; id: string; heard: HiddenSign; at: string };

const planFile = (set: string) => path.join(setDir(set), "blind-plan.json");
const labelsFile = (set: string) => path.join(setDir(set), "blind-labels.json");

/** Deterministic order: sort by a hash, so the plan is random but repeatable. */
const shuffled = <T extends { id: string }>(items: T[], salt: string) =>
  [...items].sort((a, b) => sha(salt + a.id).localeCompare(sha(salt + b.id)));

/**
 * Which clips the physician hears: every clip waiting on a physician, two of each
 * other sign (kept or dropped), and four healthy controls.
 */
export function blindPlan(set: string): BlindItem[] {
  if (fs.existsSync(planFile(set))) return readJson<BlindItem[]>(planFile(set));
  const patients = loadSet(set);
  if (!patients.length) return [];
  const pick: Patient[] = [];
  for (const sign of SIGNS) {
    const ofSign = shuffled(patients.filter((p) => p.hidden_sign === sign), "pick");
    const waiting = ofSign.filter((p) => p.gate.by === "physician" && !p.gate.physician);
    pick.push(...(waiting.length ? waiting : ofSign.slice(0, 2)));
  }
  // Controls: prefer the ones with a harmless voice trait, then plain ones.
  const controls = shuffled(patients.filter((p) => p.hidden_sign === "none"), "pick");
  pick.push(...[...controls.filter((p) => p.control_kind && p.control_kind !== "plain"), ...controls.filter((p) => !p.control_kind || p.control_kind === "plain")].slice(0, 4));
  const plan = shuffled(pick, "order").map((p, i) => ({ key: `clip-${String(i + 1).padStart(2, "0")}`, id: p.id }));
  writeJson(planFile(set), plan);
  return plan;
}

export function blindClipPath(set: string, key: string): string | null {
  const item = blindPlan(set).find((i) => i.key === key);
  const patient = item && loadSet(set).find((p) => p.id === item.id);
  return patient ? abs(patient.clip) : null;
}

export function blindLabels(set: string): BlindLabel[] {
  return fs.existsSync(labelsFile(set)) ? readJson<BlindLabel[]>(labelsFile(set)) : [];
}

/** True once every clip in the plan has a label. Exam results stay hidden until then. */
export function blindDone(set: string): boolean {
  const plan = blindPlan(set);
  return plan.length > 0 && blindLabels(set).length >= plan.length;
}

export function saveBlindLabels(set: string, labels: Record<string, HiddenSign>): { saved: number; verdicts: number } {
  const plan = blindPlan(set);
  const missing = plan.filter((i) => !labels[i.key]);
  if (missing.length) throw new Error(`${missing.length} clips still have no label`);
  const at = new Date().toISOString();
  const out: BlindLabel[] = plan.map((i) => ({ key: i.key, id: i.id, heard: labels[i.key], at }));
  writeJson(labelsFile(set), out);

  // For clips that were waiting on a physician, the blind label is the verdict.
  let verdicts = 0;
  const patients = new Map(loadSet(set).map((p) => [p.id, p]));
  for (const label of out) {
    const p = patients.get(label.id);
    if (p && p.gate.by === "physician" && !p.gate.physician) {
      setPhysicianVerdict(set, p.id, label.heard === p.hidden_sign, `Blind label: heard "${SIGN_LABEL[label.heard]}".`);
      verdicts++;
    }
  }
  return { saved: out.length, verdicts };
}

export type Agreement = {
  labelled: number;
  /** Physician heard the sign the clip was written to have. */
  with_intended: number;
  /** Physician and the gate agree on whether the intended sign is really there. */
  with_gate: number;
  rows: { key: string; id: string; intended: HiddenSign; heard: HiddenSign; gate_kept: boolean; gate_by: string; agrees_with_gate: boolean }[];
};

/** How the blind labels compare with the intended sign and with the automatic gate. */
export function agreement(set: string): Agreement {
  const patients = new Map(loadSet(set).map((p) => [p.id, p]));
  const rows = blindLabels(set).flatMap((l) => {
    const p = patients.get(l.id);
    if (!p) return [];
    const heardIntended = l.heard === p.hidden_sign;
    // The gate's own opinion, before any physician verdict changed it.
    const autoKept = p.gate.physician ? p.gate.auto?.decision === "keep" : p.gate.kept;
    return [{ key: l.key, id: l.id, intended: p.hidden_sign, heard: l.heard, gate_kept: autoKept, gate_by: p.gate.physician ? "automatic listeners" : (p.gate.by ?? "probe"), agrees_with_gate: heardIntended === autoKept }];
  });
  return {
    labelled: rows.length,
    with_intended: rows.filter((r) => r.heard === r.intended).length,
    with_gate: rows.filter((r) => r.agrees_with_gate).length,
    rows,
  };
}
