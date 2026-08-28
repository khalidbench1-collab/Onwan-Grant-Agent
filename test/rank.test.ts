import { describe, it, expect } from "vitest";
import { scoreAmount, scoreUrgency, scoreFeasibility, rank } from "../src/agent/rank.js";
import { fingerprint } from "../src/store/firestore.js";
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
    ...over,
  } as Opportunity;
}

const TODAY = new Date("2026-08-28T12:00:00Z");

describe("scoreAmount", () => {
  it("rises with the award but not linearly", () => {
    const small = scoreAmount(make({ amount: { value: 1_000, currency: "EUR", raw: "€1,000" } }));
    const large = scoreAmount(make({ amount: { value: 40_000, currency: "EUR", raw: "€40,000" } }));
    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeLessThan(4);
  });

  it("gives an unstated amount a low score, not zero", () => {
    const score = scoreAmount(make({ amount: { value: null, currency: null, raw: "varies" } }));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });
});

describe("scoreUrgency", () => {
  it("peaks inside a week and decays with distance", () => {
    expect(scoreUrgency(make({ deadline: { iso: "2026-09-02", raw: "" } }), TODAY)).toBe(1);
    expect(
      scoreUrgency(make({ deadline: { iso: "2026-12-20", raw: "" } }), TODAY),
    ).toBeLessThan(0.5);
  });

  it("scores a closed call at zero and a rolling call mid-scale", () => {
    expect(scoreUrgency(make({ deadline: { iso: "2026-08-01", raw: "" } }), TODAY)).toBe(0);
    expect(scoreUrgency(make({ deadline: { iso: null, raw: "rolling" } }), TODAY)).toBe(0.5);
  });
});

describe("scoreFeasibility", () => {
  it("scores a pitch-and-CV application highly", () => {
    expect(scoreFeasibility(make({ requirements: ["pitch", "CV"] }))).toBeGreaterThan(0.7);
  });

  it("penalises reference letters and a fiscal sponsor", () => {
    const heavy = make({
      requirements: [
        "detailed budget",
        "two letters of reference",
        "fiscal sponsor",
        "work samples",
      ],
    });
    expect(scoreFeasibility(heavy)).toBeLessThan(0.4);
  });

  it("stays inside 0..1 when nothing is stated", () => {
    const score = scoreFeasibility(make({ requirements: [] }));
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("rank", () => {
  it("flags an imminent deadline on a heavy application rather than promoting it", () => {
    const heavyAndUrgent = make({
      programme: "Heavy Fellowship",
      deadline: { iso: "2026-08-30", raw: "30 August 2026" },
      requirements: ["fiscal sponsor", "three letters of reference", "detailed budget", "work samples"],
    });
    const [top] = rank([heavyAndUrgent], TODAY);
    expect(top?.score.urgentButHeavy).toBe(true);
  });

  it("sorts by total score", () => {
    const ranked = rank([make({ amount: { value: 2_000, currency: "EUR", raw: "€2,000" } }), make()], TODAY);
    expect(ranked[0]!.score.total).toBeGreaterThanOrEqual(ranked[1]!.score.total);
  });
});

describe("fingerprint", () => {
  it("treats the same call from different sources as one", () => {
    expect(fingerprint({ organisation: "IJ4EU", programme: "Investigation Grant" })).toBe(
      fingerprint({ organisation: "ij4eu", programme: "  investigation  grant " }),
    );
  });

  it("keeps different programmes from the same funder apart", () => {
    expect(fingerprint({ organisation: "IJ4EU", programme: "Investigation Grant" })).not.toBe(
      fingerprint({ organisation: "IJ4EU", programme: "Freelancer Support Scheme" }),
    );
  });
});
