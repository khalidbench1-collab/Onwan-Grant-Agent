import express from "express";
import { config } from "./config.js";

const app = express();
app.use(express.json({ limit: "128kb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "onwan-grants" });
});

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "onwan-grants",
    model: config.model,
    stage: "0 — deployed, pipeline not yet wired",
  });
});

// Bind 0.0.0.0, not localhost: Cloud Run routes to the container's external
// interface, and a server listening only on loopback fails the startup probe.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`onwan-grants listening on :${config.port}`);
});
