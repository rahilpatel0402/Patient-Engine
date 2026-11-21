// Runs Station 1 on a patient set and prints one row per patient per arm.
// Every generated clip is run, including clips the gate dropped, so the effect
// of the gate is visible. Headline counts use only the clips that are in the test.
//   npx tsx scripts/run-station1.ts dev
import * as path from "node:path";
import { loadSet } from "../server/engine/build.ts";
import { ARM_LABEL, type CaseResult } from "../server/engine/types.ts";
import { ROOT, writeJson } from "../server/lib/cache.ts";
import { runCase } from "../server/station1/listening.ts";
import { ARMS, CHOSEN_BAR, headline, sensitivity } from "../server/station1/report.ts";

const set = process.argv[2] ?? "dev";
const patients = loadSet(set);
if (!patients.length) throw new Error(`No patients in set "${set}". Run scripts/build-set.ts first.`);

console.log(`Station 1 on "${set}": ${patients.length} clips (${patients.filter((p) => p.gate.kept).length} in the test), 3 arms each`);
const settled = await Promise.allSettled(patients.map((p) => runCase(p)));
const cases: CaseResult[] = [];
settled.forEach((r, i) => {
  if (r.status === "fulfilled") cases.push(r.value);
  else console.error(`[station1] ${patients[i].id} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
});

console.log(["patient".padEnd(24), "in test", "arm".padEnd(26), "sign".padEnd(11), "urgency".padEnd(8), "conf", " review"].join(" "));
for (const c of cases) {
  for (const a of c.arms) {
    const verdict = { caught: "caught", missed: "MISSED", quiet: "quiet", alarm: "FALSE ALARM", unclear: "unclear" }[a.grade.status];
    console.log(
      [
        c.patient.id.padEnd(24),
        (c.patient.gate.kept ? "yes" : "no").padEnd(7),
        `${a.arm}. ${ARM_LABEL[a.arm]}`.padEnd(26),
        verdict.padEnd(11),
        a.note.urgency.padEnd(8),
        a.grade.confidence.toFixed(2),
        a.grade.needs_review ? " REVIEW" : "",
      ].join(" "),
    );
  }
}

const h = headline(patients, cases);
console.log(`\nClips in the test (${h.generated - h.left_out} of ${h.generated} generated):`);
for (const arm of ARMS) {
  console.log(
    `  ${arm}. ${ARM_LABEL[arm].padEnd(24)} caught ${h.signs[arm].caught} of ${h.signs[arm].of} signs (${h.signs[arm].unclear} unclear), false alarms ${h.false_alarms[arm].caught} of ${h.false_alarms[arm].of} controls`,
  );
}

console.log(`\nSensitivity to the pass mark (probe-gated signs only). The chosen bar is ${CHOSEN_BAR.toFixed(2)}.`);
console.log(["bar".padEnd(10), "clips kept".padEnd(12), ...ARMS.map((a) => `${a} caught`.padEnd(12))].join(" "));
for (const row of sensitivity(patients, cases)) {
  console.log(
    [
      (row.bar === null ? "no gate" : row.bar.toFixed(2) + (row.bar === CHOSEN_BAR ? " *" : "")).padEnd(10),
      `${row.kept} of ${row.generated}`.padEnd(12),
      ...ARMS.map((a) => `${row.arms[a].caught} of ${row.arms[a].of}`.padEnd(12)),
    ].join(" "),
  );
}

writeJson(path.join(ROOT, "data", set, "station1.json"), cases);
