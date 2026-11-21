import { useEffect, useState } from "react";

type Health = { ok: boolean; hasKey: boolean };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  return (
    <main>
      <h1>Patient Engine</h1>
      <p className="tagline">An exam for clinical AI's senses. Station 1: Listening.</p>
      <p className="notice">Every patient is synthetic. This tests the AI. It is not medical advice.</p>
      <p className="status">
        Server: {error ? `unreachable (${error})` : health ? "connected" : "checking"}
        {health ? `, API key ${health.hasKey ? "loaded" : "missing"}` : ""}
      </p>
    </main>
  );
}
