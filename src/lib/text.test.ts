import { describe, expect, it } from "vitest";
import { foldFinnish, normalizeQuery } from "./text";

describe("foldFinnish", () => {
  // The whole point: people type "leipa" and mean "leipä".
  it("folds the Finnish vowels", () => {
    expect(foldFinnish("Leipä")).toBe("leipa");
    expect(foldFinnish("Hyvä Apaja")).toBe("hyva apaja");
    expect(foldFinnish("Pöytä")).toBe("poyta");
    expect(foldFinnish("Råg")).toBe("rag");
  });

  it("lowercases", () => {
    expect(foldFinnish("PIRKKA")).toBe("pirkka");
  });

  it("leaves plain ascii untouched", () => {
    expect(foldFinnish("maito 1l")).toBe("maito 1l");
  });

  it("is idempotent", () => {
    expect(foldFinnish(foldFinnish("Säilykkeet"))).toBe(foldFinnish("Säilykkeet"));
  });

  it("keeps digits and punctuation, which carry pack sizes", () => {
    expect(foldFinnish("Pirkka 0,5 l / 2 kpl")).toBe("pirkka 0,5 l / 2 kpl");
  });
});

describe("normalizeQuery", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeQuery("  ruis   leipä ")).toBe("ruis leipa");
  });

  it("matches what is stored, so an umlaut-free query still finds the product", () => {
    expect(normalizeQuery("LEIPÄ")).toBe(foldFinnish("Leipä"));
    expect(normalizeQuery("leipa")).toBe(foldFinnish("Leipä"));
  });
});
