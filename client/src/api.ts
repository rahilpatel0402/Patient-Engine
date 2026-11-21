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
export type NoiseInfo = { label: string; seconds: number; uploaded: string; saved: number };
export type Health = { ok: boolean; hasKey: boolean; noise: NoiseInfo | null };

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const getHealth = () => fetch("/api/health").then((r) => json<Health>(r));
export const getSets = () => fetch("/api/sets").then((r) => json<SetData[]>(r));

export const sendLive = (audio: Blob) =>
  fetch("/api/live", { method: "POST", headers: { "Content-Type": audio.type || "application/octet-stream" }, body: audio }).then((r) =>
    json<LiveResult>(r),
  );

export const sendNoise = (audio: Blob) =>
  fetch("/api/noise", { method: "POST", headers: { "Content-Type": audio.type || "application/octet-stream" }, body: audio }).then((r) =>
    json<{ ok: boolean; seconds: number; label: string; saved: number }>(r),
  );

export const probeNoise = (clip: string, snr: number | null) =>
  fetch("/api/noise/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip, snr }),
  }).then((r) => json<NoiseProbe>(r));

export const physicianGate = (set: string, id: string, valid: boolean, note: string) =>
  fetch("/api/physician-gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set, id, valid, note }),
  }).then((r) => json<Patient>(r));

export const getBlind = (set: string) => fetch(`/api/blind/${set}`).then((r) => json<BlindState>(r));
export const blindAudio = (set: string, key: string) => `/api/blind/${set}/audio/${key}`;
export const saveBlind = (set: string, labels: Record<string, HiddenSign>) =>
  fetch(`/api/blind/${set}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labels }) }).then((r) =>
    json<{ saved: number; verdicts: number }>(r),
  );

export const clipUrl = (clip: string) => `/${clip}`;
