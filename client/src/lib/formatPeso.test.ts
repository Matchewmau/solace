import { describe, expect, it } from "vitest";
import { formatPeso } from "./formatPeso";

describe("formatPeso (whole-peso only)", () => {
  it("formats seed prices as whole pesos with the peso sign", () => {
    expect(formatPeso(7000)).toBe("₱70");
    expect(formatPeso(8000)).toBe("₱80");
    expect(formatPeso(5000)).toBe("₱50");
  });

  it("formats zero", () => {
    expect(formatPeso(0)).toBe("₱0");
  });
});
