// Model comparison. The same exam, the same prompts, the same grader, with a
// different Gemini 4 model as the clinician under test each time.
// Hydrogen is the main run (scripts/run-station1.ts). This adds the others.
//
//   npx tsx scripts/compare-models.ts exam            runs quietly and saves the result
//   npx tsx scripts/compare-models.ts dev --show      also prints the summary
//   npx tsx scripts/compare-models.ts dev --models gemini-4-neon
import * as path from "node:path";
import { loadSet, setDir } from "../server/engine/build.ts";
import { ARM_LABEL, type CaseResult } from "../server/engine/types.ts";
import { writeJson } from "../server/lib/cache.ts";
import { MODELS } from "../server/lib/gemini.ts";
import { runCase } from "../server/station1/listening.ts";
import { ARMS, headline, type Comparison } from "../server/station1/report.ts";

const args = process.argv.slice(2);
const set = args.find((a) => !a.startsWith("--")) ?? "exam";
const show = args.includes("--show");
const models = args.includes("--models") ? args[args.indexOf("--models") + 1].split(",") : [MODELS.neon, MODELS.argon, MODELS.carbon];

const patients = loadSet(set);
if (!patients.length) throw new Error(`No patients in set "${set}".`);

const comparison: Comparison = { set, models: [] };
let failed = 0;
for (const model of models) {
  const settled = await Promise.allSettled(patients.map((p) => runCase(p, { model })));
  const cases: CaseResult[] = settled.flatMap((r, i) => {
    if (r.status === "fulfilled") return [r.value];
    failed++;
    console.error(`[compare] ${model} on ${patients[i].id} failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    return [];
  });
  comparison.models.push({ model, cases });
}
writeJson(path.join(setDir(set), "comparison.json"), comparison);
console.log(`Comparison on "${set}": ${patients.length} clips, ${models.length} models, ${failed} failures.`);

if (show) {
  for (const m of comparison.models) {
    const h = headline(patients, m.cases);
    console.log(`\n${m.model}`);
    for (const arm of ARMS) {
      console.log(
        `  ${arm}. ${ARM_LABEL[arm].padEnd(24)} caught ${h.signs[arm].caught} of ${h.signs[arm].of} (${h.signs[arm].unclear} unclear), false alarms ${h.false_alarms[arm].caught} of ${h.false_alarms[arm].of}`,
      );
    }
  }
}
