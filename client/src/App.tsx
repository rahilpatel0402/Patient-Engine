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
import { clipUrl, getHealth, getSets, probeNoise, sendLive, sendNoise, type Health, type LiveResult, type SetData } from "./api.ts";

const ARMS: ArmKey[] = ["A", "B", "C"];
const ARM_SOURCE: Record<ArmKey, string> = {
  A: "Hydrogen read the transcript",
  B: "Hydrogen heard the audio",
  C: "Hydrogen read the transcript and the probe results",
};
const SET_NAME: Record<string, string> = { dev: "Practice set (Argon)", exam: "Exam set (Carbon)" };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sets, setSets] = useState<SetData[]>([]);
  const [mode, setMode] = useState<"exam" | "live">("exam");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch((e: Error) => setError(e.message));
    getSets().then(setSets).catch((e: Error) => setError(e.message));
  }, []);

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
        </nav>
      </header>
      <p className="notice">Every exam patient is synthetic. This tests the AI. Nobody receives medical advice.</p>
      {error && <p className="error">Cannot reach the server: {error}</p>}
      {health && !health.hasKey && <p className="error">No Gemini API key is loaded. Live mode will not work.</p>}
      {mode === "exam" ? <Exam sets={sets} hasNoise={Boolean(health?.noise)} /> : <Live health={health} onNoise={() => getHealth().then(setHealth)} />}
    </main>
  );
}

// ---- exam patients ---------------------------------------------------------------

function Exam({ sets, hasNoise }: { sets: SetData[]; hasNoise: boolean }) {
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
      <div className="workbench">
        <ul className="patients" aria-label="Patients">
          {current.patients.map((p) => {
            const c = current.cases.find((x) => x.patient.id === p.id);
            return (
              <li key={p.id}>
                <button className={p.id === patient?.id ? "on" : ""} onClick={() => setPatientId(p.id)}>
                  <span className="pid">{p.id.replace(/^[a-z]+-/, "").replace(/-.*/, "")}</span>
                  <span className="psign">{SIGN_LABEL[p.hidden_sign]}</span>
                  {!p.gate.kept ? <span className="tag dropped" title="Left out of the test: the Decisions API did not hear the intended sign clearly enough">dropped</span> : c ? <ArmDots result={c} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {patient && <CaseView key={patient.id} patient={patient} result={result} hasNoise={hasNoise} />}
      </div>
    </>
  );
}

function hit(a: ArmResult, sign: HiddenSign): "good" | "bad" {
  return sign === "none" ? (a.grade.false_alarm ? "bad" : "good") : a.grade.caught ? "good" : "bad";
}

function ArmDots({ result }: { result: CaseResult }) {
  return (
    <span className="dots" aria-hidden="true">
      {ARMS.map((arm) => {
        const a = result.arms.find((x) => x.arm === arm);
        return a ? <i key={arm} className={hit(a, result.patient.hidden_sign)}>{arm}</i> : null;
      })}
    </span>
  );
}

function Scoreboard({ data }: { data: SetData }) {
  const signCases = data.cases.filter((c) => c.patient.hidden_sign !== "none");
  const controls = data.cases.filter((c) => c.patient.hidden_sign === "none");
  const dropped = data.patients.filter((p) => !p.gate.kept).length;
  if (!data.cases.length) return null;
  const review = data.cases.reduce((n, c) => n + c.arms.filter((a) => a.grade.needs_review).length, 0);
  return (
    <section className="score" aria-label="Result of the listening test">
      <h2>Result of the listening test, {SET_NAME[data.set] ?? data.set}</h2>
      <div className="scorerow">
        {ARMS.map((arm) => {
          const caught = signCases.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.caught).length;
          const alarms = controls.filter((c) => c.arms.find((a) => a.arm === arm)?.grade.false_alarm).length;
          return (
            <div key={arm} className="scorecell">
              <div className="armname">{arm}. {ARM_LABEL[arm]}</div>
              <div className="count">
                <b>{caught}</b> of {signCases.length} <span>hidden signs caught</span>
              </div>
              <div className="sub">{alarms} of {controls.length} false alarms on healthy controls</div>
            </div>
          );
        })}
      </div>
      <p className="sub">
        {data.patients.length} clips generated, {dropped} dropped by the perception gate, {review} graded notes sent to physician review.
      </p>
    </section>
  );
}

function CaseView({ patient, result, hasNoise }: { patient: Patient; result?: CaseResult; hasNoise: boolean }) {
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
      <GateBox patient={patient} />
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
            const verdict = hit(a, patient.hidden_sign);
            const label = patient.hidden_sign === "none" ? (verdict === "good" ? "No false alarm" : "False alarm") : verdict === "good" ? "Caught the sign" : "Missed the sign";
            return (
              <article key={arm} className={`arm ${verdict}`}>
                <div className="armname">{arm}. {ARM_LABEL[arm]}</div>
                <div className="armsource">{ARM_SOURCE[arm]}</div>
                <div className={`verdict ${verdict}`}>{label}</div>
                <div className="urgency">Urgency: {a.note.urgency}</div>
                <List title="Observations" items={a.note.observations} />
                <List title="Red flags" items={a.note.red_flags} none="None" />
                {a.grade.needs_review && <div className="tag review">Sent to physician review, grader confidence {a.grade.confidence.toFixed(2)}</div>}
              </article>
            );
          })}
        </div>
      )}

      <NoiseBench clip={patient.clip} baseline={patient.probes} highlight={intended} hasNoise={hasNoise} title="What the Decisions API heard in the raw audio" />
    </section>
  );
}

const GATE_SIGN_MIN = 0.8;
const GATE_CONTROL_MAX = 0.3;

/** Says in plain words why this clip is in the test or left out of it. */
function GateBox({ patient }: { patient: Patient }) {
  const takes = patient.gate.attempts === 1 ? "on the first take" : "after two takes";
  let text: string;
  if (patient.hidden_sign === "none") {
    text = patient.gate.kept
      ? `A healthy control must stay at or under ${GATE_CONTROL_MAX.toFixed(2)} on every sign. This clip did, ${takes}, so it is in the test.`
      : `A healthy control must stay at or under ${GATE_CONTROL_MAX.toFixed(2)} on every sign. This clip did not (${patient.gate.reason}), so it is left out of the test.`;
  } else {
    const key = SIGN_PROBE[patient.hidden_sign];
    const heard = patient.probes[key].toFixed(2);
    text = patient.gate.kept
      ? `To count as a "${PROBE_LABEL[key]}" patient, the Decisions API must hear that sign in the audio at ${GATE_SIGN_MIN.toFixed(2)} or higher. It heard ${heard} ${takes}, so this clip is in the test.`
      : `To count as a "${PROBE_LABEL[key]}" patient, the Decisions API must hear that sign in the audio at ${GATE_SIGN_MIN.toFixed(2)} or higher. It heard only ${heard} ${takes}, so this clip is left out of the test. Listen and judge for yourself.`;
  }
  return (
    <div className={`gate ${patient.gate.kept ? "kept" : "out"}`}>
      <div className="gatehead">{patient.gate.kept ? "Passed the perception gate" : "Dropped by the perception gate"}</div>
      <p>{text}</p>
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

function ProbeBars({ probes, highlight, baseline }: { probes: Probes; highlight?: ProbeKey | null; baseline?: Probes }) {
  return (
    <div className="bars">
      {PROBE_KEYS.map((k) => (
        <div key={k} className={`bar ${k === highlight ? "target" : ""}`}>
          <span className="barlabel">{PROBE_LABEL[k]}</span>
          <span className="track">
            {baseline && <i className="ghost" style={{ width: `${baseline[k] * 100}%` }} />}
            <i className="fill" style={{ width: `${probes[k] * 100}%` }} />
            {k === highlight && <i className="need" style={{ left: `${GATE_SIGN_MIN * 100}%` }} title="The gate needs 0.80 here" />}
          </span>
          <span className="barvalue">{probes[k].toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function NoiseBench(props: { clip: string; baseline: Probes; highlight?: ProbeKey | null; hasNoise: boolean; title: string; note?: string }) {
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState<{ probes: Probes; clip: string; ms: number; level: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  async function apply(next: number) {
    const ticket = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const r = await probeNoise(props.clip, next);
      if (ticket === latest.current) setHeard({ probes: r.probes, clip: r.clip, ms: r.probe_ms, level: r.level });
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
      <ProbeBars probes={probes} highlight={props.highlight} baseline={heard && heard.level > 0 ? props.baseline : undefined} />
      <div className="noise">
        <label htmlFor="noise-level">Room noise mixed in: {level}%</label>
        <input
          id="noise-level"
          type="range"
          min={0}
          max={100}
          step={10}
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
        {heard && heard.level > 0 && <audio controls src={clipUrl(heard.clip)} />}
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
      setNoiseMsg(`Room noise saved, ${r.seconds} seconds.`);
      onNoise();
    } catch (e) {
      setNoiseMsg((e as Error).message);
    }
  }

  return (
    <section className="live">
      <h2>Act a patient. Say you are fine.</h2>
      <p className="lede">
        Pick something to hide: short of breath, in pain, or coughing. Deny it in words for 10 to 15 seconds. The page shows only what the model observed, never what to do.
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
        <label htmlFor="noise-upload">Room noise recording: {health?.noise ?? "none yet"}</label>
        <input id="noise-upload" type="file" accept="audio/*,video/*" onChange={(e) => uploadNoise(e.target.files?.[0])} />
        {noiseMsg && <span className="muted">{noiseMsg}</span>}
      </div>
    </section>
  );
}
