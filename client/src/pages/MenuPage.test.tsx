import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MenuShowcase, MenuItemDialog, ItemPopup } from "./MenuPage";
import * as menuApi from "../api/menu";
import type { Category, MenuItem } from "../api/menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const categories: Category[] = [
  { id: 2, name: "Non-Coffee", sort: 2 },
  { id: 1, name: "Espresso", sort: 1 },
];

const items: MenuItem[] = [
  { id: 1, category_id: 1, name: "Cortado", price_cents: 7000, cost_cents: 2000, active: 1, variants: [] },
  { id: 2, category_id: 1, name: "Latte", price_cents: 8000, cost_cents: 2500, active: 1, variants: [] },
  { id: 3, category_id: 2, name: "Calamansi Cooler", price_cents: 5000, cost_cents: 1200, active: 1, variants: [] },
  { id: 4, category_id: 1, name: "Retired Blend", price_cents: 9000, cost_cents: 3000, active: 0, variants: [] },
];

function renderShowcase() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MenuShowcase categories={categories} items={items} />
      </QueryClientProvider>,
    ),
  };
}

describe("MenuShowcase with mocked query data", () => {
  it("renders all category headings and item names with whole-peso prices", () => {
    render(<MenuShowcase categories={categories} items={items} />);

    expect(screen.getByRole("heading", { name: "Espresso" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Non-Coffee" })).toBeDefined();
    expect(screen.getByText("Cortado")).toBeDefined();
    expect(screen.getByText("Latte")).toBeDefined();
    expect(screen.getByText("Calamansi Cooler")).toBeDefined();
    expect(screen.getByText("₱70")).toBeDefined();
    expect(screen.getByText("₱80")).toBeDefined();
    expect(screen.getByText("₱50")).toBeDefined();
  });

  it("excludes inactive items", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    expect(screen.queryByText("Retired Blend")).toBeNull();
  });

  it("orders categories by sort, then name", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const headings = screen.getAllByRole("heading");
    expect(headings.map((h) => h.textContent)).toEqual(["Espresso", "Non-Coffee"]);
  });

  it("groups items under their category heading", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const espresso = screen.getByLabelText("Espresso");
    expect(within(espresso).getByText("Cortado")).toBeDefined();
    expect(within(espresso).queryByText("Calamansi Cooler")).toBeNull();
  });

  it("shows the empty state when nothing is available", () => {
    render(<MenuShowcase categories={[]} items={[]} />);
    expect(screen.getByText("No items available")).toBeDefined();
  });
});

describe("MenuShowcase category boxes and aligned rows (Task 21)", () => {
  it("wraps each category in a Box titled with the category name", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const espresso = screen.getByLabelText("Espresso") as HTMLElement;
    expect(espresso.tagName).toBe("SECTION");
    expect(within(espresso).getByRole("heading", { name: "Espresso" })).toBeDefined();
  });

  it("renders each item as a card in a responsive grid", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const espresso = screen.getByLabelText("Espresso");
    const grid = within(espresso).getByRole("list");
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("sm:grid-cols-2");
    expect(grid.className).toContain("xl:grid-cols-3");

    const card = within(espresso).getByRole("button", { name: /Cortado/ });
    expect(card.className).toContain("rounded-box");
    expect(card.className).toContain("border");
    expect(card.className).toContain("text-left");
    expect(within(card).getByText("₱70")).toBeDefined();
  });

  it("sorts items within each category by name or price", () => {
    render(<MenuShowcase categories={categories} items={items} />);
    const espresso = screen.getByLabelText("Espresso");
    const names = () =>
      within(espresso)
        .getAllByRole("button")
        .map((button) => button.textContent ?? "");

    expect(names()[0]).toContain("Cortado");
    expect(names()[1]).toContain("Latte");

    fireEvent.change(screen.getByLabelText("Sort menu items"), {
      target: { value: "price-desc" },
    });
    expect(names()[0]).toContain("Latte");
    expect(names()[1]).toContain("Cortado");

    fireEvent.change(screen.getByLabelText("Sort menu items"), {
      target: { value: "name-desc" },
    });
    expect(names()[0]).toContain("Latte");
    expect(names()[1]).toContain("Cortado");
  });

  it("shows a neutral Inactive badge and mutes inactive cards", async () => {
    renderShowcase();
    fireEvent.click(screen.getByRole("button", { name: "Show inactive" }));

    const card = await screen.findByRole("button", { name: /Retired Blend/ });
    expect(card.className).toContain("text-muted");
    expect(card.className).toContain("rounded-box");
    expect(within(card).getByText("₱90")).toBeDefined();

    const badge = within(card).getByText("Inactive");
    expect(badge.className).toContain("rounded-full");
    expect(badge.className).toContain("text-muted");
  });

  it("keeps the Show inactive / Hide inactive toggle", async () => {
    renderShowcase();
    const toggle = screen.getByRole("button", { name: "Show inactive" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(await screen.findByText("Retired Blend")).toBeDefined();
    const hide = screen.getByRole("button", { name: "Hide inactive" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("MenuShowcase add/edit and popup (Task 7)", () => {
  it("opens the add form from the Add button", async () => {
    render(<MenuShowcase categories={categories} items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByLabelText("Variants")).toBeDefined();
  });

  it("add form has name, type from existing categories, price, variants with hint", async () => {
    render(<MenuShowcase categories={categories} items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByLabelText("Name")).toBeDefined();
    expect(screen.getByLabelText("Type")).toBeDefined();
    expect(screen.getByLabelText("Price")).toBeDefined();
    expect(screen.getByLabelText("Variants")).toBeDefined();
    expect(
      screen.getByText(/commas/i),
    ).toBeDefined();
    expect(screen.getByText(/POS.*prompt|prompt.*POS/i)).toBeDefined();

    const typeSelect = screen.getByLabelText("Type") as HTMLSelectElement;
    const options = Array.from(typeSelect.querySelectorAll("option")).map((o) =>
      o.textContent?.trim(),
    );
    expect(options).toContain("Espresso");
    expect(options).toContain("Non-Coffee");
    expect(options).toHaveLength(2);
  });

  it('", , " submits [] with price converted to cents', async () => {
    const postSpy = vi
      .spyOn(menuApi, "postMenuItem")
      .mockResolvedValue({ ...items[0], id: 99 });
    renderShowcase();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Variants");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Flat White" } });
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Variants"), { target: { value: ", , " } });
    const form = screen.getByLabelText("Add menu item form").closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Flat White", price_cents: 5000, variants: [] }),
    );
  });

  it("item click opens popup with details, status and totals", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 1,
      total_qty: 12,
      total_revenue_cents: 84000,
    });
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    const dialog = await screen.findByRole("dialog", { name: "Cortado" });
    expect(dialog.textContent).toContain("Cortado");
    expect(dialog.textContent).toContain("Espresso");
    expect(dialog.textContent).toContain("₱70");
    expect(dialog.textContent).toMatch(/Active/);
    // Totals arrive a microtask after the popup mounts — await them so the
    // assertion cannot race under parallel load (the historical flake).
    expect(await within(dialog).findByText("Total sold: 12")).toBeDefined();
    expect(await within(dialog).findByText(/Total revenue: ₱840/)).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Edit" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Deactivate" })).toBeDefined();
  });

  it("popup keeps its heading and Close button", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 1,
      total_qty: 0,
      total_revenue_cents: 0,
    });
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    const dialog = await screen.findByRole("dialog", { name: "Cortado" });

    expect(within(dialog).getByRole("heading", { name: "Cortado" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDefined();
  });

  it("popup closes on Escape", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 1,
      total_qty: 0,
      total_revenue_cents: 0,
    });
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    await screen.findByRole("dialog", { name: "Cortado" });

    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("popup shows Activate for inactive items", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 4,
      total_qty: 0,
      total_revenue_cents: 0,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ItemPopup
          item={items[3]}
          categoryName="Espresso"
          onClose={() => {}}
          onEdit={() => {}}
          onToggleActive={() => {}}
          togglePending={false}
        />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole("dialog", { name: "Retired Blend" });
    expect(dialog.textContent).toMatch(/Inactive/);
    expect(within(dialog).getByRole("button", { name: "Activate" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Edit" })).toBeDefined();
  });

  it("deactivate patches the active flag", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 1,
      total_qty: 12,
      total_revenue_cents: 84000,
    });
    const patchSpy = vi.spyOn(menuApi, "patchMenuItem").mockResolvedValue(items[0]);
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    const dialog = await screen.findByRole("dialog", { name: "Cortado" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await vi.waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(1, { active: 0 });
  });

  it("inactive item is reachable via Show inactive and reactivates from the list", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 4,
      total_qty: 3,
      total_revenue_cents: 27000,
    });
    const patchSpy = vi.spyOn(menuApi, "patchMenuItem").mockResolvedValue(items[3]);
    renderShowcase();
    expect(screen.queryByText("Retired Blend")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show inactive" }));
    fireEvent.click(await screen.findByText("Retired Blend"));
    const dialog = await screen.findByRole("dialog", { name: "Retired Blend" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate" }));
    await vi.waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(4, { active: 1 });
  });

  it("invalid submit shows an inline error and does not post", async () => {
    const postSpy = vi
      .spyOn(menuApi, "postMenuItem")
      .mockResolvedValue({ ...items[0], id: 99 });
    renderShowcase();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("Name");
    const form = screen.getByLabelText("Add menu item form").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("failed toggle shows an inline error", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 1,
      total_qty: 12,
      total_revenue_cents: 84000,
    });
    // Non-Error throw keeps the generic copy (no message to surface).
    vi.spyOn(menuApi, "patchMenuItem").mockRejectedValue("offline");
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    const dialog = await screen.findByRole("dialog", { name: "Cortado" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("Could not update that item.");
  });

  it("edit dialog submits a patch", async () => {
    const patchSpy = vi.spyOn(menuApi, "patchMenuItem").mockResolvedValue(items[0]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MenuItemDialog
          categories={categories}
          initial={items[0]}
          pending={false}
          error={null}
          onClose={() => {}}
          onSubmit={(input) => {
            void menuApi.patchMenuItem(items[0].id, input);
          }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Name")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cortado Grande" } });
    const form = screen.getByLabelText("Edit Cortado form").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await vi.waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0][0]).toBe(1);
  });

  it("edit failure with a 400 body shows the server error text in the dialog", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/menu_items/1/sales-totals") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            menu_item_id: 1,
            total_qty: 0,
            total_revenue_cents: 0,
          }),
        } as Response;
      }
      if (u === "/api/menu_items/1" && init?.method === "PATCH") {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: "variant option must be 1-30 characters",
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    const popup = await screen.findByRole("dialog", { name: "Cortado" });
    fireEvent.click(within(popup).getByRole("button", { name: "Edit" }));
    await screen.findByLabelText("Name");
    fireEvent.submit(
      screen.getByLabelText("Edit Cortado form").closest("form") as HTMLFormElement,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("variant option must be 1-30 characters");
  });
});

describe("MenuShowcase menu item dialog on the Dialog primitive (Task 21)", () => {
  it("opens the add dialog labelled with focus inside it and Save/Cancel", async () => {
    renderShowcase();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const dialog = await screen.findByRole("dialog", { name: "Add menu item" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDefined();
  });

  it("closes the add dialog on Escape", async () => {
    renderShowcase();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("dialog", { name: "Add menu item" });

    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes the edit dialog on Escape without touching the page", async () => {
    vi.spyOn(menuApi, "fetchItemTotals").mockResolvedValue({
      menu_item_id: 1,
      total_qty: 0,
      total_revenue_cents: 0,
    });
    renderShowcase();
    fireEvent.click(screen.getByText("Cortado"));
    const popup = await screen.findByRole("dialog", { name: "Cortado" });
    fireEvent.click(within(popup).getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog", { name: "Edit Cortado" });

    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Cortado")).toBeDefined();
  });
});
