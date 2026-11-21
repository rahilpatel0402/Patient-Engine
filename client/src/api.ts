import type { ArmKey, CaseResult, Patient, Probes } from "../../server/engine/types.ts";

export type SetData = { set: string; patients: Patient[]; cases: CaseResult[]; ladder: unknown };

export type LiveResult = {
  id: string;
  clip: string;
  seconds: number;
  transcript: string;
  probes: Probes;
  probe_ms: number;
  arms: Record<ArmKey, { observations: string[]; ms: number }>;
};

export type NoiseProbe = { clip: string; probes: Probes; probe_ms: number; level: number };
export type Health = { ok: boolean; hasKey: boolean; noise: string | null };

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
    json<{ ok: boolean; seconds: number; label: string }>(r),
  );

export const probeNoise = (clip: string, level: number) =>
  fetch("/api/noise/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip, level }),
  }).then((r) => json<NoiseProbe>(r));

export const physicianGate = (set: string, id: string, valid: boolean, note: string) =>
  fetch("/api/physician-gate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ set, id, valid, note }),
  }).then((r) => json<Patient>(r));

export const clipUrl = (clip: string) => `/${clip}`;
