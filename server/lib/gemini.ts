// Thin wrappers over the Gemini Interactions API and Decisions API.
// Every call goes through a concurrency limit, a retry, and the disk cache.
import * as fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { AsyncLocalStorage } from "node:async_hooks";
import { keyNames, keyValue, type KeyRole } from "../env.ts";
import { cached, fileSha, type Cached } from "./cache.ts";

export const MODELS = {
  argon: "gemini-4-argon",
  carbon: "gemini-4-carbon",
  hydrogen: "gemini-4-hydrogen",
  neon: "gemini-4-neon",
  decision: "gemini-decision-1",
  tts: "gemini-3.8-flash-tts",
  transcribe: "gemini-3.5-transcribe",
} as const;

// ---- keys --------------------------------------------------------------------
// Batch work and the live mic path use different keys, so each has its own quota.
// A call that hits a rate limit moves to the next key for its role.

const roleStore = new AsyncLocalStorage<KeyRole>();
const attemptStore = new AsyncLocalStorage<{ keyIndex: number }>();
const clients = new Map<string, GoogleGenAI>();

/** Runs `fn` with every model call inside it billed to the given key role. */
export function withKeyRole<T>(role: KeyRole, fn: () => Promise<T>): Promise<T> {
  return roleStore.run(role, fn);
}

const currentRole = (): KeyRole => roleStore.getStore() ?? "batch";

function ai(): GoogleGenAI {
  const names = keyNames(currentRole());
  if (!names.length) throw new Error("No Gemini API key found. Copy .env.example to .env and set GEMINI_API_KEY.");
  const name = names[(attemptStore.getStore()?.keyIndex ?? 0) % names.length];
  let client = clients.get(name);
  if (!client) {
    client = new GoogleGenAI({ apiKey: keyValue(name), apiVersion: "v1beta" });
    clients.set(name, client);
  }
  return client;
}

// ---- concurrency and retry -------------------------------------------------

const MAX_CONCURRENT = Number(process.env.GEMINI_CONCURRENCY ?? 6);
let active = 0;
const waiting: Array<() => void> = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const text = errorText(e);
      const rateLimited = /429|rate limit|quota/i.test(text);
      const retryable = rateLimited || /500|502|503|504|overloaded|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text);
      if (!retryable || attempt === 4) break;
      const slot = attemptStore.getStore();
      const otherKey = rateLimited && slot && keyNames(currentRole()).length > 1;
      if (otherKey) slot.keyIndex++;
      // With another key to try, go again at once. Otherwise back off.
      const wait = otherKey && attempt === 1 ? 0 : 1500 * 2 ** (attempt - 1);
      console.warn(`[retry ${attempt}] ${label}: ${text.slice(0, 120)} (waiting ${wait} ms)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`${label} failed: ${errorText(last)}`);
}

const CALL_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 90_000);

function withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} ETIMEDOUT after ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS);
  });
  return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
}

/** Runs one model call and reports how long the successful attempt took. */
const call = <T>(label: string, fn: () => Promise<T>) => {
  const attempt = () =>
    attemptStore.run({ keyIndex: 0 }, () =>
      withRetry(label, async () => {
        const t0 = Date.now();
        const value = await withTimeout(label, fn);
        return { value, ms: Date.now() - t0 };
      }),
    );
  // The live path skips the batch queue, so a running batch never delays the demo.
  return currentRole() === "live" ? attempt() : limited(attempt);
};

// ---- inputs ----------------------------------------------------------------

export type AudioRef = { file: string; mime?: string };

function audioBlock(audio: AudioRef) {
  return {
    type: "audio",
    data: fs.readFileSync(audio.file, { encoding: "base64" }),
    mime_type: audio.mime ?? "audio/wav",
  };
}

type TextOpts = {
  model: string;
  system?: string;
  text: string;
  audio?: AudioRef;
  schema?: object;
  thinking?: "low" | "medium" | "high";
};

// ---- text and structured output ---------------------------------------------

export async function generate(opts: TextOpts): Promise<Cached<string>> {
  const key = {
    model: opts.model,
    system: opts.system,
    text: opts.text,
    audio: opts.audio ? fileSha(opts.audio.file) : null,
    schema: opts.schema ?? null,
    thinking: opts.thinking ?? null,
  };
  return cached("generate", key, () =>
    call(`generate ${opts.model}`, async () => {
      const input = opts.audio ? [{ type: "text", text: opts.text }, audioBlock(opts.audio)] : opts.text;
      const body: Record<string, unknown> = { model: opts.model, input };
      if (opts.system) body.system_instruction = opts.system;
      if (opts.schema) body.response_format = { type: "text", mime_type: "application/json", schema: opts.schema };
      if (opts.thinking) body.generation_config = { thinking_level: opts.thinking };
      const interaction = (await ai().interactions.create(body as never)) as { output_text?: string };
      if (!interaction.output_text) throw new Error("empty output_text");
      return interaction.output_text;
    }),
  );
}

export async function generateJson<T>(opts: TextOpts & { schema: object }): Promise<Cached<T>> {
  const out = await generate(opts);
  return { ...out, value: JSON.parse(out.value) as T };
}

// ---- transcription -----------------------------------------------------------

export async function transcribe(audio: AudioRef): Promise<Cached<string>> {
  return cached("transcribe", { model: MODELS.transcribe, audio: fileSha(audio.file) }, () =>
    call("transcribe", async () => {
      const interaction = (await ai().interactions.create({
        model: MODELS.transcribe,
        input: [audioBlock(audio)],
      } as never)) as { output_text?: string };
      return interaction.output_text ?? "";
    }),
  );
}

// ---- speech --------------------------------------------------------------------

/** Renders speech and returns base64 WAV (24 kHz, mono, 16-bit). `attempt` forces a fresh take. */
export async function speak(opts: { text: string; style: string; voice: string; attempt?: number; model?: string }): Promise<Cached<string>> {
  const model = opts.model ?? MODELS.tts;
  const key = { ...opts, model, attempt: opts.attempt ?? 1 };
  return cached("tts", key, () =>
    call("tts", async () => {
      const interaction = (await ai().interactions.create({
        model,
        input: [
          {
            type: "user_input",
            content: [{ type: "text", text: opts.text, annotations: [{ type: "speech_metadata", style: opts.style }] }],
          },
        ],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice: opts.voice }] },
      } as never)) as { output_audio?: { data?: string } };
      const data = interaction.output_audio?.data;
      if (!data) throw new Error("no output_audio");
      return data;
    }),
  );
}

// ---- decisions -------------------------------------------------------------------

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true_description: string; false_description: string };
};
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type Question = NoulQuestion | ChoiceQuestion;

export type Answer =
  | { type: "noul"; noul: number; confidence: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };

export async function decide(opts: {
  text?: string;
  audio?: AudioRef;
  questions: Record<string, Question>;
}): Promise<Cached<Record<string, Answer>>> {
  const key = {
    model: MODELS.decision,
    text: opts.text ?? null,
    audio: opts.audio ? fileSha(opts.audio.file) : null,
    questions: opts.questions,
  };
  return cached("decide", key, () =>
    call("decide", async () => {
      const input = opts.audio
        ? [...(opts.text ? [{ type: "text", text: opts.text }] : []), audioBlock(opts.audio)]
        : (opts.text ?? "");
      const result = (await ai().decisions.create({
        model: MODELS.decision,
        input,
        questions: opts.questions,
      } as never)) as { answers?: Record<string, Answer> };
      if (!result.answers) throw new Error("no answers");
      return result.answers;
    }),
  );
}

export function noul(answers: Record<string, Answer>, key: string): number {
  const a = answers[key];
  if (!a || a.type !== "noul") throw new Error(`no yes/no answer for ${key}`);
  return a.noul;
}
