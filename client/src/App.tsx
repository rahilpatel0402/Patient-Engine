import { useEffect, useMemo, useRef, useState } from "react";
import {
  ARM_LABEL,
  PROBE_KEYS,
  PROBE_LABEL,
  SIGN_LABEL,
  SIGN_PROBE,
  type ArmKey,
  type ArmResult,
  type CaseResult,
  type HiddenSign,
  type Patient,
  type ProbeKey,
  type Probes,
} from "../../server/engine/types.ts";
import { CHOSEN_BAR, sensitivity } from "../../server/station1/report.ts";
import { blindAudio, getBlind, saveBlind, type BlindState } from "./api.ts";
import { clipUrl, getHealth, getSets, physicianGate, probeNoise, sendLive, sendNoise, type Health, type LiveResult, type SetData } from "./api.ts";

const ARMS: ArmKey[] = ["A", "B", "C"];
const ARM_SOURCE: Record<ArmKey, string> = {
  A: "Hydrogen read the transcript",
  B: "Hydrogen heard the audio",
  C: "Hydrogen read the transcript and the probe results",
};
const SET_NAME: Record<string, string> = { dev: "Practice set (Argon)", exam: "Exam set (Carbon)", "slurred-lab": "Slurred speech lab" };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sets, setSets] = useState<SetData[]>([]);
  const [mode, setMode] = useState<"exam" | "live" | "blind">("exam");
  const [blind, setBlind] = useState<BlindState | null>(null);
  const refreshBlind = () => getBlind("exam").then(setBlind).catch(() => setBlind(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch((e: Error) => setError(e.message));
    getSets().then(setSets).catch((e: Error) => setError(e.message));
    void refreshBlind();
  }, []);
  const blindPending = Boolean(blind && blind.clips.length && !blind.done);

  return (
    <main>
      <header className="top">
        <div>
          <h1>Patient Engine</h1>
          <p className="tagline">An exam for clinical AI's senses. Station 1: Listening.</p>
        </div>
        <nav className="modes" aria-label="Mode">
          <button className={mode === "exam" ? "on" : ""} onClick={() => setMode("exam")}>
            Exam patients
          </button>
          <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>
            Live mic
          </button>
          {blindPending && (
            <button className={mode === "blind" ? "on" : "attn"} onClick={() => setMode("blind")}>
              Blind labels
            </button>
          )}
        </nav>
      </header>
      <p className="notice">Every exam patient is synthetic. This tests the AI. Nobody receives medical advice.</p>
      {error && <p className="error">Cannot reach the server: {error}</p>}
      {health && !health.hasKey && <p className="error">No Gemini API key is loaded. Live mode will not work.</p>}
      {blindPending && mode !== "blind" && (
        <p className="notice">
          The exam set is ready, and its results are hidden until you finish the blind labels. Open "Blind labels" first.
        </p>
      )}
      {mode === "blind" && blind ? (
        <Blind state={blind} onSaved={() => { void refreshBlind(); getSets().then(setSets); setMode("exam"); }} />
      ) : mode === "exam" ? <Exam sets={sets} hasNoise={Boolean(health?.noise)} reload={() => getSets().then(setSets)} /> : <Live health={health} onNoise={() => getHealth().then(setHealth)} />}
    </main>
  );
}

// ---- exam patients ---------------------------------------------------------------

function Exam({ sets, hasNoise, reload }: { sets: SetData[]; hasNoise: boolean; reload: () => void }) {
  const ordered = useMemo(() => [...sets].sort((a, b) => (a.set === "exam" ? -1 : b.set === "exam" ? 1 : a.set.localeCompare(b.set))), [sets]);
  const [setName, setSetName] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const current = ordered.find((s) => s.set === setName) ?? ordered[0];

  if (!current) return <p className="empty">No patient sets yet. Build one with scripts/build-set.ts.</p>;
  const patient = current.patients.find((p) => p.id === patientId) ?? current.patients.find((p) => p.gate.kept) ?? current.patients[0];
  const result = current.cases.find((c) => c.patient.id === patient?.id);

  return (
    <>
      {ordered.length > 1 && (
        <div className="setpick">
          {ordered.map((s) => (
            <button key={s.set} className={s.set === current.set ? "on" : ""} onClick={() => { setSetName(s.set); setPatientId(null); }}>
              {SET_NAME[s.set] ?? s.set}
            </button>
          ))}
        </div>
      )}
      <Scoreboard data={current} />
      <Sensitivity data={current} />
      {current.agreement && (
        <p className="agree">
          Blind physician labels: on {current.agreement.labelled} clips heard with the sign hidden, the physician named the intended sign on {current.agreement.with_intended} and agreed with the automatic gate on {current.agreement.with_gate}.
        </p>
      )}
      <div className="workbench">
        <ul className="patients" aria-label="Patients">
          {current.patients.map((p) => {
            const c = current.cases.find((x) => x.patient.id === p.id);
            return (
              <li key={p.id}>
                <button className={p.id === patient?.id ? "on" : ""} onClick={() => setPatientId(p.id)}>
                  <span className="pid">{p.id.replace(/^[a-z]+-/, "").replace(/-.*/, "")}</span>
                  <span className="psign">{SIGN_LABEL[p.hidden_sign]}</span>
                  {p.gate.by === "physician" && !p.gate.physician ? (
                    <span className="tag review" title="A physician has to listen to this clip and decide">needs you</span>
                  ) : !p.gate.kept ? (
                    <span className="tag dropped" title="Left out of the test: the intended sign did not come through">dropped</span>
                  ) : c ? (
                    <ArmDots result={c} />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {patient && <CaseView key={patient.id} patient={patient} result={result} hasNoise={hasNoise} reload={reload} />}
      </div>
    </>
  );
}

function hit(a: ArmResult): "good" | "bad" | "unsure" {
  const s = a.grade.status;
  return s === "unclear" ? "unsure" : s === "caught" || s === "quiet" ? "good" : "bad";
}

const VERDICT_TEXT: Record<ArmResult["grade"]["status"], string> = {
  caught: "Caught the sign",
  missed: "Missed the sign",
  quiet: "No false alarm",
  alarm: "False alarm",
  unclear: "Unclear, needs physician review",
};

function ArmDots({ result }: { result: CaseResult }) {
  return (
    <span className="dots" aria-hidden="true">
      {ARMS.map((arm) => {
        const a = result.arms.find((x) => x.arm === arm);
        return a ? <i key={arm} className={hit(a)}>{arm}</i> : null;
      })}
    </span>
  );
}

function Scoreboard({ data }: { data: SetData }) {
  // Count only clips that are in the test now. A physician can pass or reject a clip after the arms ran.
  const kept = new Set(data.patients.filter((p) => p.gate.kept).map((p) => p.id));
  const counted = data.cases.filter((c) => kept.has(c.patient.id));
  const signCases = counted.filter((c) => c.patient.hidden_sign !== "none");
  const controls = counted.filter((c) => c.patient.hidden_sign === "none");
  const dropped = data.patients.filter((p) => !p.gate.kept).length;
  if (!counted.length) return null;
  const review = counted.reduce((n, c) => n + c.arms.filter((a) => a.grade.needs_review).length, 0);
  return (
    <section className="score" aria-label="Result of the listening test">
      <h2>Result of the listening test, {SET_NAME[data.set] ?? data.set}</h2>
      <div className="scorerow">
        {ARMS.map((arm) => {
          const caught = signCases.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.caught).length;
          const unclear = signCases.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.needs_review).length;
          const alarms = controls.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.false_alarm).length;
          return (
            <div key={arm} className="scorecell">
              <div className="armname">{arm}. {ARM_LABEL[arm]}</div>
              <div className="count">
                <b>{caught}</b> of {signCases.length} <span>hidden signs caught</span>
              </div>
              <div className="sub">{alarms} of {controls.length} false alarms on healthy controls{unclear ? `, ${unclear} unclear` : ""}</div>
            </div>
          );
        })}
      </div>
      <p className="sub">
        {data.patients.length} clips generated, {dropped} left out by the gate, {review} graded notes sent to physician review.
      </p>
    </section>
  );
}

/** Read-only: what the result would have been at other pass marks. Nothing here can be adjusted. */
function Sensitivity({ data }: { data: SetData }) {
  const rows = sensitivity(data.patients, data.cases);
  const all = rows[rows.length - 1];
  if (!all.generated || !ARMS.some((arm) => all.arms[arm].of === all.generated)) return null;
  return (
    <details className="sens">
      <summary>Would a different pass mark change the result for this whole set?</summary>
      <p className="muted">
        The pass mark of {CHOSEN_BAR.toFixed(2)} was fixed before any result existed. Every generated clip was run through all three arms, so this table shows what each other bar would have given. It counts every clip in the set, so it does not change when you select a patient. It covers the signs gated by the listening model. Signs gated by a physician are not included.
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Pass mark</th>
              <th>Clips kept</th>
              {ARMS.map((arm) => <th key={arm}>{arm}. {ARM_LABEL[arm]}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.bar)} className={r.bar === CHOSEN_BAR ? "chosen" : ""}>
                <td>{r.bar === null ? "No gate" : r.bar.toFixed(2)}{r.bar === CHOSEN_BAR ? " (used)" : ""}</td>
                <td>{r.kept} of {r.generated}</td>
                {ARMS.map((arm) => <td key={arm}>{r.arms[arm].caught} of {r.arms[arm].of} caught</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CaseView({ patient, result, hasNoise, reload }: { patient: Patient; result?: CaseResult; hasNoise: boolean; reload: () => void }) {
  const intended = patient.hidden_sign === "none" ? null : SIGN_PROBE[patient.hidden_sign];
  return (
    <section className="case">
      <div className="casehead">
        <div>
          <div className="eyebrow">Hidden sign, known only to the examiner</div>
          <div className="signname">{SIGN_LABEL[patient.hidden_sign]}</div>
        </div>
        <audio controls src={clipUrl(patient.clip)} />
      </div>
      <p className="persona">{patient.persona}</p>
      <blockquote className="transcript">
        <div className="eyebrow">What a text pipeline gets</div>
        {result?.transcript ?? patient.spoken_text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")}
      </blockquote>
      <GateBox patient={patient} reload={reload} />
      <details className="script">
        <summary>What the author wrote for the voice</summary>
        <p><b>Voice direction:</b> {patient.tts_style}</p>
        <p><b>Script with sound tags:</b> {patient.spoken_text}</p>
        <p className="muted">Written by {patient.author_model}, voiced by Gemini TTS ({patient.voice}), {patient.seconds} seconds.</p>
      </details>

      {result && (
        <div className="arms">
          {ARMS.map((arm) => {
            const a = result.arms.find((x) => x.arm === arm);
            if (!a) return null;
            const verdict = hit(a);
            const label = VERDICT_TEXT[a.grade.status];
            return (
              <article key={arm} className={`arm ${verdict}`}>
                <div className="armname">{arm}. {ARM_LABEL[arm]}</div>
                <div className="armsource">{ARM_SOURCE[arm]}</div>
                <div className={`verdict ${verdict}`}>{label}</div>
                <div className="urgency">Urgency: {a.note.urgency}</div>
                <List title="Observations" items={a.note.observations} />
                <List title="Red flags" items={a.note.red_flags} none="None" />
                {a.grade.needs_review && <div className="tag review">The grader was not sure this note names the sign (confidence {a.grade.confidence.toFixed(2)}). Not counted as caught.</div>}
              </article>
            );
          })}
        </div>
      )}

      <NoiseBench
        clip={patient.clip}
        baseline={patient.probes}
        highlight={intended}
        passMark={!patient.gate.by || patient.gate.by === "probe"}
        hasNoise={hasNoise}
        title="What the Decisions API heard in the raw audio"
      />
    </section>
  );
}

const GATE_SIGN_MIN = 0.8;
const GATE_CONTROL_MAX = 0.3;

/** Says in plain words why this clip is in the test or left out of it. */
function GateBox({ patient, reload }: { patient: Patient; reload: () => void }) {
  if (patient.gate.by === "physician") return <PhysicianGate patient={patient} reload={reload} />;
  if (patient.gate.by === "consensus") {
    return (
      <div className={`gate ${patient.gate.kept ? "kept" : "out"}`}>
        <div className="gatehead">{patient.gate.kept ? "Passed automatically: two listeners agree" : "Dropped automatically: two listeners agree"}</div>
        <p>
          For this sign two models listen to the clip: the Decisions API and {patient.gate.auto?.listener_model}. Here {patient.gate.reason}, so no physician was needed.
        </p>
      </div>
    );
  }
  const takes = patient.gate.attempts === 1 ? "on the first take" : `after ${patient.gate.attempts} takes`;
  let text: string;
  if (patient.hidden_sign === "none") {
    text = patient.gate.kept
      ? `A healthy control must stay at or under ${GATE_CONTROL_MAX.toFixed(2)} on every sign. This clip did, ${takes}, so it is in the test.`
      : `A healthy control must stay at or under ${GATE_CONTROL_MAX.toFixed(2)} on every sign. This clip did not (${patient.gate.reason}), so it is left out of the test.`;
  } else {
    const key = SIGN_PROBE[patient.hidden_sign];
    const heard = patient.probes[key].toFixed(2);
    text = patient.gate.kept
      ? `To count as a "${PROBE_LABEL[key]}" patient, the Decisions API must hear that sign in the audio at ${GATE_SIGN_MIN.toFixed(2)} or higher. It heard ${heard} ${takes}, so this clip is in the test. It would stay in at any pass mark up to ${heard}.`
      : `To count as a "${PROBE_LABEL[key]}" patient, the Decisions API must hear that sign in the audio at ${GATE_SIGN_MIN.toFixed(2)} or higher. It heard only ${heard} ${takes}, so this clip is left out of the test. It would be in only if the pass mark were ${heard} or lower. Listen and judge for yourself.`;
  }
  return (
    <div className={`gate ${patient.gate.kept ? "kept" : "out"}`}>
      <div className="gatehead">{patient.gate.kept ? "Passed the perception gate" : "Dropped by the perception gate"}</div>
      <p>{text}</p>
    </div>
  );
}

/** Slurred speech is judged by a physician, because the listening model under-detects it. */
function PhysicianGate({ patient, reload }: { patient: Patient; reload: () => void }) {
  const [note, setNote] = useState(patient.gate.physician?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const verdict = patient.gate.physician;
  const heard = patient.probes[SIGN_PROBE[patient.hidden_sign as Exclude<HiddenSign, "none">]].toFixed(2);

  async function decide(valid: boolean) {
    setError(null);
    try {
      await physicianGate(patient.set, patient.id, valid, note);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className={`gate ${verdict ? (verdict.valid ? "kept" : "out") : "out"}`}>
      <div className="gatehead">
        {verdict ? (verdict.valid ? "Passed by a physician" : "Rejected by a physician") : "Waiting for a physician to listen"}
      </div>
      <p>
        Two models listen to every clip of this sign. A physician is asked only when they are unsure or disagree, as here: {patient.gate.auto?.why ?? `the Decisions API scored it ${heard}`}.
      </p>
      {verdict?.note && <p><b>Physician note:</b> {verdict.note}</p>}
      <div className="gatebuttons">
        <input id={`gate-note-${patient.id}`} type="text" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={() => decide(true)}>I hear the sign. Use it</button>
        <button onClick={() => decide(false)}>I do not hear it. Leave it out</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function List({ title, items, none }: { title: string; items: string[]; none?: string }) {
  return (
    <div className="list">
      <div className="eyebrow">{title}</div>
      {items.length ? <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="muted">{none ?? "Nothing recorded"}</p>}
    </div>
  );
}

// ---- probes and noise ------------------------------------------------------------

/** Plain words for a probability, so that 0.36 is not read as a detection. */
function likelihood(p: number): string {
  return p >= 0.8 ? "very likely" : p >= 0.5 ? "likely" : p >= 0.2 ? "unlikely" : "very unlikely";
}

function ProbeBars({ probes, highlight, baseline, passMark }: { probes: Probes; highlight?: ProbeKey | null; baseline?: Probes; passMark?: boolean }) {
  return (
    <div className="bars">
      <p className="barsnote">
        Each number is the probability, from 0 to 1, that the sign is present somewhere in the clip. It is not a time. Below 0.50 means the sign was probably not heard.
      </p>
      {PROBE_KEYS.map((k) => (
        <div key={k} className={`bar ${k === highlight ? "target" : ""} ${probes[k] >= 0.5 ? "" : "low"}`}>
          <span className="barlabel">{PROBE_LABEL[k]}</span>
          <span className="track">
            {baseline && <i className="ghost" style={{ width: `${baseline[k] * 100}%` }} />}
            <i className="fill" style={{ width: `${probes[k] * 100}%` }} />
            {k === highlight && passMark && <i className="need" style={{ left: `${GATE_SIGN_MIN * 100}%` }} title="The gate needs 0.80 here" />}
          </span>
          <span className="barvalue">{probes[k].toFixed(2)}</span>
          <span className="barword">{likelihood(probes[k])}</span>
        </div>
      ))}
    </div>
  );
}

// Slider stops for the noise control. Each is how many decibels the voice sits
// above the room noise. Null is no noise. The mix is measured per clip, so
// "as loud as the voice" means the same thing on every clip.
const NOISE_STOPS: (number | null)[] = [null, 15, 10, 5, 0, -5, -10];

function noiseWords(snr: number | null): string {
  if (snr === null) return "off";
  if (snr >= 15) return "faint";
  if (snr >= 10) return "quiet room";
  if (snr >= 5) return "busy room";
  if (snr === 0) return "as loud as the voice";
  if (snr >= -5) return "louder than the voice";
  return "much louder than the voice";
}

function NoiseBench(props: { clip: string; baseline: Probes; highlight?: ProbeKey | null; passMark?: boolean; hasNoise: boolean; title: string; note?: string }) {
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<{ probes: Probes; clip: string; ms: number; snr: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const snr = NOISE_STOPS[level];

  async function apply(next: number) {
    const ticket = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const r = await probeNoise(props.clip, NOISE_STOPS[next]);
      if (ticket === latest.current) setHeard({ probes: r.probes, clip: r.clip, ms: r.probe_ms, snr: r.snr });
    } catch (e) {
      if (ticket === latest.current) setError((e as Error).message);
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }

  const probes = heard?.probes ?? props.baseline;
  return (
    <section className="bench">
      <h3>{props.title}</h3>
      {props.note && <p className="muted">{props.note}</p>}
      <ProbeBars probes={probes} highlight={props.highlight} passMark={props.passMark} baseline={heard && heard.snr !== null ? props.baseline : undefined} />
      {props.highlight && props.passMark && (
        <p className="muted">
          The dashed line is this project's pass mark: "{PROBE_LABEL[props.highlight]}" is the sign this patient was written to have, and it must reach 0.80 for the clip to be used.
        </p>
      )}
      {props.highlight && props.passMark === false && (
        <p className="muted">
          "{PROBE_LABEL[props.highlight]}" is the sign this patient was written to have. There is no single pass mark on this bar. Two models listen, and a physician settles the clips they disagree on.
        </p>
      )}
      <div className="noise">
        <label htmlFor="noise-level">
          Room noise: {noiseWords(snr)}
          {snr !== null && <span className="snr"> ({snr > 0 ? `voice ${snr} dB above the noise` : snr === 0 ? "equal levels" : `noise ${-snr} dB above the voice`})</span>}
        </label>
        <input
          id="noise-level"
          type="range"
          min={0}
          max={NOISE_STOPS.length - 1}
          step={1}
          value={level}
          disabled={!props.hasNoise}
          onChange={(e) => setLevel(Number(e.target.value))}
          onPointerUp={() => apply(level)}
          onKeyUp={() => apply(level)}
        />
        <span className="muted">
          {!props.hasNoise
            ? "Add a room noise recording in Live mic to use this."
            : busy
              ? "Listening again"
              : heard
                ? `Probed in ${heard.ms} ms. The faint bar is the clean clip.`
                : "Move the slider to add noise and probe again."}
        </span>
        {heard && heard.snr !== null && <audio controls src={clipUrl(heard.clip)} />}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// ---- live mic ---------------------------------------------------------------------

const MAX_SECONDS = 15;

function Live({ health, onNoise }: { health: Health | null; onNoise: () => void }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noiseMsg, setNoiseMsg] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  async function submit(audio: Blob) {
    setState("working");
    setError(null);
    try {
      setResult(await sendLive(audio));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  async function start() {
    setError(null);
    setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) window.clearInterval(timer.current);
        void submit(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState("recording");
      const t0 = Date.now();
      timer.current = window.setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
      }, 200);
    } catch (e) {
      setError(`Microphone unavailable: ${(e as Error).message}. Upload a recording instead.`);
    }
  }

  const stop = () => recorder.current?.state === "recording" && recorder.current.stop();

  async function uploadNoise(file: File | undefined) {
    if (!file) return;
    setNoiseMsg("Converting");
    try {
      const r = await sendNoise(file);
      setNoiseMsg(`Saved, ${r.seconds} seconds. This recording is now the one in use. ${r.saved} uploads are kept.`);
      onNoise();
    } catch (e) {
      setNoiseMsg((e as Error).message);
    }
  }

  return (
    <section className="live">
      <h2>Act a patient. Say you are fine.</h2>
      <p className="lede">
        Pick something to hide: short of breath, groaning, or coughing. Deny it in words for 10 to 15 seconds. The page shows only what the model observed, never what to do.
      </p>
      <div className="controls">
        {state === "recording" ? (
          <button className="rec stop" onClick={stop}>Stop ({Math.max(0, MAX_SECONDS - seconds).toFixed(0)} s left)</button>
        ) : (
          <button className="rec" onClick={start} disabled={state === "working"}>{state === "working" ? "Listening" : "Record"}</button>
        )}
        <label className="upload">
          or upload a recording
          <input id="live-upload" type="file" accept="audio/*,video/*" disabled={state !== "idle"} onChange={(e) => e.target.files?.[0] && submit(e.target.files[0])} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="case">
          <div className="casehead">
            <div>
              <div className="eyebrow">Your recording, {result.seconds} seconds</div>
              <div className="signname">Acted, not a real patient</div>
            </div>
            <audio controls src={clipUrl(result.clip)} />
          </div>
          <blockquote className="transcript">
            <div className="eyebrow">What a text pipeline gets</div>
            {result.transcript || "(no words transcribed)"}
          </blockquote>
          <div className="arms">
            {ARMS.map((arm) => (
              <article key={arm} className="arm">
                <div className="armname">{arm}. {ARM_LABEL[arm]}</div>
                <div className="armsource">{ARM_SOURCE[arm]}</div>
                <List title="Observations only" items={result.arms[arm].observations} />
              </article>
            ))}
          </div>
          <NoiseBench
            key={result.id}
            clip={result.clip}
            baseline={result.probes}
            hasNoise={Boolean(health?.noise)}
            title="Acted signs the Decisions API heard"
            note={`Calibrated probabilities from the raw audio, back in ${result.probe_ms} ms. These describe an acted voice. They are not a health finding.`}
          />
        </div>
      )}

      <div className="noiseupload">
        <label htmlFor="noise-upload">
          Room noise recording:{" "}
          {health?.noise
            ? `${health.noise.seconds} seconds, uploaded at ${new Date(health.noise.uploaded).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Only the most recent upload is used.`
            : "none yet"}
        </label>
        <input id="noise-upload" type="file" accept="audio/*,video/*" onChange={(e) => uploadNoise(e.target.files?.[0])} />
        {noiseMsg && <span className="muted">{noiseMsg}</span>}
      </div>
    </section>
  );
}

// ---- blind physician labels -------------------------------------------------------

const BLIND_CHOICES: HiddenSign[] = ["breathless", "groaning", "cough", "distress", "slurred", "none"];

function Blind({ state, onSaved }: { state: BlindState; onSaved: () => void }) {
  const [labels, setLabels] = useState<Record<string, HiddenSign>>(() => {
    try {
      return JSON.parse(localStorage.getItem("blind-" + state.set) ?? "{}") as Record<string, HiddenSign>;
    } catch {
      return {};
    }
  });
  const [error, setError] = useState<string | null>(null);
  const done = state.clips.filter((k) => labels[k]).length;

  function pick(key: string, heard: HiddenSign) {
    const next = { ...labels, [key]: heard };
    setLabels(next);
    try {
      localStorage.setItem("blind-" + state.set, JSON.stringify(next));
    } catch {
      // The labels still live in memory until saved.
    }
  }

  async function save() {
    setError(null);
    try {
      await saveBlind(state.set, labels);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="blind">
      <h2>Blind labels: what do you hear?</h2>
      <p className="lede">
        {state.clips.length} exam clips in random order, with the sign hidden. Every speaker says they are fine. Pick the one thing you hear most clearly in the voice, or "Sounds well". Exam results stay hidden until you save.
      </p>
      <ol className="blindlist">
        {state.clips.map((key, i) => (
          <li key={key} className={labels[key] ? "done" : ""}>
            <span className="pid">{String(i + 1).padStart(2, "0")}</span>
            <audio controls preload="none" src={blindAudio(state.set, key)} />
            <div className="choices" role="radiogroup" aria-label={"Clip " + (i + 1)}>
              {BLIND_CHOICES.map((c) => (
                <button key={c} role="radio" aria-checked={labels[key] === c} className={labels[key] === c ? "on" : ""} onClick={() => pick(key, c)}>
                  {c === "none" ? "Sounds well" : SIGN_LABEL[c]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="controls">
        <button className="rec" disabled={done < state.clips.length} onClick={save}>
          Save labels ({done} of {state.clips.length})
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </section>
  );
}
