import { randomUUID } from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { runPipeline } from "./pipeline/run.js";
import { recentDigests } from "./store/firestore.js";

const app = express();
app.use(express.json({ limit: "128kb" }));

// Not /healthz: the Google Front End intercepts that path on Cloud Run and
// answers its own 404 before the request ever reaches this container.
app.get("/status", (_req, res) => {
  res.json({ ok: true, service: "onwan-grants", model: config.model });
});

/**
 * A run id supplied by the caller, or null if there was none.
 *
 * Firestore document ids cannot contain "/" and cannot be "." or "..", so the
 * header is checked against an allowlist rather than passed straight through to
 * `claimRun`. Throws on a header that is present but unusable — falling back to
 * a random id would make a replay look like it was deduped when it in fact ran
 * a second time, which is the one thing this header exists to disprove.
 */
function callerRunId(req: express.Request): string | null {
  const raw = req.get("X-Onwan-Run-Id");
  if (!raw) return null;
  const id = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) {
    throw new Error("X-Onwan-Run-Id must be 1-64 chars of [A-Za-z0-9._:-]");
  }
  return id;
}

/**
 * Triggered by Cloud Scheduler, and by hand during the demo.
 *
 * The run id comes from the caller when there is one, so that a Scheduler retry
 * carries the same id and is recognised as the same run. Only if none is given
 * do we mint one.
 *
 * Scheduler wins over the header: a caller-supplied id is namespaced under
 * `manual-`, so replaying one can never claim — and so suppress — the id a
 * scheduled trigger is about to use.
 */
app.post("/run", async (req, res) => {
  if (!config.runKey || req.get("X-Onwan-Run-Key") !== config.runKey) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return;
  }

  let supplied: string | null;
  try {
    supplied = callerRunId(req);
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
    return;
  }

  const runId =
    req.get("X-CloudScheduler-JobName") && req.get("X-CloudScheduler-ScheduleTime")
      ? `sched-${req.get("X-CloudScheduler-ScheduleTime")}`
      : `manual-${supplied ?? randomUUID().slice(0, 8)}`;

  const outcome = await runPipeline(runId);
  res.status(outcome.status === "failed" ? 500 : 200).json(outcome);
});

/** The hosted URL for the submission, and the run history for the demo. */
app.get("/", async (_req, res) => {
  let digests: Record<string, unknown>[] = [];
  try {
    digests = await recentDigests(10);
  } catch (error) {
    console.error("could not read digests:", (error as Error).message);
  }
  res.type("html").send(renderHistory(digests));
});

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function renderHistory(digests: Record<string, unknown>[]): string {
  const runs = digests
    .map((d) => {
      const entries = (d.entries as Record<string, unknown>[] | undefined) ?? [];
      const rows = entries
        .map(
          (e) =>
            `<li><a href="${esc(e.sourceUrl)}">${esc(e.programme)}</a>
             <span class="m">${esc(e.organisation)} · ${esc(e.deadline)} · ${esc(e.amount)}</span></li>`,
        )
        .join("");
      return `<section>
        <h2>${esc(String(d.sentAt).slice(0, 16).replace("T", " "))} UTC</h2>
        <ul>${rows}</ul>
      </section>`;
    })
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Onwan Grants</title><style>
:root{--ground:#F6F5F1;--surface:#fff;--ink:#161A18;--muted:#6B726D;--rule:#DDDCD4;--accent:#1B5E4A}
@media(prefers-color-scheme:dark){:root{--ground:#101311;--surface:#191E1B;--ink:#E8E9E4;--muted:#8C948D;--rule:#2C332E;--accent:#6FBFA1}}
body{margin:0;padding:3rem 1.5rem;background:var(--ground);color:var(--ink);
font-family:-apple-system,Segoe UI,sans-serif;line-height:1.6}
.w{max-width:42rem;margin:0 auto}
h1{font-size:2rem;margin:0 0 .4rem}
.lede{color:var(--muted);margin:0 0 2.5rem}
section{background:var(--surface);border:1px solid var(--rule);padding:1.25rem;margin-bottom:1rem}
h2{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 .75rem}
ul{margin:0;padding-left:1.1rem}
li{margin-bottom:.6rem}
a{color:var(--accent)}
.m{display:block;font-size:.82rem;color:var(--muted)}
.empty{color:var(--muted)}
</style></head><body><div class="w">
<h1>Onwan Grants</h1>
<p class="lede">An agent that finds funding for journalists, verifies every deadline against its source, and mails a ranked digest. This page is its run history.</p>
${runs || '<p class="empty">No digests yet.</p>'}
</div></body></html>`;
}

app.listen(config.port, "0.0.0.0", () => {
  console.log(`onwan-grants listening on :${config.port}`);
});
