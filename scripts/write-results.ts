// Writes results/listening.json and results/listening.md from the saved runs.
// Every number comes from the data files. Nothing here is typed in by hand.
//   npx tsx scripts/write-results.ts exam
//   npx tsx scripts/write-results.ts dev --out results/practice
import * as fs from "node:fs";
import * as path from "node:path";
import { PROMPTED_MODEL, loadSet, setDir } from "../server/engine/build.ts";
import { SECOND_LISTENER, SLUR_DROP_BELOW, SLUR_KEEP_AT } from "../server/engine/listener.ts";
import { GATE_CONTROL_MAX, GATE_SIGN_MIN } from "../server/engine/probes.ts";
import { ARM_LABEL, SIGNS, SIGN_LABEL, SIGN_PROBE, type ArmKey, type CaseResult, type HiddenSign, type Patient } from "../server/engine/types.ts";
import { ROOT, readJson, writeJson } from "../server/lib/cache.ts";
import { MODELS } from "../server/lib/gemini.ts";
import { agreement, blindDone, blindLabels } from "../server/station1/blind.ts";
import { REVIEW_BELOW } from "../server/station1/listening.ts";
import { ARMS, CHOSEN_BAR, HEARD_AT, HOLD_SHARE, comparisonRows, headline, ladderRows, sensitivity, type Comparison, type Ladder, type Tally } from "../server/station1/report.ts";

const args = process.argv.slice(2);
const set = args.find((a) => !a.startsWith("--")) ?? "exam";
const outBase = args.includes("--out") ? args[args.indexOf("--out") + 1] : "results/listening";

// The exam set stays sealed until the physician has finished the blind labels.
if (set === "exam" && !blindDone(set)) {
  throw new Error("The blind labels for the exam set are not saved yet. Results stay sealed until they are.");
}

const patients = loadSet(set);
const stationFile = path.join(setDir(set), "station1.json");
if (!patients.length || !fs.existsSync(stationFile)) throw new Error(`Set "${set}" has no Station 1 run yet.`);
const cases = readJson<CaseResult[]>(stationFile);
const ladderFile = path.join(setDir(set), "ladder.json");
const ladder = fs.existsSync(ladderFile) ? readJson<Ladder>(ladderFile) : null;
const caseFor = new Map(cases.map((c) => [c.patient.id, c]));

// ---- tallies ---------------------------------------------------------------------

function tally(list: Patient[], pick: (g: CaseResult["arms"][number]["grade"]) => boolean): Record<ArmKey, Tally> {
  const out = {} as Record<ArmKey, Tally>;
  for (const arm of ARMS) {
    const grades = list.flatMap((p) => caseFor.get(p.id)?.arms.filter((a) => a.arm === arm).map((a) => a.grade) ?? []);
    out[arm] = { caught: grades.filter(pick).length, unclear: grades.filter((g) => g.needs_review).length, of: grades.length };
  }
  return out;
}

const gateWord = (p: Patient) => (p.gate.by === "physician" ? "physician" : p.gate.by === "consensus" ? "two listeners" : "probe");

const head = headline(patients, cases);
const bySign = SIGNS.map((sign) => {
  const all = patients.filter((p) => p.hidden_sign === sign);
  const kept = all.filter((p) => p.gate.kept);
  return {
    sign,
    label: SIGN_LABEL[sign],
    generated: all.length,
    in_test: kept.length,
    gate: [...new Set(all.map(gateWord))].join(" or "),
    arms: tally(kept, (g) => g.caught === true),
  };
});

const controls = patients.filter((p) => p.hidden_sign === "none");
const controlKinds = [...new Set(controls.map((p) => p.control_kind ?? "plain"))];
const byControl = controlKinds.map((kind) => {
  const all = controls.filter((p) => (p.control_kind ?? "plain") === kind);
  const kept = all.filter((p) => p.gate.kept);
  return { kind, generated: all.length, in_test: kept.length, false_alarms: tally(kept, (g) => g.false_alarm === true) };
});

const leftOut = patients
  .filter((p) => !p.gate.kept)
  .map((p) => ({
    id: p.id,
    sign: p.hidden_sign,
    reason: p.gate.reason,
    own_probe: p.hidden_sign === "none" ? null : p.probes[SIGN_PROBE[p.hidden_sign]],
    arms: Object.fromEntries((caseFor.get(p.id)?.arms ?? []).map((a) => [a.arm, a.grade.status])) as Record<ArmKey, string>,
  }));

const review = cases.flatMap((c) =>
  patients.find((p) => p.id === c.patient.id)?.gate.kept
    ? c.arms.filter((a) => a.grade.needs_review).map((a) => ({ id: c.patient.id, sign: c.patient.hidden_sign, arm: a.arm, grader: a.grade.identifies_sign ?? a.grade.flags_any_sign, note: a.note }))
    : [],
);

const sens = sensitivity(patients, cases);
const rows = ladder ? ladderRows(patients, ladder, cases) : [];
const agree = blindLabels(set).length ? agreement(set) : null;
const comparisonFile = path.join(setDir(set), "comparison.json");
const comparison = fs.existsSync(comparisonFile) ? readJson<Comparison>(comparisonFile) : null;
const models = comparison ? comparisonRows(patients, MODELS.hydrogen, cases, comparison) : [];

const result = {
  generated_at: new Date().toISOString(),
  set,
  note: "Counts, not percentages. The sample is small. Every patient is synthetic.",
  setup: {
    patient_author: [...new Set(patients.map((p) => p.author_model.split(",")[0]))],
    voice: MODELS.tts,
    voice_for_slurred_and_groaning: PROMPTED_MODEL,
    transcript: MODELS.transcribe,
    clinician_under_test: `${MODELS.hydrogen}, thinking level low`,
    probes_gate_and_grader: MODELS.decision,
    second_listener_for_slurred: SECOND_LISTENER,
    gate: {
      sign_probe_at_least: GATE_SIGN_MIN,
      control_every_sign_probe_at_most: GATE_CONTROL_MAX,
      slurred: `kept with no human when the probe is at least ${SLUR_KEEP_AT} and the second listener hears it, dropped when the probe is under ${SLUR_DROP_BELOW} and the second listener does not, otherwise a physician decides`,
    },
    grader: `a grade counts only when the grader is at least ${REVIEW_BELOW} confident, otherwise it is unclear and goes to physician review`,
  },
  clips: { generated: head.generated, in_test: head.generated - head.left_out, left_out: head.left_out },
  headline: { signs_caught: head.signs, false_alarms_on_controls: head.false_alarms, notes_sent_to_review: head.review },
  by_sign: bySign,
  controls_by_voice: byControl,
  left_out_of_the_test: leftOut,
  physician_review_queue: review,
  pass_mark_sensitivity: { chosen: CHOSEN_BAR, rows: sens },
  stress_ladder: ladder
    ? {
        noise_recording: ladder.noise,
        rule: `a rung holds while at least ${HOLD_SHARE * 100} in 100 probe-gated sign clips keep their own probe at ${HEARD_AT} or higher`,
        hold_rung: ladder.hold_rung,
        break_rung: ladder.break_rung,
        rows: rows.map((r) => ({ rung: r.rung.id, label: r.rung.label, role: r.role, sign_clips: r.clips, still_heard: r.heard, at_or_above_pass_mark: r.strong, mean_probe: r.mean, controls_with_a_false_sign: r.control_alarms, controls: r.controls, arms: r.arms })),
      }
    : null,
  model_comparison: models.length ? { note: "Same clips, same prompts, same grader. Only the clinician model changes.", rows: models } : null,
  blind_physician_labels: agree,
};
writeJson(path.join(ROOT, `${outBase}.json`), result);

// ---- markdown --------------------------------------------------------------------

const table = (headers: string[], lines: (string | number)[][]) =>
  [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...lines.map((l) => `| ${l.join(" | ")} |`)].join("\n");
const frac = (t: Tally) => `${t.caught} of ${t.of}`;
const signName = (s: HiddenSign) => SIGN_LABEL[s];
const setName = set === "exam" ? "exam set, written by Carbon" : set === "dev" ? "practice set, written by Argon" : set;

const md: string[] = [];
md.push(`# Listening station results: ${setName}`);
md.push(
  `Written by \`scripts/write-results.ts\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from the saved runs in \`data/${set}\`. Every number is computed from those files. Counts are used, not percentages, because the sample is small. Every patient is synthetic.`,
);

md.push(`## Clips`);
md.push(
  `${head.generated} clips were generated. ${head.generated - head.left_out} are in the test and ${head.left_out} were left out by the gate. The three arms were run on every generated clip, including the ones left out.`,
);

md.push(`## Result on the clips in the test`);
md.push(
  table(
    ["Arm", "Hidden signs caught", "Unclear, sent to physician review", "False alarms on healthy controls"],
    ARMS.map((a) => [`${a}. ${ARM_LABEL[a]}`, frac(head.signs[a]), head.signs[a].unclear, frac(head.false_alarms[a])]),
  ),
);
md.push(`An unclear grade is one where the grader was under ${REVIEW_BELOW} confident either way. It is not counted as caught.`);

md.push(`## By sign`);
md.push(
  table(
    ["Sign", "Generated", "In the test", "Gate", ...ARMS.map((a) => `${a} caught`)],
    bySign.map((s) => [s.label, s.generated, s.in_test, s.gate, ...ARMS.map((a) => frac(s.arms[a]))]),
  ),
);
md.push(
  `Slurred speech is gated differently from the other signs. Two models listen to each slurred clip, and a physician decides the ones they disagree on. Its counts are shown on their own row so they can be read apart from the probe-gated signs.`,
);

md.push(`## Healthy controls by voice`);
md.push(
  table(
    ["Control voice", "Generated", "In the test", ...ARMS.map((a) => `${a} false alarms`)],
    byControl.map((c) => [c.kind, c.generated, c.in_test, ...ARMS.map((a) => frac(c.false_alarms[a]))]),
  ),
);

if (leftOut.length) {
  md.push(`## Clips left out of the test`);
  md.push(`The arms were still run on these, so the effect of the gate is visible.`);
  md.push(
    table(
      ["Clip", "Sign it was written to have", "Why it was left out", ...ARMS.map((a) => `${a}`)],
      leftOut.map((l) => [l.id, signName(l.sign), l.reason, ...ARMS.map((a) => l.arms[a] ?? "")]),
    ),
  );
}

md.push(`## Would a different pass mark change the result?`);
md.push(`The pass mark of ${CHOSEN_BAR.toFixed(2)} was fixed before any result existed. This covers the probe-gated signs only.`);
md.push(
  table(
    ["Pass mark", "Clips kept", ...ARMS.map((a) => `${a} caught`)],
    sens.map((r) => [r.bar === null ? "No gate" : `${r.bar.toFixed(2)}${r.bar === CHOSEN_BAR ? " (used)" : ""}`, `${r.kept} of ${r.generated}`, ...ARMS.map((a) => frac(r.arms[a]))]),
  ),
);

if (ladder) {
  md.push(`## Stress ladder`);
  md.push(
    `The same clips were degraded step by step and never re-rendered: phone quality (300 to 3400 Hz at 8 kHz), then room noise recorded at the venue (${ladder.noise?.seconds} seconds), mixed in at set ratios of voice to noise. A sign is still heard while its own probe stays at ${HEARD_AT.toFixed(2)} or higher. A rung holds while at least ${HOLD_SHARE * 100} in 100 sign clips are still heard. That rule was written before any exam rung was looked at. The arms were run at the clean rung, at the hardest rung that holds, and at the first rung that breaks. Slurred clips are left out of this table, because their probe is not their pass mark.`,
  );
  md.push(
    table(
      ["Rung", "Signs still heard", "At 0.80 or higher", "Controls with a false sign", ...ARMS.map((a) => `${a} caught`), ""],
      rows.map((r) => [
        r.rung.label,
        `${r.heard} of ${r.clips}`,
        `${r.strong} of ${r.clips}`,
        `${r.control_alarms} of ${r.controls}`,
        ...ARMS.map((a) => (r.arms ? frac(r.arms.signs[a]) : "")),
        r.role === "hold" ? "hardest rung that holds" : r.role === "break" ? "breaks here" : "",
      ]),
    ),
  );
}

if (agree) {
  md.push(`## Blind physician labels`);
  md.push(
    `A physician heard ${agree.labelled} clips in random order under neutral names, with the sign hidden, before any exam result was shown. The physician named the sign the clip was written to have on ${agree.with_intended} of ${agree.labelled}, and agreed with the automatic gate about whether that sign is really there on ${agree.with_gate} of ${agree.labelled}.`,
  );
  md.push(
    table(
      ["Clip", "Written to have", "Physician heard", "Automatic gate", "Agree"],
      agree.rows.map((r) => [r.id, signName(r.intended), signName(r.heard), `${r.gate_kept ? "kept" : "not kept"} (${r.gate_by})`, r.agrees_with_gate ? "yes" : "no"]),
    ),
  );
}

const modelName = (id: string) => id.replace(/^gemini-4-(\w)(\w*)$/, (_, a: string, b: string) => `Gemini 4 ${a.toUpperCase()}${b}`);
const modelTable = () =>
  table(
    ["Clinician model", ...ARMS.map((a) => `${a} caught`), "False alarms on controls (A, B, C)"],
    models.map((m) => [
      `${modelName(m.model)}${m.main ? " (main run)" : ""}`,
      ...ARMS.map((a) => frac(m.signs[a])),
      `${ARMS.map((a) => m.false_alarms[a].caught).join(", ")} of ${m.false_alarms.A.of}`,
    ]),
  );
if (models.length) {
  md.push(`## Same test, four Gemini 4 models as the clinician`);
  md.push(
    `Same clips, same prompts, same grader. Only the clinician model changes. Two rows are not fully independent: the model that wrote this set's scripts, and Carbon, which is the second listener for slurred clips.`,
  );
  md.push(modelTable());
}

md.push(`## Physician review queue`);
md.push(
  review.length
    ? table(["Clip", "Sign", "Arm", "Grader probability"], review.map((r) => [r.id, signName(r.sign), r.arm, Number(r.grader).toFixed(2)]))
    : `No graded note on a clip in the test was unclear.`,
);

fs.writeFileSync(path.join(ROOT, `${outBase}.md`), md.join("\n\n") + "\n");
console.log(`Wrote ${outBase}.json and ${outBase}.md for "${set}".`);

// ---- README ----------------------------------------------------------------------
// The results block in the README is written from the same numbers, so nothing in
// it is typed by hand. Only the exam set goes into the README.

const ARM_INPUT: Record<ArmKey, string> = {
  A: "The transcript",
  B: "The raw audio",
  C: "The transcript, with seven probe probabilities from the Decisions API added",
};

function readmeBlock(): string {
  const out: string[] = [];
  const inTest = head.generated - head.left_out;
  const signClips = head.signs.A.of;
  const controlClips = head.false_alarms.A.of;
  out.push(
    `Carbon wrote ${head.generated} exam patients. ${inTest} are in the test: ${signClips} with a hidden sign and ${controlClips} healthy controls. ${head.left_out} were left out by the gate, and their results are reported too.`,
  );
  out.push(
    table(
      ["Arm", "What the clinician model is given", "Hidden signs caught", "False alarms on healthy controls"],
      ARMS.map((a) => [`${a}. ${ARM_LABEL[a]}`, ARM_INPUT[a], frac(head.signs[a]), frac(head.false_alarms[a])]),
    ),
  );
  const unclear = ARMS.reduce((n, a) => n + head.signs[a].unclear + head.false_alarms[a].unclear, 0);
  if (unclear) out.push(`${unclear} graded notes were unclear to the grader. They are counted as not caught and listed in the review queue.`);

  out.push(`### By sign`);
  out.push(
    table(
      ["Sign", "Generated", "In the test", "Gate", ...ARMS.map((a) => `${a} caught`)],
      bySign.map((s) => [s.label, s.generated, s.in_test, s.gate, ...ARMS.map((a) => frac(s.arms[a]))]),
    ),
  );

  if (ladder) {
    const holdRow = rows.find((r) => r.role === "hold");
    out.push(`### How far before it broke`);
    out.push(
      table(
        ["Rung", "Signs the Decisions API still hears", ...ARMS.map((a) => `${a} caught`), ""],
        rows.map((r) => [
          r.rung.label,
          `${r.heard} of ${r.clips}`,
          ...ARMS.map((a) => (r.arms ? frac(r.arms.signs[a]) : "")),
          r.role === "hold" ? "hardest rung that holds" : r.role === "break" ? "breaks here" : "",
        ]),
      ),
    );
    if (holdRow?.arms) {
      out.push(
        `At the hardest rung that still held, the raw audio arm caught ${frac(holdRow.arms.signs.B)} signs and the transcript plus probes arm caught ${frac(holdRow.arms.signs.C)}. This table covers the probe-gated signs. The arms were run at the clean rung and at the two rungs a fixed rule picked.`,
      );
    }
  }

  if (agree) {
    out.push(`### Blind physician labels`);
    out.push(
      `A physician heard ${agree.labelled} exam clips in random order with the sign hidden, before any exam result was shown. The physician named the sign the clip was written to have on ${agree.with_intended} of ${agree.labelled}, and agreed with the automatic gate about whether that sign is really there on ${agree.with_gate} of ${agree.labelled}.`,
    );
  }

  if (models.length) {
    out.push(`### Same test, four Gemini 4 models as the clinician`);
    out.push(modelTable());
  }

  out.push(`Full tables, the clips left out of the test, the pass mark table, and the review queue are in [results/listening.md](results/listening.md). The raw numbers are in [results/listening.json](results/listening.json).`);
  return out.join("\n\n");
}

const START = "<!-- results:start -->";
const END = "<!-- results:end -->";
const readmeFile = path.join(ROOT, "README.md");
if (set === "exam" && fs.existsSync(readmeFile)) {
  const readme = fs.readFileSync(readmeFile, "utf8");
  const from = readme.indexOf(START);
  const to = readme.indexOf(END);
  if (from >= 0 && to > from) {
    fs.writeFileSync(readmeFile, `${readme.slice(0, from + START.length)}\n\n${readmeBlock()}\n\n${readme.slice(to)}`);
    console.log("Updated the results block in README.md.");
  }
}
