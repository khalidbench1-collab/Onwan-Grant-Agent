import type { Ranked } from "../agent/rank.js";
import type { Opportunity, Rejection } from "../schema.js";

/**
 * The digest is a newsletter, not a search-result dump.
 *
 * Every call gets the same brief — deadline, field table, what it is, the
 * paperwork as a checklist. The three best are given a richer treatment so the
 * eye lands on them first, and they alone carry the application steps, which
 * are the longest block on a card and would bury the top three if repeated
 * seven times. Nothing else separates them: a reader who disagrees with the
 * ranking still gets every fact about the fourth.
 *
 * The scoring internals are deliberately not shown. The order they produce is
 * useful; the arithmetic behind it is noise in an inbox, and printing three
 * sub-scores next to every entry made the email look like a debug dump.
 *
 * What is NOT here is as deliberate as what is. There are no suggested angles
 * and no drafted pitch. Every sentence below is quoted from the funder's own
 * page or computed by this codebase — the application itself is the reader's to
 * write, which is the last line of the email.
 *
 * Inline styles and table layout throughout: Gmail strips <style> blocks and
 * has no flexbox, so anything cleverer renders as a broken column there.
 */

const C = {
  ground: "#F1EFE9",
  surface: "#FFFFFF",
  ink: "#161A18",
  soft: "#3A423D",
  muted: "#6B726D",
  rule: "#DDDCD4",
  accent: "#1B5E4A",
  accentSoft: "#EDF3F0",
  accentLine: "#C7A252",
  signal: "#B4531F",
  signalSoft: "#F6E9DF",
  banner: "#1F2A25",
  bannerTop: "#164438",
} as const;

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "'Iowan Old Style',Georgia,'Times New Roman',serif";
const MONO = "ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace";

/** How many calls get the richer, top-of-the-list treatment. */
const FEATURED = 3;

/**
 * The most calls one email may carry.
 *
 * Seven is a reading limit, not a technical one. Anything past it is a list
 * nobody finishes, and an unread digest helps nobody. The cap is applied in the
 * pipeline BEFORE the sent calls are remembered, so what does not make the cut
 * stays unseen and can surface next week rather than being silently lost.
 */
export const MAX_PER_DIGEST = 7;

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/**
 * The ranking, on the scale a reader actually thinks in.
 *
 * Whole numbers only. A decimal implies a precision the weights do not have —
 * 6.5 and 6.4 are not a meaningful distinction, and printing one invites the
 * reader to trust the arithmetic instead of the order.
 */
function outOfTen(total: number): string {
  return String(Math.round(total * 10));
}

/** A row in the field table. Returns "" for anything the source did not state. */
function field(label: string, value: string | null | undefined, mono = false): string {
  if (!value) return "";
  return `<tr>
    <td style="padding:10px 18px 10px 0;border-bottom:1px solid ${C.rule};font:600 10.5px ${SANS};letter-spacing:.1em;text-transform:uppercase;color:${C.muted};white-space:nowrap;vertical-align:top">${escape(label)}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${C.rule};font:${mono ? `12px ${MONO}` : `13.5px ${SANS}`};color:${C.soft};line-height:1.55">${value}</td>
  </tr>`;
}

function link(url: string): string {
  return `<a href="${escape(url)}" style="color:${C.accent};word-break:break-all">${escape(url)}</a>`;
}

function sectionLabel(text: string): string {
  return `<div style="font:600 10.5px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.accent};padding-bottom:7px;border-bottom:1px solid ${C.rule};margin-bottom:9px">${text}</div>`;
}

/**
 * The deadline banner leads every brief, because it is the one field that can
 * make all the others irrelevant. Featured calls get the deeper green.
 */
function banner(o: Opportunity, featured: boolean): string {
  const note = o.deadline.iso
    ? "Verified against the funder's own page before this email was sent."
    : "No fixed calendar date on the page — treat the wording, not a date, as the rule.";
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:16px 0 20px">
    <tr><td style="background:${featured ? C.bannerTop : C.banner};padding:14px 18px">
      <div style="font:600 10px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:#8FBFA9">Deadline</div>
      <div style="font:600 17px ${SANS};color:#FFFFFF;margin-top:4px">${escape(o.deadline.raw)}</div>
      <div style="font:12px ${SANS};color:#A9BDB4;margin-top:5px">${note}</div>
    </td></tr>
  </table>`;
}

/**
 * Numbered steps, quoted from the call.
 *
 * Featured calls only. The steps are the longest block on a card, and repeating
 * them seven times buries the three the reader should act on first. Absent too
 * when the page gave no steps.
 */
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
    <tr><td style="background:${C.signalSoft};border-left:3px solid ${C.signal};padding:14px 18px">
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
  return `<div style="margin:20px 0 0">
    ${sectionLabel("What you must prepare")}
    <table role="presentation" style="border-collapse:collapse">${items}</table>
  </div>`;
}

function urgentFlag(score: Ranked["score"]): string {
  if (!score.urgentButHeavy) return "";
  return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:16px 0 0">
    <tr><td style="background:${C.signalSoft};border-left:3px solid ${C.signal};padding:12px 16px;font:13px ${SANS};color:${C.soft};line-height:1.55">
      <b style="color:${C.ink}">Urgent, but heavy.</b> This closes soon and the application is not a quick one. Decide today whether it is realistic.
    </td></tr>
  </table>`;
}

/**
 * One call. `featured` gives the first three a gold rule, a tinted header and
 * the deeper banner — the same information, weighted for the eye.
 */
function card({ opportunity: o, score }: Ranked, featured: boolean): string {
  const head = featured
    ? `<tr><td style="background:${C.accentSoft};padding:22px 26px 18px;border-bottom:1px solid ${C.rule}">
         <h2 style="margin:0 0 4px;font:600 22px ${SERIF};color:${C.ink};line-height:1.25">${escape(o.programme)}</h2>
         <div style="font:italic 14px ${SANS};color:${C.accent}">${escape(o.organisation)}</div>
       </td></tr>`
    : `<tr><td style="padding:22px 26px 0">
         <h2 style="margin:0 0 4px;font:600 19px ${SERIF};color:${C.ink};line-height:1.25">${escape(o.programme)}</h2>
         <div style="font:italic 13.5px ${SANS};color:${C.accent}">${escape(o.organisation)}</div>
       </td></tr>`;

  return `<tr><td style="padding:0 0 14px">
    <table role="presentation" width="100%" style="border-collapse:collapse;background:${C.surface};border:1px solid ${C.rule}${featured ? `;border-top:3px solid ${C.accentLine}` : ""}">
      ${head}
      <tr><td style="padding:${featured ? "20px" : "4px"} 26px 26px">

        ${banner(o, featured)}

        <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid ${C.rule}">
          ${field("Official link", link(o.sourceUrl), true)}
          ${field("Apply via", o.applyUrl ? link(o.applyUrl) : null, true)}
          ${field("Amount", `<b style="color:${C.ink}">${escape(o.amount.raw)}</b>`)}
          ${field("Duration", o.duration ? escape(o.duration) : null)}
          ${field("Eligibility", escape(o.eligibility))}
          ${field("Language", o.language ? escape(o.language) : null)}
          ${field("Score", `<b style="color:${C.ink}">${outOfTen(score.total)}</b> out of 10`)}
        </table>

        <div style="margin:22px 0 0">
          ${sectionLabel("What this opportunity is")}
          <p style="margin:0;font:14px ${SANS};color:${C.soft};line-height:1.65">${escape(o.summary)}</p>
        </div>

        ${urgentFlag(score)}
        ${featured ? howToApply(o) : ""}
        ${checklist(o)}

      </td></tr>
    </table>
  </td></tr>`;
}

export function renderDigest(ranked: Ranked[], rejections: Rejection[], today: string): string {
  const cards = ranked.map((r, i) => card(r, i < FEATURED)).join("");

  const empty = ranked.length
    ? ""
    : `<tr><td style="padding:28px 0;font:14px ${SANS};color:${C.muted};line-height:1.65">
         Nothing new cleared verification this week. That is a normal outcome rather than a failure — every candidate found was checked against its own page, and none could be confirmed as open.
       </td></tr>`;

  const dropped = rejections.length
    ? `<tr><td style="padding:28px 0 0">
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
<tr><td align="center" style="padding:0 0 46px">

<table role="presentation" width="100%" style="border-collapse:collapse;background:${C.bannerTop}">
  <tr><td align="center" style="padding:34px 14px 30px">
    <table role="presentation" width="640" style="width:100%;max-width:640px;border-collapse:collapse">
      <tr><td>
        <div style="font:600 11px ${MONO};letter-spacing:.3em;color:${C.accentLine}">ONWAN GRANTS</div>
        <div style="font:22px ${SERIF};color:#9FD3BC;margin-top:6px;text-align:left">&#1605;&#1606;&#1581; &#1593;&#1606;&#1608;&#1575;&#1606;</div>
        <table role="presentation" style="border-collapse:collapse;margin:16px 0 14px"><tr><td style="width:52px;height:2px;background:${C.accentLine};font-size:0;line-height:0">&nbsp;</td></tr></table>
        <h1 style="margin:0;font:400 30px ${SERIF};color:#FFFFFF;line-height:1.22">${escape(headline)}</h1>
        <div style="font:12px ${MONO};letter-spacing:.12em;color:#8FBFA9;margin-top:10px">${escape(today)}</div>
      </td></tr>
    </table>
  </td></tr>
</table>

<table role="presentation" width="640" style="width:100%;max-width:640px;border-collapse:collapse">

  <tr><td style="padding:26px 0 22px;font:14px ${SANS};color:${C.soft};line-height:1.65">
    Every deadline below was re-read on the funder's own page before this email was sent. Anything that could not be confirmed was dropped, and it is listed at the bottom with the reason.
  </td></tr>

  ${empty}
  <tr><td><table role="presentation" width="100%" style="border-collapse:collapse">${cards}</table></td></tr>
  ${dropped}

  <tr><td style="padding:34px 0 0">
    <table role="presentation" width="100%" style="border-collapse:collapse;border-top:2px solid ${C.ink}">
      <tr><td align="center" style="padding:26px 0 0">
        <div style="font:600 10.5px ${MONO};letter-spacing:.3em;color:${C.muted}">ONWAN GRANTS</div>
        <table role="presentation" style="border-collapse:collapse;margin:14px auto"><tr><td style="width:40px;height:2px;background:${C.accentLine};font-size:0;line-height:0">&nbsp;</td></tr></table>
        <div style="font:italic 17px ${SERIF};color:${C.accent};line-height:1.5">Now, your turn to make a genuine application!</div>
        <div style="font:11px ${MONO};letter-spacing:.08em;color:${C.muted};margin-top:16px">found, verified and ranked automatically &middot; ${escape(today)}</div>
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}
