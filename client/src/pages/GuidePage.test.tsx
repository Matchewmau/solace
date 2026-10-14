import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GuidePage, { filterRecipes, formatLine } from "./GuidePage";
import type { Recipe, RecipeDetail } from "../api/recipes";

afterEach(() => {
  cleanup();
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

function ok(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function stubFetch() {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u === "/api/recipes") return ok(recipes);
    const match = u.match(/^\/api\/recipes\/(\d+)$/);
    if (match) return ok(details[Number(match[1])]);
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
    fireEvent.click(screen.getByTestId("guide-dialog-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dark Mocha" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
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
