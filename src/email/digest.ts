import type { Ranked } from "../agent/rank.js";
import type { Opportunity, Rejection } from "../schema.js";

/**
 * The digest is a newsletter, not a search-result dump.
 *
 * Two tiers, for one reason: a ten-item list where every item is equally
 * detailed is a list nobody reads. The three best calls get a full brief — the
 * page's own deadline, the field table, the steps to apply, the paperwork as a
 * checklist. Everything else gets one line, so it is still there without
 * competing for attention.
 *
 * What is NOT here is as deliberate as what is. There are no suggested angles,
 * no drafted pitch, no "your unique advantage is". Every sentence below is
 * either quoted from the funder's own page or computed by this codebase. A
 * digest that mixed sourced facts with generated advice would need the reader
 * to sort one from the other, and the entire point of the verify stage is that
 * they should never have to.
 *
 * Inline styles and table layout throughout: Gmail strips <style> blocks and
 * has no flexbox, so anything cleverer renders as a broken column there.
 */

const C = {
  ground: "#F6F5F1",
  surface: "#FFFFFF",
  ink: "#161A18",
  soft: "#3A423D",
  muted: "#6B726D",
  rule: "#DDDCD4",
  accent: "#1B5E4A",
  signal: "#B4531F",
  signalSoft: "#F6E9DF",
  banner: "#1F2A25",
} as const;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace";

/** How many opportunities get the full brief treatment. */
const BRIEF_COUNT = 3;

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}`;
}

/**
 * A row in the field table. Returns "" for anything the source did not state —
 * an absent row is honest, a row reading "not stated" is clutter repeated on
 * every card.
 */
function field(label: string, value: string | null | undefined, mono = false): string {
  if (!value) return "";
  return `<tr>
    <td style="padding:9px 16px 9px 0;border-bottom:1px solid ${C.rule};font:600 10.5px ${SANS};letter-spacing:.1em;text-transform:uppercase;color:${C.muted};white-space:nowrap;vertical-align:top">${escape(label)}</td>
    <td style="padding:9px 0;border-bottom:1px solid ${C.rule};font:${mono ? `12px ${MONO}` : `13.5px ${SANS}`};color:${C.soft};line-height:1.5">${value}</td>
  </tr>`;
}

function link(url: string, text?: string): string {
  return `<a href="${escape(url)}" style="color:${C.accent};word-break:break-all">${escape(text ?? url)}</a>`;
}

/**
 * The deadline banner leads every brief, because it is the one field that can
 * make all the others irrelevant.
 */
function banner(o: Opportunity): string {
  const note = o.deadline.iso
    ? "Verified against the funder's own page before this email was sent."
    : "No fixed calendar date on the page — treat the wording, not a date, as the rule.";
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:14px 0 18px">
    <tr><td style="background:${C.banner};padding:13px 16px">
      <div style="font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#8FBFA9">Deadline</div>
      <div style="font:600 16px ${SANS};color:#FFFFFF;margin-top:3px">${escape(o.deadline.raw)}</div>
      <div style="font:12px ${SANS};color:#A9BDB4;margin-top:5px">${note}</div>
    </td></tr>
  </table>`;
}

/** Numbered steps, quoted from the call. Absent when the page gave none. */
function howToApply(o: Opportunity): string {
  if (o.howToApply.length === 0) return "";
  const steps = o.howToApply
    .map(
      (step, i) =>
        `<tr>
           <td style="padding:3px 10px 3px 0;font:600 12px ${MONO};color:${C.signal};vertical-align:top">${i + 1}.</td>
           <td style="padding:3px 0;font:13.5px ${SANS};color:${C.soft};line-height:1.55">${escape(step)}</td>
         </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:18px 0 0">
    <tr><td style="background:${C.signalSoft};border-left:3px solid ${C.signal};padding:14px 16px">
      <div style="font:600 10.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.signal};margin-bottom:9px">How to apply</div>
      <table role="presentation" style="border-collapse:collapse">${steps}</table>
      <div style="font:12px ${SANS};color:${C.muted};margin-top:10px">Quoted from the call's own instructions.</div>
    </td></tr>
  </table>`;
}

/** The paperwork, as something you can actually tick off. */
function checklist(o: Opportunity): string {
  if (o.requirements.length === 0) return "";
  const items = o.requirements
    .map(
      (r) =>
        `<tr>
           <td style="padding:4px 9px 4px 0;font:14px ${SANS};color:${C.muted};vertical-align:top">&#9744;</td>
           <td style="padding:4px 0;font:13.5px ${SANS};color:${C.soft};line-height:1.5">${escape(r)}</td>
         </tr>`,
    )
    .join("");
  return `<div style="margin:18px 0 0">
    <div style="font:600 10.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.accent};padding-bottom:7px;border-bottom:1px solid ${C.rule};margin-bottom:8px">What you must prepare</div>
    <table role="presentation" style="border-collapse:collapse">${items}</table>
  </div>`;
}

function scoreBar(score: Ranked["score"]): string {
  const cell = (label: string, v: number) =>
    `<td style="padding:0 14px 0 0;font:11px ${MONO};color:${C.muted};white-space:nowrap">${label} ${pct(v)}</td>`;
  const notes = score.notes.length
    ? `<div style="font:12px ${SANS};color:${C.muted};margin-top:6px">${escape(score.notes.join(" · "))}</div>`
    : "";
  return `<div style="margin:16px 0 0;padding-top:12px;border-top:1px solid ${C.rule}">
    <table role="presentation" style="border-collapse:collapse"><tr>${cell("amount", score.amount)}${cell("feasibility", score.feasibility)}${cell("urgency", score.urgency)}</tr></table>
    ${notes}
    <div style="font:11.5px ${SANS};color:${C.muted};margin-top:6px">Computed, not guessed — the same three weights for every call, so you can disagree with the order.</div>
  </div>`;
}

function urgentFlag(score: Ranked["score"]): string {
  if (!score.urgentButHeavy) return "";
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:14px 0 0">
    <tr><td style="background:${C.signalSoft};border-left:3px solid ${C.signal};padding:11px 14px;font:13px ${SANS};color:${C.soft};line-height:1.55">
      <b style="color:${C.ink}">Urgent, but heavy.</b> This closes soon and the application is not a quick one. Decide today whether it is realistic — it is here rather than buried, but it is not a safe bet.
    </td></tr>
  </table>`;
}

/** The full treatment, for the three best calls. */
function brief({ opportunity: o, score }: Ranked, index: number): string {
  return `<tr><td style="padding:0 0 12px">
    <table role="presentation" width="100%" style="border-collapse:collapse;background:${C.surface};border:1px solid ${C.rule}">
      <tr><td style="padding:24px 26px 26px">

        <div style="font:11px ${MONO};letter-spacing:.1em;color:${C.muted}">${String(index + 1).padStart(2, "0")} &middot; SCORE ${pct(score.total)}</div>
        <h2 style="margin:7px 0 3px;font:600 20px ${SANS};color:${C.ink};line-height:1.25">${escape(o.programme)}</h2>
        <div style="font:italic 13.5px ${SANS};color:${C.accent}">${escape(o.organisation)}</div>

        ${banner(o)}

        <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid ${C.rule}">
          ${field("Official link", link(o.sourceUrl), true)}
          ${field("Apply via", o.applyUrl ? link(o.applyUrl) : null, true)}
          ${field("Amount", `<b style="color:${C.ink}">${escape(o.amount.raw)}</b>`)}
          ${field("Duration", o.duration ? escape(o.duration) : null)}
          ${field("Eligibility", escape(o.eligibility))}
          ${field("Language", o.language ? escape(o.language) : null)}
          ${field("Score", `${pct(score.total)} out of 100`)}
        </table>

        <div style="margin:20px 0 0">
          <div style="font:600 10.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.accent};padding-bottom:7px;border-bottom:1px solid ${C.rule};margin-bottom:9px">What this opportunity is</div>
          <p style="margin:0;font:14px ${SANS};color:${C.soft};line-height:1.65">${escape(o.summary)}</p>
        </div>

        ${urgentFlag(score)}
        ${howToApply(o)}
        ${checklist(o)}
        ${scoreBar(score)}

      </td></tr>
    </table>
  </td></tr>`;
}

/** One line each, for everything past the top three. */
function compact({ opportunity: o, score }: Ranked, index: number): string {
  return `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.rule}">
    <table role="presentation" width="100%" style="border-collapse:collapse"><tr>
      <td style="font:11px ${MONO};color:${C.muted};width:34px;vertical-align:top;padding-top:3px">${String(index + 1).padStart(2, "0")}</td>
      <td>
        <a href="${escape(o.sourceUrl)}" style="font:600 15px ${SANS};color:${C.ink};text-decoration:none">${escape(o.programme)}</a>
        <div style="font:13px ${SANS};color:${C.accent};margin-top:2px">${escape(o.organisation)}</div>
        <div style="font:12.5px ${SANS};color:${C.muted};margin-top:4px">${escape(o.deadline.raw)} &middot; ${escape(o.amount.raw)} &middot; score ${pct(score.total)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}

export function renderDigest(ranked: Ranked[], rejections: Rejection[], today: string): string {
  const briefs = ranked.slice(0, BRIEF_COUNT);
  const rest = ranked.slice(BRIEF_COUNT);

  const briefHtml = briefs.map((r, i) => brief(r, i)).join("");

  const restHtml = rest.length
    ? `<tr><td style="padding:26px 0 0">
         <div style="font:600 10.5px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.accent};padding-bottom:9px;border-bottom:2px solid ${C.ink}">Also open</div>
         <table role="presentation" width="100%" style="border-collapse:collapse">${rest.map((r, i) => compact(r, i + BRIEF_COUNT)).join("")}</table>
       </td></tr>`
    : "";

  const empty = ranked.length
    ? ""
    : `<tr><td style="padding:26px 0;font:14px ${SANS};color:${C.muted};line-height:1.65">
         Nothing new cleared verification this week. That is a normal outcome rather than a failure — every candidate found was checked against its own page, and none could be confirmed as open.
       </td></tr>`;

  const dropped = rejections.length
    ? `<tr><td style="padding:26px 0 0">
         <div style="font:600 10.5px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.muted};padding-bottom:9px;border-bottom:1px solid ${C.rule}">Checked and dropped &middot; ${rejections.length}</div>
         <table role="presentation" width="100%" style="border-collapse:collapse">${rejections
           .map(
             (r) =>
               `<tr><td style="padding:8px 0;font:12.5px ${SANS};color:${C.muted};line-height:1.55;border-bottom:1px solid ${C.rule}"><b style="color:${C.soft};font-weight:600">${escape(r.programme)}</b> &mdash; ${escape(r.reason)}</td></tr>`,
           )
           .join("")}</table>
         <div style="font:12px ${SANS};color:${C.muted};margin-top:10px;line-height:1.6">These were found and then rejected. A week where nothing is dropped means the checking has stopped working.</div>
       </td></tr>`
    : "";

  const count = ranked.length;
  const headline =
    count === 0
      ? "No confirmed open calls this week"
      : `${count} open call${count === 1 ? "" : "s"} worth your time`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.ground};-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" style="border-collapse:collapse;background:${C.ground}">
<tr><td align="center" style="padding:28px 14px 46px">
<table role="presentation" width="640" style="width:100%;max-width:640px;border-collapse:collapse">

  <tr><td style="padding:0 0 18px">
    <table role="presentation" width="100%" style="border-collapse:collapse;border-bottom:2px solid ${C.ink}">
      <tr><td style="padding:0 0 14px">
        <div style="font:600 11px ${MONO};letter-spacing:.18em;color:${C.muted}">ONWAN GRANTS &middot; ${escape(today)}</div>
        <h1 style="margin:9px 0 0;font:600 27px ${SANS};color:${C.ink};line-height:1.2">${escape(headline)}</h1>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:0 0 22px;font:14px ${SANS};color:${C.soft};line-height:1.65">
    Every deadline below was re-read on the funder's own page before this email was sent. Anything that could not be confirmed was dropped, and it is listed at the bottom with the reason.
    ${count > BRIEF_COUNT ? `The top ${BRIEF_COUNT} are written up in full; the rest are one line each.` : ""}
  </td></tr>

  ${empty}
  <tr><td><table role="presentation" width="100%" style="border-collapse:collapse">${briefHtml}</table></td></tr>
  ${restHtml}
  ${dropped}

  <tr><td style="padding:30px 0 0;border-top:2px solid ${C.ink}">
    <div style="font:11px ${MONO};letter-spacing:.08em;color:${C.muted};line-height:1.8">
      Onwan Grants &middot; found, verified and ranked automatically &middot; ${escape(today)}<br>
      No angles, no drafted pitches. Everything above is quoted from a source page or computed from it.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}
