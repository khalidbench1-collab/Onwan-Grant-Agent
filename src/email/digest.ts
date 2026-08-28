import type { Ranked } from "../agent/rank.js";
import type { Rejection } from "../schema.js";

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}`;
}

/**
 * The digest shows its working. Each entry carries the three sub-scores that
 * produced its position, so the reader can disagree with the ranking instead of
 * having to trust it — and every entry ends at a link they can open themselves.
 */
export function renderDigest(ranked: Ranked[], rejections: Rejection[], today: string): string {
  const entries = ranked
    .map(({ opportunity: o, score }, i) => {
      const flag = score.urgentButHeavy
        ? `<div style="background:#F6E9DF;border-left:3px solid #B4531F;padding:8px 12px;margin:10px 0;font-size:13px;color:#3A423D">
             <b>Urgent but heavy.</b> Closing soon, and the application is not a quick one — decide today whether it is realistic.
           </div>`
        : "";

      const notes = score.notes.length
        ? `<p style="margin:8px 0 0;font-size:13px;color:#6B726D">${escape(score.notes.join(" · "))}</p>`
        : "";

      return `
      <tr><td style="padding:22px 0;border-bottom:1px solid #DDDCD4">
        <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;color:#6B726D">
          ${String(i + 1).padStart(2, "0")} · SCORE ${pct(score.total)}
        </div>
        <h2 style="margin:6px 0 2px;font-size:18px;color:#161A18">${escape(o.programme)}</h2>
        <div style="font-size:14px;color:#1B5E4A;margin-bottom:10px">${escape(o.organisation)}</div>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#3A423D">${escape(o.summary)}</p>
        ${flag}
        <table style="font-size:13px;color:#3A423D;border-collapse:collapse">
          <tr><td style="padding:2px 14px 2px 0;color:#6B726D">Amount</td><td>${escape(o.amount.raw)}</td></tr>
          <tr><td style="padding:2px 14px 2px 0;color:#6B726D">Deadline</td><td><b>${escape(o.deadline.raw)}</b></td></tr>
          <tr><td style="padding:2px 14px 2px 0;color:#6B726D">Eligibility</td><td>${escape(o.eligibility)}</td></tr>
          <tr><td style="padding:2px 14px 2px 0;color:#6B726D">You must submit</td><td>${escape(o.requirements.join(", ") || "not stated")}</td></tr>
        </table>
        <p style="margin:10px 0 0;font-family:ui-monospace,monospace;font-size:11px;color:#6B726D">
          amount ${pct(score.amount)} · feasibility ${pct(score.feasibility)} · urgency ${pct(score.urgency)}
        </p>
        ${notes}
        <p style="margin:10px 0 0"><a href="${escape(o.sourceUrl)}" style="color:#1B5E4A;font-size:13px">Open the call →</a></p>
      </td></tr>`;
    })
    .join("");

  const dropped = rejections.length
    ? `<p style="margin:24px 0 0;font-size:12px;color:#6B726D;line-height:1.7">
         ${rejections.length} candidate${rejections.length === 1 ? "" : "s"} did not make it:<br>
         ${rejections
           .map((r) => `· ${escape(r.programme)} — ${escape(r.reason)}`)
           .join("<br>")}
       </p>`
    : "";

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F6F5F1;font-family:-apple-system,Segoe UI,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;padding:32px">
    <div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;color:#6B726D">ONWAN GRANTS · ${escape(today)}</div>
    <h1 style="font-size:26px;margin:8px 0 6px;color:#161A18">${ranked.length} open call${ranked.length === 1 ? "" : "s"} worth your time</h1>
    <p style="font-size:14px;color:#3A423D;margin:0 0 8px">Every deadline below was re-checked against its own source page before this email was sent. Ranked on amount, how feasible the application is, and how soon it closes.</p>
    <table style="width:100%;border-collapse:collapse">${entries}</table>
    ${dropped}
  </div></body></html>`;
}
