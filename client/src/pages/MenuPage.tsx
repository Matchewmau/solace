import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchActiveMenuItems,
  fetchCategories,
  fetchItemTotals,
  patchMenuItem,
  postMenuItem,
  type Category,
  type ItemTotals,
  type MenuItem,
  type MenuItemInput,
} from "../api/menu";
import { formatPeso } from "../lib/formatPeso";
import { sortCategories } from "../lib/sortCategories";
import { parseVariants } from "../lib/variants";
import {
  Reveal,
  StaggerGroup,
  StaggerItem,
  StaggerList,
  StaggerSection,
} from "../components/motion";

interface ShowcaseProps {
  categories: Category[];
  items: MenuItem[];
}

function useOptionalQueryClient() {
  try {
    return useQueryClient();
  } catch {
    return null;
  }
}

export interface MenuItemDialogProps {
  categories: Category[];
  initial: MenuItem | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: MenuItemInput) => void;
}

/**
 * Owner Add/Edit form. Type is a select over existing categories only —
 * no on-the-fly creation. Price is entered in pesos and converted to
 * integer price_cents on submit. Variants are comma-separated; POS
 * prompts for a choice only when variants exist.
 */
export function MenuItemDialog({
  categories,
  initial,
  pending,
  error,
  onClose,
  onSubmit,
}: MenuItemDialogProps) {
  const isEdit = initial !== null;
  const pricePesos =
    initial === null
      ? ""
      : initial.price_cents % 100 === 0
        ? String(initial.price_cents / 100)
        : (initial.price_cents / 100).toFixed(2);
  const variantsDefault = initial?.variants.join(", ") ?? "";
  const defaultCategoryId = initial?.category_id ?? categories[0]?.id ?? 0;

  return (
    <div
      data-testid="menu-dialog-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${initial.name}` : "Add menu item"}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg border border-ink/20 bg-paper p-6 text-ink"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="label text-xs text-muted">Solace &middot; Menu item</p>
          <button
            type="button"
            onClick={onClose}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Close
          </button>
        </div>
        <h2 className="mt-2 text-2xl font-semibold">
          {isEdit ? `Edit ${initial.name}` : "Add menu item"}
        </h2>
        <form
          aria-label={isEdit ? `Edit ${initial.name} form` : "Add menu item form"}
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const name = String(data.get("name") ?? "").trim();
            const category_id = Number(data.get("category_id"));
            const priceValue = Number(String(data.get("price") ?? ""));
            const variantsRaw = String(data.get("variants") ?? "");
            if (name === "") return;
            if (!Number.isFinite(category_id)) return;
            if (!categories.some((c) => c.id === category_id)) return;
            if (!Number.isFinite(priceValue) || priceValue < 0) return;
            onSubmit({
              category_id,
              name,
              price_cents: Math.round(priceValue * 100),
              variants: parseVariants(variantsRaw),
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input
              name="name"
              type="text"
              required
              defaultValue={initial?.name ?? ""}
              placeholder="Item name"
              aria-label="Name"
              className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Type</span>
            <select
              name="category_id"
              aria-label="Type"
              defaultValue={defaultCategoryId}
              className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Price</span>
            <input
              name="price"
              type="number"
              min="0"
              step="any"
              required
              defaultValue={pricePesos}
              placeholder="Price (₱)"
              aria-label="Price"
              className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Variants</span>
            <input
              name="variants"
              type="text"
              defaultValue={variantsDefault}
              placeholder="Hot, Iced"
              aria-label="Variants"
              className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
            />
          </label>
          <p className="text-sm text-muted">
            Separate variants with commas, e.g. Hot, Iced. POS will prompt for a
            choice when variants exist.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="border border-ink px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onClose}
              className="border border-ink/20 px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-accent">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface ItemPopupProps {
  item: MenuItem;
  categoryName: string;
  onClose: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  togglePending: boolean;
}

/**
 * Owner details popup: name, type, price plus status plus all-time
 * totals, with Edit and Deactivate/Activate actions.
 */
export function ItemPopup({
  item,
  categoryName,
  onClose,
  onEdit,
  onToggleActive,
  togglePending,
}: ItemPopupProps) {
  const [totals, setTotals] = useState<ItemTotals | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(true);
  const [totalsError, setTotalsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTotalsLoading(true);
    setTotalsError(null);
    fetchItemTotals(item.id).then(
      (data) => {
        if (cancelled) return;
        setTotals(data);
        setTotalsLoading(false);
      },
      () => {
        if (cancelled) return;
        setTotalsError("Could not load totals.");
        setTotalsLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  return (
    <div
      data-testid="menu-popup-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg border border-ink/20 bg-paper p-6 text-ink"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="label text-xs text-muted">Solace &middot; Menu item</p>
          <button
            type="button"
            onClick={onClose}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Close
          </button>
        </div>
        <h2 className="mt-2 text-2xl font-semibold">{item.name}</h2>
        <p className="mt-2 text-base">{categoryName}</p>
        <p className="mt-1 text-lg font-semibold text-accent">
          {formatPeso(item.price_cents)}
        </p>
        <p className="mt-1 text-sm">
          Status: {item.active === 1 ? "Active" : "Inactive"}
        </p>
        <div className="mt-4">
          {totalsLoading ? (
            <p className="text-sm text-muted" aria-busy="true">
              Loading totals…
            </p>
          ) : totalsError ? (
            <p role="alert" className="text-sm text-accent">
              {totalsError}
            </p>
          ) : totals ? (
            <div className="flex flex-col gap-1 text-sm">
              <p>Total sold: {totals.total_qty}</p>
              <p>Total revenue: {formatPeso(totals.total_revenue_cents)}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="border border-ink px-4 py-2 text-sm font-semibold"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={togglePending}
            className="border border-ink px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {item.active === 1 ? "Deactivate" : "Activate"}
          </button>
        </div>
      </div>
    </div>
  );
}

type DialogState = { mode: "add" } | { mode: "edit"; item: MenuItem } | null;

/**
 * Type-forward showcase with owner controls: Add opens MenuItemDialog,
 * item click opens ItemPopup with totals plus Edit and
 * Deactivate/Activate. Inactive items are never listed (defensive
 * filter; the query already requests `?active=1`).
 */
export function MenuShowcase({ categories, items }: ShowcaseProps) {
  const queryClient = useOptionalQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [popupItem, setPopupItem] = useState<MenuItem | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  async function invalidateMenuItems() {
    try {
      await queryClient?.invalidateQueries({ queryKey: ["menu-items"] });
    } catch {
      // No provider in unit tests — mutations still resolve.
    }
  }

  async function handleAddSubmit(input: MenuItemInput) {
    setSavePending(true);
    setSaveError(null);
    try {
      await postMenuItem(input);
      setDialog(null);
      await invalidateMenuItems();
    } catch {
      setSaveError("Could not save that item.");
    } finally {
      setSavePending(false);
    }
  }

  async function handleEditSubmit(id: number, input: MenuItemInput) {
    setSavePending(true);
    setSaveError(null);
    try {
      await patchMenuItem(id, input);
      setDialog(null);
      await invalidateMenuItems();
    } catch {
      setSaveError("Could not save those changes.");
    } finally {
      setSavePending(false);
    }
  }

  async function handleToggleActive(item: MenuItem) {
    setTogglePending(true);
    try {
      await patchMenuItem(item.id, { active: item.active === 1 ? 0 : 1 });
      setPopupItem(null);
      await invalidateMenuItems();
    } catch {
      // Keep the popup open; the toggle simply did not apply.
    } finally {
      setTogglePending(false);
    }
  }

  useEffect(() => {
    if (dialog === null && popupItem === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDialog(null);
        setPopupItem(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog, popupItem]);

  const visible = items.filter((item) => item.active === 1);
  const byCategory = new Map<number, MenuItem[]>();
  for (const item of visible) {
    const list = byCategory.get(item.category_id) ?? [];
    list.push(item);
    byCategory.set(item.category_id, list);
  }
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="label text-xs text-muted">Solace &middot; Menu</p>
        <button
          type="button"
          onClick={() => {
            setSaveError(null);
            setDialog({ mode: "add" });
          }}
          className="border border-ink px-4 py-2 text-sm font-semibold"
        >
          Add
        </button>
      </div>
      {categories.length === 0 || visible.length === 0 ? (
        <p className="py-16 text-center text-muted">No items available</p>
      ) : (
        <StaggerGroup className="flex flex-col gap-12">
          {sortCategories(categories).map((category) => (
            <StaggerSection key={category.id} ariaLabel={category.name}>
              <p className="label text-xs text-muted">Solace &middot; Menu</p>
              <h2 className="mt-2 text-2xl font-semibold">{category.name}</h2>
              <StaggerList className="mt-6 flex flex-col gap-5">
                {(byCategory.get(category.id) ?? []).map((item) => (
                  <StaggerItem
                    key={item.id}
                    className="flex items-baseline justify-between gap-6"
                  >
                    <button
                      type="button"
                      onClick={() => setPopupItem(item)}
                      className="flex w-full items-baseline justify-between gap-6 text-left"
                    >
                      <span className="text-lg">{item.name}</span>
                      <span className="text-lg font-semibold text-accent">
                        {formatPeso(item.price_cents)}
                      </span>
                    </button>
                  </StaggerItem>
                ))}
              </StaggerList>
            </StaggerSection>
          ))}
        </StaggerGroup>
      )}
      {dialog !== null ? (
        <MenuItemDialog
          categories={categories}
          initial={dialog.mode === "edit" ? dialog.item : null}
          pending={savePending}
          error={saveError}
          onClose={() => {
            setDialog(null);
            setSaveError(null);
          }}
          onSubmit={(input) => {
            if (dialog.mode === "add") void handleAddSubmit(input);
            else void handleEditSubmit(dialog.item.id, input);
          }}
        />
      ) : null}
      {popupItem !== null && dialog === null ? (
        <ItemPopup
          item={popupItem}
          categoryName={categoryNameById.get(popupItem.category_id) ?? ""}
          onClose={() => setPopupItem(null)}
          onEdit={() => {
            setPopupItem(null);
            setSaveError(null);
            setDialog({ mode: "edit", item: popupItem });
          }}
          onToggleActive={() => void handleToggleActive(popupItem)}
          togglePending={togglePending}
        />
      ) : null}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-12" aria-busy="true" aria-label="Loading menu">
      {[0, 1].map((section) => (
        <div key={section} className="flex flex-col gap-5">
          <div className="h-3 w-24 bg-ink/10" />
          <div className="h-7 w-48 bg-ink/10" />
          <div className="h-5 w-full bg-ink/10" />
          <div className="h-5 w-full bg-ink/10" />
          <div className="h-5 w-2/3 bg-ink/10" />
        </div>
      ))}
    </div>
  );
}

export default function MenuPage() {
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });
  const itemsQuery = useQuery({
    queryKey: ["menu-items", "active"],
    queryFn: fetchActiveMenuItems,
  });

  const isLoading = categoriesQuery.isLoading || itemsQuery.isLoading;
  const isError = categoriesQuery.isError || itemsQuery.isError;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Solace</h1>
          <p className="text-sm text-muted">Warm espresso, quiet room.</p>
        </Reveal>
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load the menu.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void categoriesQuery.refetch();
                void itemsQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <MenuShowcase
            categories={categoriesQuery.data ?? []}
            items={itemsQuery.data ?? []}
          />
        )}
      </div>
    </main>
  );
}
