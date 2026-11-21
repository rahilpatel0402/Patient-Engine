// Exports the saved runs as plain files for the read-only showcase:
// client/public-static/sets.json and one compressed clip per patient.
// Nothing here calls a model. Live recordings and room noise are never exported.
//   npx tsx scripts/export-static.ts
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { abs, loadSet } from "../server/engine/build.ts";
import type { CaseResult } from "../server/engine/types.ts";
import { ROOT, readJson, writeJson } from "../server/lib/cache.ts";
import { agreement, blindDone, blindLabels } from "../server/station1/blind.ts";

const OUT = path.join(ROOT, "client", "public-static");
const DATA = path.join(ROOT, "data");
const SETS = ["exam", "dev", "slurred-lab"];

fs.rmSync(OUT, { recursive: true, force: true });
const optional = <T>(file: string): T | null => (fs.existsSync(file) ? readJson<T>(file) : null);

let clips = 0;
let bytes = 0;
const sets = SETS.filter((set) => fs.existsSync(path.join(DATA, set, "patients.json"))).flatMap((set) => {
  // The exam set stays sealed until the blind labels are saved.
  if (set === "exam" && !blindDone(set)) return [];
  const patients = loadSet(set).map((p) => {
    const rel = `clips/${set}/${p.id}.mp3`;
    const out = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync(ffmpegStatic as unknown as string, ["-y", "-loglevel", "error", "-i", abs(p.clip), "-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1", out]);
    clips++;
    bytes += fs.statSync(out).size;
    return { ...p, clip: rel };
  });
  return [
    {
      set,
      patients,
      cases: optional<CaseResult[]>(path.join(DATA, set, "station1.json")) ?? [],
      ladder: optional<unknown>(path.join(DATA, set, "ladder.json")),
      comparison: optional<unknown>(path.join(DATA, set, "comparison.json")),
      agreement: blindLabels(set).length ? agreement(set) : null,
    },
  ];
});

const file = path.join(OUT, "sets.json");
fs.writeFileSync(file, JSON.stringify(sets));
void writeJson;
console.log(`Exported ${sets.length} sets, ${clips} clips (${(bytes / 1048576).toFixed(1)} MB) and sets.json (${(fs.statSync(file).size / 1048576).toFixed(1)} MB) to client/public-static.`);
