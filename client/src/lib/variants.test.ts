import { describe, expect, it } from "vitest";
import { formatVariantLabel, parseVariants } from "./variants";

describe("menu variant helpers", () => {
  it("normalizes a comma string: trims, drops empties, dedupes case-insensitively", () => {
    expect(parseVariants("Fried, steamed, Fried,, ")).toEqual(["Fried", "steamed"]);
  });

  it("formats the cart label as Name (Choice)", () => {
    expect(formatVariantLabel("Siomai", "Fried")).toBe("Siomai (Fried)");
  });

  it("keeps a parens option intact", () => {
    expect(parseVariants("Cheese (Extra), BBQ")).toEqual(["Cheese (Extra)", "BBQ"]);
  });

  it("returns [] for blanks only", () => {
    expect(parseVariants(", , ")).toEqual([]);
  });

  it("returns the bare name when no variant is chosen", () => {
    expect(formatVariantLabel("Siomai", null)).toBe("Siomai");
  });
});
