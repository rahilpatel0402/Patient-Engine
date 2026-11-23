import type { ArmKey, CaseResult, HiddenSign, Patient, Probes } from "../../server/engine/types.ts";
import type { Comparison, Ladder } from "../../server/station1/report.ts";

export type Agreement = {
  labelled: number;
  with_intended: number;
  gate_decided: number;
  with_gate: number;
  deferred: number;
  deferred_passed: number;
  rows: { key: string; id: string; intended: HiddenSign; heard: HiddenSign; gate: "kept" | "not kept" | "deferred"; gate_by: string; agrees_with_gate: boolean | null }[];
};
export type SetData = {
  set: string;
  patients: Patient[];
  cases: CaseResult[];
  ladder: Ladder | null;
  comparison: Comparison | null;
  agreement: Agreement | null;
};
export type BlindState = { set: string; done: boolean; clips: string[] };

export type LiveResult = {
  id: string;
  clip: string;
  seconds: number;
  transcript: string;
  probes: Probes;
  probe_ms: number;
  arms: Record<ArmKey, { observations: string[]; ms: number }>;
};

/** snr: decibels of voice above noise. Null means no noise was mixed in. */
export type NoiseProbe = { clip: string; probes: Probes; probe_ms: number; snr: number | null };
export type NoiseInfo = { label: string; synthetic?: boolean; seconds: number; uploaded: string; saved: number };
export type Health = {
  ok: boolean;
  hasKey: boolean;
  noise: NoiseInfo | null;
  /** Set on a public server: whether live calls are on, need a code, and how many are left today. */
  hosted?: boolean;
  live?: boolean;
  needsCode?: boolean;
  liveLeft?: number | null;
  liveLimit?: number | null;
  retainMinutes?: number | null;
};

// The access code for a public server. Kept for this browser tab only.
const CODE_KEY = "patient-engine-access-code";
export function getCode(): string {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setCode(code: string): void {
  try {
    sessionStorage.setItem(CODE_KEY, code);
  } catch {
    // The code still works for this page load through the value in memory.
  }
  memoryCode = code;
}
let memoryCode = getCode();
const withCode = (headers: Record<string, string>): Record<string, string> => (memoryCode ? { ...headers, "X-Access-Code": memoryCode } : headers);

/** True when the server is using generated noise in place of a room recording. */
export let noiseIsSynthetic = false;

/** True in the read-only showcase build, which has no server behind it. */
export const STATIC = import.meta.env.VITE_STATIC === "1";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const getHealth = (): Promise<Health> =>
  STATIC
    ? Promise.resolve({ ok: true, hasKey: true, noise: null })
    : fetch("/api/health")
        .then((r) => json<Health>(r))
        .then((h) => {
          noiseIsSynthetic = Boolean(h.noise?.synthetic);
          return h;
        });
// The showcase reads the saved runs from a file that sits next to the page.
export const getSets = () => fetch(STATIC ? "sets.json" : "/api/sets").then((r) => json<SetData[]>(r));

export const sendLive = (audio: Blob) =>
  fetch("/api/live", { method: "POST", headers: withCode({ "Content-Type": audio.type || "application/octet-stream" }), body: audio }).then((r) =>
    json<LiveResult>(r),
  );

export const sendNoise = (audio: Blob) =>
  fetch("/api/noise", { method: "POST", headers: { "Content-Type": audio.type || "application/octet-stream" }, body: audio }).then((r) =>
    json<{ ok: boolean; seconds: number; label: string; saved: number }>(r),
  );

export const probeNoise = (clip: string, snr: number | null) =>
  fetch("/api/noise/probe", {
    method: "POST",
    headers: withCode({ "Content-Type": "application/json" }),
    body: JSON.stringify({ clip, snr }),
  }).then((r) => json<NoiseProbe>(r));

export const physicianGate = (set: string, id: string, valid: boolean, note: string) =>
  fetch("/api/physician-gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set, id, valid, note }),
  }).then((r) => json<Patient>(r));

export const getBlind = (set: string): Promise<BlindState> =>
  STATIC ? Promise.resolve({ set, done: true, clips: [] }) : fetch(`/api/blind/${set}`).then((r) => json<BlindState>(r));
export const blindAudio = (set: string, key: string) => `/api/blind/${set}/audio/${key}`;
export const saveBlind = (set: string, labels: Record<string, HiddenSign>) =>
  fetch(`/api/blind/${set}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labels }) }).then((r) =>
    json<{ saved: number; verdicts: number }>(r),
  );

export const clipUrl = (clip: string) => (STATIC ? clip : `/${clip}`);
