import { describe, expect, it } from "vitest";
import { sortCategories } from "./sortCategories";
import type { Category } from "../api/menu";

describe("sortCategories", () => {
  it("orders by sort, then name", () => {
    const input: Category[] = [
      { id: 2, name: "Non-Coffee", sort: 2 },
      { id: 1, name: "Espresso", sort: 1 },
      { id: 3, name: "A Brew", sort: 1 },
    ];
    expect(sortCategories(input).map((c) => c.name)).toEqual([
      "A Brew",
      "Espresso",
      "Non-Coffee",
    ]);
  });

  it("does not mutate the input", () => {
    const input: Category[] = [{ id: 1, name: "Espresso", sort: 1 }];
    sortCategories(input);
    expect(input).toHaveLength(1);
  });
});
