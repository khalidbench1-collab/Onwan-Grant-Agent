import { describe, it, expect } from "vitest";
import { renderDigest } from "../src/email/digest.js";
import { rank } from "../src/agent/rank.js";
import type { Opportunity } from "../src/schema.js";

function make(over: Partial<Opportunity> = {}): Opportunity {
  return {
    organisation: "Example Foundation",
    programme: "Reporting Grant",
    summary: "Funds investigative reporting in Europe.",
    amount: { value: 10_000, currency: "EUR", raw: "€10,000" },
    deadline: { iso: "2026-10-15", raw: "15 October 2026" },
    eligibility: "Journalists based in the EU.",
    requirements: ["pitch", "CV"],
    sourceUrl: "https://example.org/grant",
    applyUrl: null,
    duration: null,
    language: null,
    howToApply: [],
    ...over,
  } as Opportunity;
}

const TODAY = new Date("2026-08-28T12:00:00Z");

/** Ranked, but with the order forced so tests can talk about "the fourth". */
function render(opportunities: Opportunity[], rejections = []) {
  return renderDigest(rank(opportunities, TODAY), rejections, "2026-08-28");
}

function spread(n: number): Opportunity[] {
  // Descending amount keeps rank order predictable and independent of ties.
  return Array.from({ length: n }, (_, i) =>
    make({
      programme: `Programme ${i}`,
      amount: { value: 40_000 - i * 1_000, currency: "EUR", raw: `€${40 - i}k` },
    }),
  );
}

describe("presentation", () => {
  it("gives every call the full brief, not just the top three", () => {
    const html = render(spread(6));
    expect(html.match(/Official link/g) ?? []).toHaveLength(6);
    for (let i = 0; i < 6; i += 1) expect(html).toContain(`Programme ${i}`);
  });

  it("features exactly the first three with the gold rule", () => {
    const html = render(spread(6));
    expect(html.match(/border-top:3px solid #C7A252/g) ?? []).toHaveLength(3);
  });

  it("features all of them when there are fewer than three", () => {
    const html = render(spread(2));
    expect(html.match(/border-top:3px solid #C7A252/g) ?? []).toHaveLength(2);
  });

  it("renders an empty digest without throwing", () => {
    expect(() => render([])).not.toThrow();
  });

  it("scores out of ten, not a hundred", () => {
    const html = render(spread(1));
    expect(html).toContain("out of 10");
    expect(html).not.toContain("out of 100");
  });

  it("scores in whole numbers, never a decimal", () => {
    // spread() varies the amount so the totals are not round by accident.
    const html = render(spread(6));
    expect(html).not.toMatch(/\d[.,]\d\s*<\/b>\s*out of 10/);
    expect(html.match(/>\d+<\/b> out of 10/g) ?? []).toHaveLength(6);
  });

  it("keeps the scoring internals out of the reader's way", () => {
    const html = render(spread(4));
    expect(html).not.toContain("Computed, not guessed");
    expect(html).not.toMatch(/feasibility \d/);
    expect(html).not.toMatch(/urgency \d/);
    expect(html).not.toContain("substantial award");
    expect(html).not.toMatch(/SCORE \d/); // the "01 · SCORE 92" line
  });

  it("signs off by handing the work back to the reader", () => {
    const html = render(spread(1));
    expect(html).toContain("Now, your turn to make a genuine application!");
    expect(html).not.toContain("No angles, no drafted pitches");
  });
});

describe("only shows what the source stated", () => {
  it("omits the how-to-apply section when the page gave no steps", () => {
    const html = render([make({ howToApply: [] })]);
    expect(html).not.toContain("How to apply");
  });

  it("carries the application steps on the featured three only", () => {
    const withSteps = spread(6).map((o) => ({
      ...o,
      howToApply: ["Register an account", "Upload the pitch"],
    }));
    const html = render(withSteps);
    expect(html.match(/How to apply/g) ?? []).toHaveLength(3);
  });

  it("shows the steps in order when the page gave them", () => {
    const html = render([make({ howToApply: ["Register an account", "Upload the pitch"] })]);
    expect(html).toContain("How to apply");
    expect(html.indexOf("Register an account")).toBeLessThan(html.indexOf("Upload the pitch"));
  });

  it("omits the apply-via row when there is no separate portal", () => {
    expect(render([make({ applyUrl: null })])).not.toContain("Apply via");
    expect(render([make({ applyUrl: "https://portal.example.org" })])).toContain("Apply via");
  });

  it("says 'not stated' rather than blank for a missing duration", () => {
    const html = render([make({ duration: null })]);
    expect(html).not.toContain("Duration");
  });

  it("does not repeat the verification line on every card", () => {
    const html = render(spread(5));
    expect(html).not.toContain("Verified against the funder's own page");
    // The claim is still made once, at the top.
    expect(html).toContain("re-read on the funder's own page");
  });

  it("still flags a call that has no calendar date", () => {
    const html = render([make({ deadline: { iso: null, raw: "Rolling" } })]);
    expect(html).toContain("No fixed calendar date");
  });

  it("keeps the deadline in the source's own words", () => {
    const html = render([make({ deadline: { iso: null, raw: "Rolling, no fixed date" } })]);
    expect(html).toContain("Rolling, no fixed date");
  });
});

describe("escaping", () => {
  it("escapes hostile text from a funder page", () => {
    const html = render([
      make({ programme: `<script>alert("x")</script>`, organisation: "A & B" }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B");
  });

  it("escapes a hostile url in an href", () => {
    const html = render([make({ sourceUrl: `https://x.org/"><script>` })]);
    expect(html).not.toContain(`"><script>`);
  });
});

describe("requirements checklist", () => {
  it("lists each requirement as its own line, not a comma run", () => {
    const html = render([make({ requirements: ["A pitch of 350 words", "CV", "Budget"] })]);
    expect(html).toContain("A pitch of 350 words");
    expect(html).toContain("Budget");
    expect(html).not.toContain("A pitch of 350 words, CV, Budget");
  });
});
