// Throwaway: one real live recording on the current key, then the token usage behind its cost.
//   npx tsx smoke/cost.ts path/to/clip.wav
import "dotenv/config";
import * as fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { PROBE_QUESTIONS } from "../server/engine/probes.ts";
import { requireApiKey } from "../server/env.ts";
import { withKeyRole } from "../server/lib/gemini.ts";
import { runLive } from "../server/station1/live.ts";

const clip = process.argv[2] ?? "smoke/out/fresh-key-test.wav";
const t0 = Date.now();
const r = await withKeyRole("live", () => runLive(fs.readFileSync(clip), "wav"));
console.log(`live recording end to end: ${((Date.now() - t0) / 1000).toFixed(1)} s (${r.seconds} s of audio)`);
console.log(`probe ${r.probe_ms} ms | short of breath ${r.probes.short_of_breath} | transcript: ${r.transcript.slice(0, 60)}`);
console.log(`raw audio arm: ${r.arms.B.observations.slice(0, 2).join(" | ")}`);

// Token usage, from direct calls of the same shape as the app makes.
const ai = new GoogleGenAI({ apiKey: requireApiKey("live"), apiVersion: "v1beta" });
const audio = { type: "audio", data: fs.readFileSync(clip, { encoding: "base64" }), mime_type: "audio/wav" };
const schema = { type: "object", properties: { observations: { type: "array", items: { type: "string" } } }, required: ["observations"] };
const system = "List only what you observe. Short factual phrases.";
type U = { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
const json = { type: "text", mime_type: "application/json", schema };
const low = { thinking_level: "low" };
const d = (await ai.decisions.create({ model: "gemini-decision-1", input: [audio], questions: PROBE_QUESTIONS } as never)) as { usage?: U };
const t = (await ai.interactions.create({ model: "gemini-3.5-transcribe", input: [audio] } as never)) as { usage?: U };
const hText = (await ai.interactions.create({ model: "gemini-4-hydrogen", system_instruction: system, input: `Transcript of what the person said:\n"${r.transcript}"`, response_format: json, generation_config: low } as never)) as { usage?: U };
const hAudio = (await ai.interactions.create({ model: "gemini-4-hydrogen", system_instruction: system, input: [{ type: "text", text: "Audio recording attached." }, audio], response_format: json, generation_config: low } as never)) as { usage?: U };
const tok = (u?: U) => ({ in: u?.total_input_tokens ?? 0, out: (u?.total_output_tokens ?? 0) + (u?.total_thought_tokens ?? 0) });
const [D, T, HT, HA] = [tok(d.usage), tok(t.usage), tok(hText.usage), tok(hAudio.usage)];
console.log(`tokens: decision in ${D.in} | transcribe in ${T.in} out ${T.out} | hydrogen text in ${HT.in} out ${HT.out} | hydrogen audio in ${HA.in} out ${HA.out}`);
// Prices per million tokens, from Google's pricing page as saved on 2026-11-21.
const cost = (D.in * 0.1 + T.in * 2 + T.out * 12 + 2 * (HT.in * 1.5 + HT.out * 7.5) + HA.in * 1.5 + HA.out * 7.5) / 1e6;
console.log(`estimated cost of one recording: $${cost.toFixed(4)} (two text notes, one audio note, one probe call, one transcript)`);
process.exit(0);
