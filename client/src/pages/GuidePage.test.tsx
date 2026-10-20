import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GuidePage, { filterRecipes, formatLine } from "./GuidePage";
import * as recipesApi from "../api/recipes";
import type { Recipe, RecipeDetail } from "../api/recipes";
import type { Category, MenuItem } from "../api/menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const recipes: Recipe[] = [
  { id: 1, menu_item_id: 11, menu_item_name: "Spanish Latte", steps: "1. Milk\n2. Mix" },
  { id: 2, menu_item_id: 12, menu_item_name: "Dark Mocha", steps: "1. Mocha\n2. Mix" },
  { id: 3, menu_item_id: 13, menu_item_name: "Matcha Latte", steps: "1. Matcha\n2. Mix" },
];

const details: Record<number, RecipeDetail> = {
  1: {
    ...recipes[0],
    lines: [
      { id: 1, ingredient: "Condensed Milk", qty: 40, unit: "ml" },
      { id: 2, ingredient: "Ice", qty: null, unit: null },
    ],
  },
  2: {
    ...recipes[1],
    lines: [{ id: 3, ingredient: "D. Mocha base", qty: 15, unit: "ml" }],
  },
  3: {
    ...recipes[2],
    lines: [{ id: 4, ingredient: "Mat. powder", qty: 15, unit: "g" }],
  },
};

/** Category rows arrive out of order on purpose — sortCategories orders them. */
const categories: Category[] = [
  { id: 2, name: "Matcha", sort: 2 },
  { id: 4, name: "Food", sort: 100 },
  { id: 3, name: "Soda", sort: 3 },
  { id: 1, name: "Coffee", sort: 1 },
];

const menuItems: MenuItem[] = [
  { id: 11, category_id: 1, name: "Spanish Latte", price_cents: 9000, cost_cents: 3000, active: 1, variants: [] },
  { id: 12, category_id: 1, name: "Dark Mocha", price_cents: 8000, cost_cents: 2500, active: 1, variants: [] },
  { id: 13, category_id: 2, name: "Matcha Latte", price_cents: 9000, cost_cents: 3200, active: 1, variants: [] },
  { id: 14, category_id: 1, name: "Cold Brew", price_cents: 7000, cost_cents: 2000, active: 1, variants: [] },
  { id: 15, category_id: 3, name: "Mixed Berries Soda", price_cents: 6000, cost_cents: 1800, active: 1, variants: [] },
  { id: 16, category_id: 4, name: "Fries", price_cents: 5000, cost_cents: 1500, active: 1, variants: [] },
];

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function stubFetch(
  recipeRows: Recipe[] = recipes,
  detailById: Record<number, RecipeDetail> = details,
) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u === "/api/categories") return ok(categories);
    if (u === "/api/menu_items") return ok(menuItems);
    if (u === "/api/recipes") return ok(recipeRows);
    const match = u.match(/^\/api\/recipes\/(\d+)$/);
    if (match) return ok(detailById[Number(match[1])]);
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
}

function renderGuide() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GuidePage />
    </QueryClientProvider>,
  );
}

describe("filterRecipes (pure)", () => {
  it("matches case-insensitive substrings; blank query returns all", () => {
    expect(filterRecipes(recipes, "")).toHaveLength(3);
    expect(filterRecipes(recipes, "latte").map((r) => r.menu_item_name)).toEqual([
      "Spanish Latte",
      "Matcha Latte",
    ]);
    expect(filterRecipes(recipes, "MOCHA").map((r) => r.menu_item_name)).toEqual([
      "Dark Mocha",
    ]);
    expect(filterRecipes(recipes, "zzz")).toHaveLength(0);
  });

  it("filters by category and search together", () => {
    const categoryByMenuItemId = new Map([
      [11, 1],
      [12, 1],
      [13, 2],
    ]);
    expect(
      filterRecipes(recipes, "", 1, categoryByMenuItemId).map((r) => r.menu_item_name),
    ).toEqual(["Spanish Latte", "Dark Mocha"]);
    expect(
      filterRecipes(recipes, "latte", 1, categoryByMenuItemId).map((r) => r.menu_item_name),
    ).toEqual(["Spanish Latte"]);
    expect(
      filterRecipes(recipes, "latte", 2, categoryByMenuItemId).map((r) => r.menu_item_name),
    ).toEqual(["Matcha Latte"]);
    expect(filterRecipes(recipes, "latte", 3, categoryByMenuItemId)).toHaveLength(0);
  });

  it("formats lines with quantities and bare names without", () => {
    expect(
      formatLine({ id: 1, ingredient: "Condensed Milk", qty: 40, unit: "ml" }),
    ).toBe("Condensed Milk — 40 ml");
    expect(formatLine({ id: 2, ingredient: "Ice", qty: null, unit: null })).toBe(
      "Ice",
    );
  });
});

describe("GuidePage with mocked data", () => {
  it("lists drinks and shows the clicked drink's steps + lines in a dialog", async () => {
    stubFetch();
    renderGuide();

    expect(
      await screen.findByRole("button", { name: "Spanish Latte" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Dark Mocha" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Matcha Latte" })).toBeDefined();
    // Clicking opens the modal: steps + measured and unmeasured lines.
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    expect(await screen.findByText("Condensed Milk — 40 ml")).toBeDefined();
    expect(screen.getByText("Ice")).toBeDefined();
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("search filters the drink list case-insensitively", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.change(screen.getByLabelText("Search drinks"), {
      target: { value: "mocha" },
    });
    expect(screen.queryByText("Spanish Latte")).toBeNull();
    expect(screen.queryByText("Matcha Latte")).toBeNull();
    expect(screen.getByRole("button", { name: "Dark Mocha" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dark Mocha" }));
    expect(await screen.findByText("D. Mocha base — 15 ml")).toBeDefined();
  });

  it("shows an empty state when the filter matches nothing", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.change(screen.getByLabelText("Search drinks"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No drinks found")).toBeDefined();
  });

  it("selecting a drink swaps the shown steps + lines", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    expect(await screen.findByText("Condensed Milk — 40 ml")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Matcha Latte" }));
    expect(await screen.findByText("Mat. powder — 15 g")).toBeDefined();
    expect(screen.queryByText("Condensed Milk — 40 ml")).toBeNull();
  });
});

describe("GuidePage recipe modal", () => {
  it("clicking a drink opens a dialog showing its steps + ingredients", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(screen.getByRole("button", { name: "Dark Mocha" }));
    await screen.findByText("D. Mocha base — 15 ml");
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Dark Mocha");
    expect(dialog.textContent).toContain("1. Mocha");
    expect(dialog.textContent).toContain("D. Mocha base — 15 ml");
    // List stays behind the modal.
    expect(screen.getByRole("button", { name: "Spanish Latte" })).toBeDefined();
  });

  it("close button dismisses the dialog back to the list", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(screen.getByRole("button", { name: "Dark Mocha" }));
    await screen.findByRole("dialog");
    await screen.findByText("D. Mocha base — 15 ml");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Spanish Latte" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Dark Mocha" })).toBeDefined();
  });

  it("backdrop click and Escape dismiss the dialog", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(screen.getByRole("button", { name: "Dark Mocha" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dark Mocha" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a second drink's click swaps the dialog content (no stale recipe)", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    await screen.findByText("Condensed Milk — 40 ml");
    const first = await screen.findByRole("dialog");
    expect(first.textContent).toContain("Condensed Milk — 40 ml");

    fireEvent.click(screen.getByRole("button", { name: "Matcha Latte" }));
    await screen.findByText("Mat. powder — 15 g");
    const swapped = await screen.findByRole("dialog");
    expect(swapped.textContent).toContain("Mat. powder — 15 g");
    expect(swapped.textContent).not.toContain("Condensed Milk — 40 ml");
  });
});

describe("GuidePage type filter (Task 8)", () => {
  it("filters drinks by type and search together", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(await screen.findByRole("button", { name: "Coffee" }));
    expect(screen.queryByRole("button", { name: "Matcha Latte" })).toBeNull();
    expect(screen.getByRole("button", { name: "Spanish Latte" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Dark Mocha" })).toBeDefined();

    fireEvent.change(screen.getByLabelText("Search drinks"), {
      target: { value: "latte" },
    });
    expect(screen.getByRole("button", { name: "Spanish Latte" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Matcha Latte" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dark Mocha" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByLabelText("Search drinks"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: "Matcha Latte" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Dark Mocha" })).toBeDefined();
  });

  it("shows All plus each drink type in sort order and never Food", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    const filter = screen.getByRole("group", { name: "Category filter" });
    const labels = within(filter)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(labels).toEqual(["All", "Coffee", "Matcha", "Soda"]);
    expect(within(filter).queryByRole("button", { name: "Food" })).toBeNull();
  });

  it("never lists a Food item even when a recipe references it", async () => {
    const foodRecipe: Recipe = {
      id: 4,
      menu_item_id: 16,
      menu_item_name: "Fries",
      steps: "1. Fry",
    };
    stubFetch([...recipes, foodRecipe], {
      ...details,
      4: { ...foodRecipe, lines: [] },
    });
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    expect(screen.queryByRole("button", { name: "Fries" })).toBeNull();
    expect(screen.getByRole("button", { name: "Matcha Latte" })).toBeDefined();
  });
});

describe("GuidePage toolbar and category rows (Task 22, Task 3)", () => {
  it("puts the category chips and search box inside one toolbar box", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    const filter = screen.getByRole("group", { name: "Category filter" });
    const toolbar = filter.closest("section");
    expect(toolbar).not.toBeNull();
    expect(
      within(toolbar as HTMLElement).getByLabelText("Search drinks"),
    ).toBeDefined();
    // Chips are Buttons that keep aria-pressed selection.
    const pressed = filter.querySelector('[aria-pressed="true"]');
    expect(pressed?.textContent?.trim()).toBe("All");
    fireEvent.click(screen.getByRole("button", { name: "Coffee" }));
    expect(
      screen
        .getByRole("button", { name: "Coffee" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("shows the Solace · Guide label in an Add row", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    expect(screen.getByText("Solace · Guide")).toBeDefined();
    expect(screen.getByRole("button", { name: "Add" })).toBeDefined();
  });

  it("groups recipe rows under sorted category boxes", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    // Coffee and Matcha hold guides; Soda has none, so it renders no box.
    const coffee = screen.getByRole("region", { name: "Coffee" });
    const matcha = screen.getByRole("region", { name: "Matcha" });
    expect(screen.queryByRole("region", { name: "Soda" })).toBeNull();
    expect(
      within(coffee).getByRole("heading", { name: "Coffee" }),
    ).toBeDefined();
    expect(
      within(matcha).getByRole("heading", { name: "Matcha" }),
    ).toBeDefined();
    // Sorted order puts Coffee before Matcha.
    expect(
      coffee.compareDocumentPosition(matcha) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      within(coffee).getByRole("button", { name: "Spanish Latte" }),
    ).toBeDefined();
    expect(
      within(coffee).getByRole("button", { name: "Dark Mocha" }),
    ).toBeDefined();
    expect(
      within(coffee).queryByRole("button", { name: "Matcha Latte" }),
    ).toBeNull();
    expect(
      within(matcha).getByRole("button", { name: "Matcha Latte" }),
    ).toBeDefined();
  });

  it("lays each category out as Menu-style recipe rows with a step hint", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    const coffee = screen.getByRole("region", { name: "Coffee" });
    const list = within(coffee).getByRole("list");
    expect(list.className).toContain("flex-col");
    expect(list.className).toContain("gap-3");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    const row = within(coffee).getByRole("button", { name: "Spanish Latte" });
    expect(row.className).toContain("grid");
    expect(row.className).toContain("text-left");
    expect(row.textContent).toContain("steps");
  });

  it("keeps aria-pressed selection on the active row", async () => {
    stubFetch();
    renderGuide();
    const row = await screen.findByRole("button", { name: "Spanish Latte" });
    expect(row.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(row);
    await screen.findByRole("dialog", { name: "Recipe — Spanish Latte" });
    expect(
      screen
        .getByRole("button", { name: "Spanish Latte" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("GuidePage add edit delete (Task 8)", () => {
  it("add picker offers only drink items without guides", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("dialog", { name: "Add recipe" });

    const picker = screen.getByLabelText("Drink") as HTMLSelectElement;
    const options = Array.from(picker.querySelectorAll("option")).map((option) =>
      option.textContent?.trim(),
    );
    expect(options).toEqual(["Cold Brew", "Mixed Berries Soda"]);
  });

  it("add form has steps, ingredient rows and a description fallback", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Steps");

    expect(screen.getByLabelText("Steps").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Ingredient 1")).toBeDefined();
    expect(screen.getByLabelText("Qty 1")).toBeDefined();
    expect(screen.getByLabelText("Unit 1")).toBeDefined();
    expect(screen.getByText(/plain description/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    expect(screen.getByLabelText("Ingredient 2")).toBeDefined();
    expect(screen.getByLabelText("Qty 2")).toBeDefined();
    expect(screen.getByLabelText("Unit 2")).toBeDefined();
  });

  it("lays ingredient rows out as a phone-stacking grid with a danger Delete", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Ingredient 1");

    const row = screen.getByLabelText("Ingredient 1").closest("label")
      ?.parentElement as HTMLElement;
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("sm:grid-cols-[1fr_5rem_5rem_auto]");

    const remove = screen.getByRole("button", { name: "Remove ingredient 1" });
    expect(remove.className).toContain("text-danger");
  });

  it("add submits the picked drink, steps and rows including a description-only line", async () => {
    const postSpy = vi
      .spyOn(recipesApi, "postRecipe")
      .mockResolvedValue({ ...recipes[0], id: 99, lines: [] });
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Drink");

    fireEvent.change(screen.getByLabelText("Drink"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("Steps"), {
      target: { value: "1. Brew\n2. Serve" },
    });
    fireEvent.change(screen.getByLabelText("Ingredient 1"), {
      target: { value: "Coffee" },
    });
    fireEvent.change(screen.getByLabelText("Qty 1"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("Unit 1"), { target: { value: "g" } });
    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    fireEvent.change(screen.getByLabelText("Ingredient 2"), {
      target: { value: "Top with cinnamon" },
    });
    fireEvent.submit(
      screen.getByLabelText("Add recipe form").closest("form") as HTMLFormElement,
    );

    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith({
      menu_item_id: 14,
      steps: "1. Brew\n2. Serve",
      lines: [
        { ingredient: "Coffee", qty: 18, unit: "g" },
        { ingredient: "Top with cinnamon", qty: null, unit: null },
      ],
    });
    await vi.waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add recipe" })).toBeNull(),
    );
  });

  it("submitting without steps shows an inline error and does not post", async () => {
    const postSpy = vi
      .spyOn(recipesApi, "postRecipe")
      .mockResolvedValue({ ...recipes[0], lines: [] });
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Drink");

    fireEvent.submit(
      screen.getByLabelText("Add recipe form").closest("form") as HTMLFormElement,
    );
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("failed add keeps the form open with an inline error", async () => {
    // Non-Error throw keeps the generic copy (no message to surface).
    vi.spyOn(recipesApi, "postRecipe").mockRejectedValue("offline");
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Drink");

    fireEvent.change(screen.getByLabelText("Steps"), {
      target: { value: "1. Brew" },
    });
    fireEvent.submit(
      screen.getByLabelText("Add recipe form").closest("form") as HTMLFormElement,
    );

    const alert = await within(
      screen.getByRole("dialog", { name: "Add recipe" }),
    ).findByRole("alert");
    expect(alert.textContent).toBe("Could not save that guide.");
  });

  it("add failure with a 400 body shows the server error text in the form", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/categories") return ok(categories);
      if (u === "/api/menu_items") return ok(menuItems);
      if (u === "/api/recipes" && (init?.method ?? "GET") === "GET") {
        return ok(recipes);
      }
      if (u === "/api/recipes" && init?.method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "recipe already exists for this menu item",
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Drink");

    fireEvent.change(screen.getByLabelText("Steps"), {
      target: { value: "1. Brew" },
    });
    fireEvent.submit(
      screen.getByLabelText("Add recipe form").closest("form") as HTMLFormElement,
    );

    const alert = await within(
      screen.getByRole("dialog", { name: "Add recipe" }),
    ).findByRole("alert");
    expect(alert.textContent).toBe("recipe already exists for this menu item");
  });

  it("detail dialog carries Edit and Delete; Edit opens a prefilled form and patches the same drink", async () => {
    const patchSpy = vi
      .spyOn(recipesApi, "patchRecipe")
      .mockResolvedValue(details[1]);
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Recipe — Spanish Latte",
    });
    await screen.findByText("Condensed Milk — 40 ml");
    expect(within(dialog).getByRole("button", { name: "Edit" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDefined();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    const steps = (await screen.findByLabelText("Steps")) as HTMLTextAreaElement;
    expect(steps.value).toBe("1. Milk\n2. Mix");
    expect((screen.getByLabelText("Ingredient 1") as HTMLInputElement).value).toBe(
      "Condensed Milk",
    );
    expect((screen.getByLabelText("Qty 1") as HTMLInputElement).value).toBe("40");
    expect((screen.getByLabelText("Unit 1") as HTMLInputElement).value).toBe("ml");
    expect((screen.getByLabelText("Ingredient 2") as HTMLInputElement).value).toBe(
      "Ice",
    );

    fireEvent.change(steps, { target: { value: "1. Milk\n2. Mix well" } });
    fireEvent.submit(
      screen.getByLabelText("Edit recipe form").closest("form") as HTMLFormElement,
    );

    await vi.waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(1, {
      menu_item_id: 11,
      steps: "1. Milk\n2. Mix well",
      lines: [
        { ingredient: "Condensed Milk", qty: 40, unit: "ml" },
        { ingredient: "Ice", qty: null, unit: null },
      ],
    });
  });

  it("Delete removes the guide only and closes the detail dialog", async () => {
    const deleteSpy = vi
      .spyOn(recipesApi, "deleteRecipe")
      .mockResolvedValue(undefined);
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Recipe — Spanish Latte",
    });
    await screen.findByText("Condensed Milk — 40 ml");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The menu item behind the guide still lists nothing changed here; the
    // drinks list keeps rendering the other recipes.
    expect(screen.getByRole("button", { name: "Dark Mocha" })).toBeDefined();
  });

  it("failed delete keeps the dialog open with an inline error", async () => {
    // Non-Error throw keeps the generic copy (no message to surface).
    vi.spyOn(recipesApi, "deleteRecipe").mockRejectedValue("offline");
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Recipe — Spanish Latte",
    });
    await screen.findByText("Condensed Milk — 40 ml");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Could not delete this guide.");
    expect(
      screen.getByRole("dialog", { name: "Recipe — Spanish Latte" }),
    ).toBeDefined();
  });
});

describe("GuidePage dialogs on the Dialog primitive (Task 22)", () => {
  it("opens the detail dialog with focus inside and closes it once on Escape", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Recipe — Spanish Latte",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The page behind is untouched and still interactive.
    expect(screen.getByRole("button", { name: "Spanish Latte" })).toBeDefined();
  });

  it("opens the add form dialog with focus inside and closes it on Escape", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const dialog = await screen.findByRole("dialog", { name: "Add recipe" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the detail dialog mutually exclusive with the edit form", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Recipe — Spanish Latte",
    });
    await screen.findByText("Condensed Milk — 40 ml");

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog", { name: "Edit recipe" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("styles the detail Delete as a danger button", async () => {
    stubFetch();
    renderGuide();
    await screen.findByRole("button", { name: "Spanish Latte" });
    fireEvent.click(screen.getByRole("button", { name: "Spanish Latte" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Recipe — Spanish Latte",
    });
    await screen.findByText("Condensed Milk — 40 ml");

    expect(
      within(dialog).getByRole("button", { name: "Delete" }).className,
    ).toContain("text-danger");
  });
});
