import { describe, expect, it } from "vitest";
import { aisleOrderForSlug, DEPARTMENT_NAMES, departmentNameForSlug } from "./aisles";

describe("departments", () => {
  it("names a department from a full category path", () => {
    expect(departmentNameForSlug("maito-juusto-munat-ja-rasvat/ruoka--ja-herkuttelujuustot")).toBe(
      "Maito, juusto, munat ja rasvat",
    );
    expect(departmentNameForSlug("ei-tallaista")).toBeNull();
    expect(departmentNameForSlug(null)).toBeNull();
  });

  // A named department with no place in the walk order would sort last,
  // which is a silent bug rather than a visible one.
  it("gives every named department a position in the walk", () => {
    const unknown = aisleOrderForSlug("ei-tallaista");
    for (const slug of Object.keys(DEPARTMENT_NAMES)) {
      expect(aisleOrderForSlug(slug), slug).toBeLessThan(unknown);
    }
  });
});
