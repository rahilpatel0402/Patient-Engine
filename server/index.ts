import express from "express";
import { PORT, hasApiKey } from "./env.ts";

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: hasApiKey() });
});

app.listen(PORT, () => {
  console.log(`Patient Engine server on http://localhost:${PORT}`);
});
