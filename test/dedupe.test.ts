import { describe, it, expect } from "vitest";
import {
  fingerprint,
  orgKey,
  programmeTokens,
  looksLikeSameProgramme,
} from "../src/store/firestore.js";
import type { Opportunity } from "../src/schema.js";

function make(organisation: string, programme: string): Opportunity {
  return { organisation, programme } as Opportunity;
}

/*
 * Every pair below is a real pair observed across two live runs one day apart.
 * The old order-sensitive hash treated all three as new calls, so the second
 * digest repeated calls the first had already sent.
 */

describe("fingerprint survives the way a model rephrases a name", () => {
  it("ignores a year appended on the second run", () => {
    expect(fingerprint(make("Netzwerk Recherche e.V.", "Fellowship Lokale Recherche"))).toBe(
      fingerprint(make("Netzwerk Recherche e.V.", "Fellowship Lokale Recherche 2026/2027")),
    );
  });

  it("ignores the order of a list inside the programme name", () => {
    const a = make(
      "Netzwerk Recherche e.V.",
      "NR-Recherche-Stipendien (NR/Olin-Stipendium, NR/Ecosia-Stipendium, NR-Stipendium)",
    );
    const b = make(
      "Netzwerk Recherche e.V.",
      "Recherche-Stipendien (NR-Stipendium / NR/Olin-Stipendium / NR/Ecosia-Stipendium)",
    );
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("ignores where the legal form sits in the organisation name", () => {
    expect(orgKey("Internationale Journalisten-Programme e.V. (IJP)")).toBe(
      orgKey("Internationale Journalisten-Programme (IJP) e.V."),
    );
  });

  it("still separates two genuinely different calls from one funder", () => {
    const a = make("Journalismfund Europe", "European Cross-Border Grants");
    const b = make("Journalismfund Europe", "The Invisible Life Grant");
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("does not fold a plural into its singular", () => {
    // "Rainforest Reporting Grant" and "Global Reporting Grants" are different
    // programmes. Stemming would merge them and silently drop a real call.
    const a = make("Pulitzer Center on Crisis Reporting", "Rainforest Reporting Grant");
    const b = make("Pulitzer Center on Crisis Reporting", "Global Reporting Grants");
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("keeps normalising case and punctuation, as it always did", () => {
    expect(fingerprint(make("Example Foundation", "Reporting Grant"))).toBe(
      fingerprint(make("example  foundation", "reporting–grant!")),
    );
  });
});

describe("looksLikeSameProgramme", () => {
  const same = (a: string, b: string) =>
    looksLikeSameProgramme(programmeTokens(a), programmeTokens(b));

  it("matches when one name drops a word from the other", () => {
    expect(same("Deutsch-Nordeuropäisches Journalistenprogramm", "Deutsch-Nordeuropäisches Programm")).toBe(true);
  });

  it("does not match two different programmes from the same funder", () => {
    expect(same("Rainforest Reporting Grant", "Global Reporting Grants")).toBe(false);
    expect(same("European Cross-Border Grants", "Grants for Grantees' Professional Development")).toBe(false);
  });

  it("refuses to match on a single shared word", () => {
    expect(same("Fellowship", "Fellowship Lokale Recherche Investigativ")).toBe(false);
  });

  it("handles an empty name without matching everything", () => {
    expect(same("", "Anything At All")).toBe(false);
  });
});
