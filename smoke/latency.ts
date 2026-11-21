// Throwaway: how long does one Hydrogen call take at each thinking level?
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { apiKeyName, requireApiKey } from "../server/env.ts";

console.log(`key: ${apiKeyName()}`);
const ai = new GoogleGenAI({ apiKey: requireApiKey(), apiVersion: "v1beta" });
const model = process.argv[2] ?? "gemini-4-hydrogen";

for (const thinking_level of ["low", "medium"]) {
  const t0 = Date.now();
  try {
    const r = (await Promise.race([
      ai.interactions.create({
        model,
        input: "Reply with a JSON object with one key, greeting, saying hello.",
        response_format: { type: "text", mime_type: "application/json", schema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"] } },
        generation_config: { thinking_level },
      } as never),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 60 s")), 60000)),
    ])) as { output_text?: string; usage?: unknown };
    console.log(`${model} ${thinking_level}: ${Date.now() - t0} ms`, r.output_text, JSON.stringify(r.usage));
  } catch (e) {
    console.log(`${model} ${thinking_level}: FAILED after ${Date.now() - t0} ms`, e instanceof Error ? e.message.slice(0, 300) : e);
  }
}
process.exit(0);
