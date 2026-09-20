import { describe, expect, it } from "vitest";
import {
  generateShareToken,
  isValidShareToken,
  normalizeShareToken,
  uuidv7,
  uuidv7Time,
} from "./ids";

describe("uuidv7", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("produces a well-formed v7 uuid with the right variant bits", () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidv7()).toMatch(UUID_RE);
    }
  });

  it("embeds the supplied timestamp", () => {
    const at = Date.UTC(2026, 8, 20, 12, 0, 0);
    expect(uuidv7Time(uuidv7(at))).toBe(at);
  });

  it("is unique across many draws", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7()));
    expect(ids.size).toBe(5000);
  });

  // The whole reason for choosing v7: insertion order without a sequence.
  it("sorts lexicographically in creation order", () => {
    const base = Date.UTC(2026, 0, 1);
    const ids = [0, 1, 2, 3, 4].map((offset) => uuidv7(base + offset * 1000));
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("generateShareToken", () => {
  it("has the requested length and stays in the alphabet", () => {
    const token = generateShareToken();
    expect(token).toHaveLength(22);
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it("omits the characters that get misread", () => {
    const sample = Array.from({ length: 200 }, () => generateShareToken()).join("");
    for (const char of ["I", "L", "O", "U"]) {
      expect(sample).not.toContain(char);
    }
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateShareToken()));
    expect(tokens.size).toBe(2000);
  });

  it("uses the whole alphabet rather than a biased subset", () => {
    const sample = Array.from({ length: 500 }, () => generateShareToken()).join("");
    const distinct = new Set(sample).size;
    expect(distinct).toBe(32);
  });
});

describe("isValidShareToken", () => {
  it("accepts a generated token", () => {
    expect(isValidShareToken(generateShareToken())).toBe(true);
  });

  it("rejects wrong lengths, wrong alphabet and injection attempts", () => {
    expect(isValidShareToken("")).toBe(false);
    expect(isValidShareToken("SHORT")).toBe(false);
    expect(isValidShareToken("a".repeat(22))).toBe(false);
    expect(isValidShareToken("ABCDEFGHJKMNPQRSTVWXY!")).toBe(false);
    expect(isValidShareToken("' OR 1=1--            ")).toBe(false);
  });
});

describe("normalizeShareToken", () => {
  it("repairs the characters people typically mistype", () => {
    expect(normalizeShareToken("il0o")).toBe("1100");
    expect(normalizeShareToken("u")).toBe("V");
  });

  it("strips whitespace and punctuation from a pasted link fragment", () => {
    expect(normalizeShareToken("  ABC-DEF ")).toBe("ABCDEF");
  });
});
