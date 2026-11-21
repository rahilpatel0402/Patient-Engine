// Throwaway: which key in .env can call which model, and how fast?
import "dotenv/config";
import * as fs from "node:fs";
import { GoogleGenAI } from "@google/genai";

const names = Object.keys(process.env).filter((k) => /gemini|api_key|workshop/i.test(k) && /key/i.test(k) && process.env[k]?.trim());
const clip = fs.readFileSync("data/dev/clips/dev-11-none.wav", { encoding: "base64" });
const audio = { type: "audio", data: clip, mime_type: "audio/wav" };
const text = (model: string) => ({ model, input: "Reply with the single word: ready", generation_config: { thinking_level: "low" } });

const tests: Record<string, (ai: GoogleGenAI) => Promise<string>> = {
  "gemini-4-argon": async (ai) => ((await ai.interactions.create(text("gemini-4-argon") as never)) as { output_text?: string }).output_text ?? "",
  "gemini-4-carbon": async (ai) => ((await ai.interactions.create(text("gemini-4-carbon") as never)) as { output_text?: string }).output_text ?? "",
  "gemini-4-neon": async (ai) => ((await ai.interactions.create(text("gemini-4-neon") as never)) as { output_text?: string }).output_text ?? "",
  "gemini-4-hydrogen (audio)": async (ai) =>
    ((await ai.interactions.create({
      model: "gemini-4-hydrogen",
      input: [{ type: "text", text: "In five words, what is this?" }, audio],
      generation_config: { thinking_level: "low" },
    } as never)) as { output_text?: string }).output_text ?? "",
  "gemini-decision-1 (audio)": async (ai) => {
    const r = (await ai.decisions.create({
      model: "gemini-decision-1",
      input: [audio],
      questions: { speech: { type: "noul", instructions: "Is a person speaking?" } },
    } as never)) as { answers?: Record<string, { noul?: number }> };
    return `P(speech)=${r.answers?.speech?.noul?.toFixed(2)}`;
  },
  "gemini-3.8-flash-tts": async (ai) => {
    const r = (await ai.interactions.create({
      model: "gemini-3.8-flash-tts",
      input: [{ type: "user_input", content: [{ type: "text", text: "Ready." }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Kore" }] },
    } as never)) as { output_audio?: { data?: string } };
    return `${r.output_audio?.data?.length ?? 0} base64 chars`;
  },
  "gemini-3.5-transcribe": async (ai) =>
    (((await ai.interactions.create({ model: "gemini-3.5-transcribe", input: [audio] } as never)) as { output_text?: string }).output_text ?? "").slice(0, 40),
};

for (const name of names) {
  const key = process.env[name]!.trim();
  const ai = new GoogleGenAI({ apiKey: key, apiVersion: "v1beta" });
  console.log(`\n== ${name} (${key.length} chars)`);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key } });
    const list = (await res.json()) as { models?: { name: string }[] };
    const ids = (list.models ?? []).map((m) => m.name.replace("models/", ""));
    console.log(`models listed: ${ids.length}; omni: ${ids.filter((i) => i.includes("omni")).join(", ") || "none"}`);
  } catch (e) {
    console.log("list failed:", (e as Error).message.slice(0, 120));
  }
  for (const [label, fn] of Object.entries(tests)) {
    const times: number[] = [];
    let out = "";
    let err = "";
    for (let i = 0; i < 2 && !err; i++) {
      const t0 = Date.now();
      try {
        out = await Promise.race([fn(ai), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout 60 s")), 60000))]);
        times.push(Date.now() - t0);
      } catch (e) {
        err = (e as Error).message.replace(/\s+/g, " ").slice(0, 150);
      }
    }
    console.log(`${label.padEnd(28)} ${err ? "FAILED  " + err : "ok  " + times.map((t) => `${t} ms`).join(", ").padEnd(20) + " " + out.trim().replace(/\s+/g, " ").slice(0, 40)}`);
  }
}
process.exit(0);
