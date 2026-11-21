// Runs Station 1 on a patient set and prints one row per patient per arm.
//   npx tsx scripts/run-station1.ts dev
import * as path from "node:path";
import { loadSet } from "../server/engine/build.ts";
import { ARM_LABEL, type CaseResult } from "../server/engine/types.ts";
import { ROOT, writeJson } from "../server/lib/cache.ts";
import { runCase } from "../server/station1/listening.ts";

const set = process.argv[2] ?? "dev";
const patients = loadSet(set).filter((p) => p.gate.kept);
if (!patients.length) throw new Error(`No kept patients in set "${set}". Run scripts/build-set.ts first.`);

console.log(`Station 1 on "${set}": ${patients.length} patients, 3 arms each`);
const settled = await Promise.allSettled(patients.map((p) => runCase(p)));
const cases: CaseResult[] = [];
settled.forEach((r, i) => {
  if (r.status === "fulfilled") cases.push(r.value);
  else console.error(`[station1] ${patients[i].id} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
});

console.log(["patient".padEnd(24), "arm".padEnd(24), "sign".padEnd(9), "urgency".padEnd(8), "conf", " review", "   ms"].join(" "));
for (const c of cases) {
  for (const a of c.arms) {
    const verdict =
      c.patient.hidden_sign === "none" ? (a.grade.false_alarm ? "FALSE ALARM" : "quiet") : a.grade.caught ? "caught" : "MISSED";
    console.log(
      [
        c.patient.id.padEnd(24),
        `${a.arm}. ${ARM_LABEL[a.arm]}`.padEnd(24),
        verdict.padEnd(9),
        a.note.urgency.padEnd(8),
        a.grade.confidence.toFixed(2),
        (a.grade.needs_review ? " REVIEW" : "       "),
        String(a.ms).padStart(6),
      ].join(" "),
    );
  }
  console.log(`  transcript: ${c.transcript}`);
}

const signCases = cases.filter((c) => c.patient.hidden_sign !== "none");
const controls = cases.filter((c) => c.patient.hidden_sign === "none");
console.log("");
for (const arm of ["A", "B", "C"] as const) {
  const caught = signCases.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.caught).length;
  const alarms = controls.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.false_alarm).length;
  console.log(`${arm}. ${ARM_LABEL[arm].padEnd(22)} caught ${caught} of ${signCases.length} signs, false alarms ${alarms} of ${controls.length} controls`);
}

writeJson(path.join(ROOT, "data", set, "station1.json"), cases);
