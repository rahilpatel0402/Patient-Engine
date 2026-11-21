// Renders the one-minute video voiceover with Gemini TTS and lays the lines out
// on a timeline, so the narration can be dropped under a screen recording.
//
// The lines live in a private file that is not in the repository, because the
// numbers in them are filled in from the results file by hand and checked.
//
//   npx tsx scripts/voiceover.ts notes/voiceover.json
//
// The file is a list of lines, each with the second it should start at:
//   [ { "at": 0, "text": "Listen. The transcript says ..." }, { "at": 10, "text": "..." } ]
import * as fs from "node:fs";
import * as path from "node:path";
import { readWav, writeWav } from "../server/lib/audio.ts";
import { ROOT } from "../server/lib/cache.ts";
import { speak } from "../server/lib/gemini.ts";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) throw new Error("Give the path of the lines file, for example notes/voiceover.json");
const flag = (name: string, fallback: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const voice = flag("voice", "Charon");
const style = flag("style", "Clear, calm, confident narration for a short product video. Unhurried but not slow.");

type Line = { at: number; text: string };
const lines = (JSON.parse(fs.readFileSync(path.resolve(ROOT, file), "utf8")) as Line[]).sort((a, b) => a.at - b.at);
const outDir = path.dirname(path.resolve(ROOT, file));

const rendered = await Promise.all(
  lines.map(async (line, i) => {
    const audio = await speak({ text: line.text, style, voice });
    const wavFile = path.join(outDir, `voiceover-${String(i + 1).padStart(2, "0")}.wav`);
    fs.writeFileSync(wavFile, Buffer.from(audio.value, "base64"));
    return { ...line, ...readWav(wavFile), wavFile };
  }),
);

const rate = rendered[0]?.rate ?? 24000;
const end = Math.max(...rendered.map((r) => r.at + r.samples.length / r.rate));
const track = new Int16Array(Math.ceil(end * rate));

console.log(["starts", "runs", "room", "", "line"].map((s, i) => s.padEnd([7, 7, 7, 9, 0][i])).join(""));
rendered.forEach((r, i) => {
  const seconds = r.samples.length / r.rate;
  const next = rendered[i + 1]?.at;
  const room = next === undefined ? null : next - r.at;
  const fits = room === null || seconds <= room;
  track.set(r.samples, Math.round(r.at * rate));
  console.log(
    [
      `${r.at}s`.padEnd(7),
      `${seconds.toFixed(1)}s`.padEnd(7),
      (room === null ? "" : `${room}s`).padEnd(7),
      (fits ? "fits" : "TOO LONG").padEnd(9),
      r.text.length > 70 ? `${r.text.slice(0, 70)}...` : r.text,
    ].join(""),
  );
});

const out = path.join(outDir, "voiceover.wav");
writeWav(out, rate, track);
console.log(`\nWrote ${out} (${(track.length / rate).toFixed(1)} seconds, voice ${voice}).`);
console.log("A line marked TOO LONG runs into the next one. Shorten its text or move the next line later.");
