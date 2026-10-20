import { describe, expect, it } from "vitest";
import { canonicalUnit, unitLabel, unitOptions } from "./units";

const STANDARD = [
  "g",
  "kg",
  "ml",
  "L",
  "pack",
  "bottle",
  "can",
  "scoop",
  "pc",
  "tbsp",
  "tsp",
];

describe("canonicalUnit", () => {
  it("normalizes spelled-out and legacy units to the standard short form", () => {
    expect(canonicalUnit("grams")).toBe("g");
    expect(canonicalUnit(" Gram ")).toBe("g");
    expect(canonicalUnit(" ML ")).toBe("ml");
    expect(canonicalUnit("liter")).toBe("L");
    expect(canonicalUnit("litres")).toBe("L");
    expect(canonicalUnit("Pack")).toBe("pack");
    expect(canonicalUnit("btl")).toBe("bottle");
    expect(canonicalUnit("scoops")).toBe("scoop");
    expect(canonicalUnit("Tbsp")).toBe("tbsp");
    expect(canonicalUnit("milliliters")).toBe("ml");
  });

  it("keeps unknown units as typed and treats null/blank as no unit", () => {
    expect(canonicalUnit("3333")).toBe("3333");
    expect(canonicalUnit("")).toBe("");
    expect(canonicalUnit("   ")).toBe("");
    expect(canonicalUnit(null)).toBe("");
    expect(canonicalUnit(undefined)).toBe("");
  });
});

describe("unitOptions", () => {
  it("lists every standard unit value", () => {
    expect(unitOptions()).toEqual(STANDARD);
  });

  it("appends a non-standard current value so edits never drop it", () => {
    expect(unitOptions("3333")).toEqual([...STANDARD, "3333"]);
  });

  it("does not duplicate a current value that is already standard", () => {
    expect(unitOptions("pack")).toEqual(STANDARD);
    expect(unitOptions("g")).toEqual(STANDARD);
  });

  it("ignores blank current values", () => {
    expect(unitOptions("")).toEqual(STANDARD);
    expect(unitOptions(null)).toEqual(STANDARD);
  });
});

describe("unitLabel", () => {
  it("spells out the standard units the way the pickers show them", () => {
    expect(unitLabel("g")).toBe("g (grams)");
    expect(unitLabel("kg")).toBe("kg (kilograms)");
    expect(unitLabel("ml")).toBe("ml (milliliters)");
    expect(unitLabel("L")).toBe("L (liters)");
    expect(unitLabel("pack")).toBe("pack");
    expect(unitLabel("bottle")).toBe("bottle");
    expect(unitLabel("pc")).toBe("pc (pieces)");
  });

  it("labels unknown values as themselves", () => {
    expect(unitLabel("3333")).toBe("3333");
    expect(unitLabel("scoop")).toBe("scoop");
  });
});
