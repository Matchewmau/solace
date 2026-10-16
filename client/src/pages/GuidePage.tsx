import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteRecipe,
  fetchRecipe,
  fetchRecipes,
  patchRecipe,
  postRecipe,
  type Recipe,
  type RecipeDetail,
  type RecipeInput,
  type RecipeLine,
  type RecipeLineInput,
} from "../api/recipes";
import {
  fetchCategories,
  fetchMenuItems,
  type Category,
  type MenuItem,
} from "../api/menu";
import { sortCategories } from "../lib/sortCategories";
import { Reveal, StaggerItem, StaggerList } from "../components/motion";

/**
 * Case-insensitive substring match on the drink name, scoped to the
 * active type via the recipe's linked menu item category.
 */
export function filterRecipes(
  recipes: Recipe[],
  query: string,
  category: number | "all" = "all",
  categoryByMenuItemId?: Map<number, number>,
): Recipe[] {
  const needle = query.trim().toLowerCase();
  return recipes.filter((recipe) => {
    if (category !== "all") {
      const recipeCategory = categoryByMenuItemId?.get(recipe.menu_item_id);
      if (recipeCategory !== category) return false;
    }
    if (needle === "") return true;
    return recipe.menu_item_name.toLowerCase().includes(needle);
  });
}

export function formatLine(line: RecipeLine): string {
  if (line.qty === null || line.qty === undefined) return line.ingredient;
  const amount = line.unit ? `${line.qty} ${line.unit}` : String(line.qty);
  return `${line.ingredient} — ${amount}`;
}

interface BrowserProps {
  recipes: Recipe[];
  categories: Category[];
  activeCategory: number | "all";
  onCategoryChange: (value: number | "all") => void;
  categoryByMenuItemId: Map<number, number>;
  query: string;
  onQueryChange: (value: string) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading guide">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-5 w-full bg-ink/10" />
      ))}
    </div>
  );
}

/**
 * Pure list + type filter + search browser over mocked-or-fetched recipes.
 * The filter row mirrors POS: `All` plus each drink type in the shared
 * `sortCategories` order (Food never lists). The selected drink's detail
 * is fetched by id (see GuidePage).
 */
export function GuideBrowser({
  recipes,
  categories,
  activeCategory,
  onCategoryChange,
  categoryByMenuItemId,
  query,
  onQueryChange,
  selectedId,
  onSelect,
}: BrowserProps) {
  const filtered = filterRecipes(
    recipes,
    query,
    activeCategory,
    categoryByMenuItemId,
  );
  return (
    <div className="flex flex-col gap-6">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Category filter"
      >
        <button
          type="button"
          aria-pressed={activeCategory === "all"}
          onClick={() => onCategoryChange("all")}
          className={
            activeCategory === "all"
              ? "bg-ink px-4 py-2 text-sm font-semibold text-paper"
              : "border border-ink px-4 py-2 text-sm font-semibold"
          }
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={activeCategory === category.id}
            onClick={() => onCategoryChange(category.id)}
            className={
              activeCategory === category.id
                ? "bg-ink px-4 py-2 text-sm font-semibold text-paper"
                : "border border-ink px-4 py-2 text-sm font-semibold"
            }
          >
            {category.name}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-2">
        <span className="label text-xs text-muted">Search drinks</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search drinks…"
          aria-label="Search drinks"
          className="border border-ink/20 bg-paper px-4 py-2 text-base text-ink"
        />
      </label>
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-muted">No drinks found</p>
      ) : (
        <StaggerList className="flex flex-col gap-2" ariaLabel="Drinks">
          {filtered.map((recipe) => (
            <StaggerItem key={recipe.id}>
              <button
                type="button"
                onClick={() => onSelect(recipe.id)}
                aria-pressed={recipe.id === selectedId}
                className={
                  recipe.id === selectedId
                    ? "w-full border border-accent px-4 py-2 text-left text-base font-semibold text-accent"
                    : "w-full border border-ink/20 px-4 py-2 text-left text-base"
                }
              >
                {recipe.menu_item_name}
              </button>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </div>
  );
}

interface RowState {
  id: number;
  ingredient: string;
  qty: string;
  unit: string;
}

let nextRowId = 0;

function rowFromLine(line: RecipeLine): RowState {
  return {
    id: nextRowId++,
    ingredient: line.ingredient,
    qty: line.qty === null || line.qty === undefined ? "" : String(line.qty),
    unit: line.unit ?? "",
  };
}

function emptyRow(): RowState {
  return { id: nextRowId++, ingredient: "", qty: "", unit: "" };
}

export interface GuideFormProps {
  /** Drink items without guides — the Add picker. Ignored when editing. */
  drinks: MenuItem[];
  initial: RecipeDetail | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: RecipeInput) => void;
}

/**
 * Owner Add/Edit guide form. The linked drink comes from the picker on
 * Add (drinks without guides only — the menu row must exist first) and
 * is fixed while editing (no relinking). Steps plus ingredient rows
 * carry the recipe; qty/unit are optional, so a bare ingredient saves
 * and displays as a plain description line.
 */
export function GuideForm({
  drinks,
  initial,
  pending,
  error,
  onClose,
  onSubmit,
}: GuideFormProps) {
  const isEdit = initial !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [steps, setSteps] = useState(initial?.steps ?? "");
  const [drinkId, setDrinkId] = useState(
    drinks[0] ? String(drinks[0].id) : "",
  );
  const [rows, setRows] = useState<RowState[]>(() =>
    initial && initial.lines.length > 0
      ? initial.lines.map(rowFromLine)
      : [emptyRow()],
  );

  function updateRow(id: number, patch: Partial<Omit<RowState, "id">>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (steps.trim() === "") {
      setFormError("Enter brew steps.");
      return;
    }
    let menuItemId: number;
    if (initial === null) {
      menuItemId = Number(drinkId);
      if (!drinks.some((drink) => drink.id === menuItemId)) {
        setFormError("Choose a drink.");
        return;
      }
    } else {
      menuItemId = initial.menu_item_id;
    }
    const lines: RecipeLineInput[] = [];
    for (const row of rows) {
      const ingredient = row.ingredient.trim();
      if (ingredient === "") continue;
      const qtyRaw = row.qty.trim();
      let qty: number | null = null;
      if (qtyRaw !== "") {
        qty = Number(qtyRaw);
        if (!Number.isFinite(qty) || qty < 0) {
          setFormError("Enter a valid quantity.");
          return;
        }
      }
      const unit = row.unit.trim();
      lines.push({ ingredient, qty, unit: unit === "" ? null : unit });
    }
    setFormError(null);
    onSubmit({ menu_item_id: menuItemId, steps: steps.trim(), lines });
  }

  return (
    <div
      data-testid="guide-form-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${initial.menu_item_name}` : "Add guide"}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg border border-ink/20 bg-paper p-6 text-ink"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="label text-xs text-muted">Solace &middot; Recipe guide</p>
          <button
            type="button"
            onClick={onClose}
            className="border border-ink px-3 py-1 text-sm font-semibold"
          >
            Close
          </button>
        </div>
        <h2 className="mt-2 text-2xl font-semibold">
          {isEdit ? `Edit ${initial.menu_item_name}` : "Add guide"}
        </h2>
        <form
          aria-label={isEdit ? "Edit guide form" : "Add guide form"}
          className="mt-4 flex flex-col gap-3"
          onSubmit={handleSubmit}
        >
          {isEdit ? (
            <p className="text-sm">
              Drink: <span className="font-semibold">{initial.menu_item_name}</span>
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span>Drink</span>
              <select
                value={drinkId}
                onChange={(event) => setDrinkId(event.target.value)}
                aria-label="Drink"
                className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
              >
                {drinks.map((drink) => (
                  <option key={drink.id} value={drink.id}>
                    {drink.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isEdit && drinks.length === 0 ? (
            <p className="text-sm text-muted">
              Every drink already has a guide. Add a drink on the Menu page
              first.
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span>Steps</span>
            <textarea
              value={steps}
              onChange={(event) => setSteps(event.target.value)}
              required
              rows={4}
              placeholder={"1. …\n2. …"}
              aria-label="Steps"
              className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm">Ingredients</span>
            {rows.map((row, index) => (
              <div key={row.id} className="flex items-start gap-2">
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  <span>Ingredient</span>
                  <input
                    type="text"
                    value={row.ingredient}
                    onChange={(event) =>
                      updateRow(row.id, { ingredient: event.target.value })
                    }
                    placeholder="Ingredient or description"
                    aria-label={`Ingredient ${index + 1}`}
                    className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
                  />
                </label>
                <label className="flex w-20 flex-col gap-1 text-sm">
                  <span>Qty</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={row.qty}
                    onChange={(event) =>
                      updateRow(row.id, { qty: event.target.value })
                    }
                    placeholder="Qty"
                    aria-label={`Qty ${index + 1}`}
                    className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
                  />
                </label>
                <label className="flex w-20 flex-col gap-1 text-sm">
                  <span>Unit</span>
                  <input
                    type="text"
                    value={row.unit}
                    onChange={(event) =>
                      updateRow(row.id, { unit: event.target.value })
                    }
                    placeholder="Unit"
                    aria-label={`Unit ${index + 1}`}
                    className="border border-ink/20 bg-paper px-2 py-1 text-base text-ink"
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setRows((current) =>
                      current.filter((candidate) => candidate.id !== row.id),
                    )
                  }
                  aria-label={`Remove ingredient ${index + 1}`}
                  className="border border-ink/20 px-3 py-1 text-sm text-muted"
                >
                  &minus;
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((current) => [...current, emptyRow()])}
              className="self-start border border-ink px-3 py-1 text-sm font-semibold"
            >
              Add ingredient
            </button>
            <p className="text-sm text-muted">
              Qty and unit are optional — leave both blank to save a plain
              description line.
            </p>
          </div>
          <div className="mt-1 flex gap-2">
            <button
              type="submit"
              disabled={pending || (!isEdit && drinks.length === 0)}
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
        {formError ?? error ? (
          <p role="alert" className="mt-2 text-sm text-accent">
            {formError ?? error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type FormState = { mode: "add" } | { mode: "edit"; recipe: RecipeDetail } | null;

export default function GuidePage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<FormState>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const listQuery = useQuery({ queryKey: ["recipes"], queryFn: fetchRecipes });
  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
  });
  const itemsQuery = useQuery({
    queryKey: ["menu-items"],
    queryFn: fetchMenuItems,
  });

  const recipes = listQuery.data ?? [];
  const categories = sortCategories(categoriesQuery.data ?? []);
  const foodCategoryId = categories.find((c) => c.name === "Food")?.id ?? null;
  const drinkCategories = categories.filter((c) => c.id !== foodCategoryId);
  const menuItemById = new Map(
    (itemsQuery.data ?? []).map((item) => [item.id, item] as const),
  );
  // Food never lists in the Guide — guard even if a recipe points at one.
  const drinkRecipes = recipes.filter((recipe) => {
    const item = menuItemById.get(recipe.menu_item_id);
    return item !== undefined && item.category_id !== foodCategoryId;
  });
  const categoryByMenuItemId = new Map<number, number>();
  for (const recipe of drinkRecipes) {
    const item = menuItemById.get(recipe.menu_item_id);
    if (item) categoryByMenuItemId.set(recipe.menu_item_id, item.category_id);
  }
  const guidedMenuItemIds = new Set(recipes.map((recipe) => recipe.menu_item_id));
  // Guides need an existing drink row and one guide per drink.
  const addableDrinks = (itemsQuery.data ?? []).filter(
    (item) => item.category_id !== foodCategoryId && !guidedMenuItemIds.has(item.id),
  );

  const active = drinkRecipes.find((recipe) => recipe.id === selectedId) ?? null;

  const detailQuery = useQuery({
    queryKey: ["recipe", selectedId],
    queryFn: () => fetchRecipe(selectedId as number),
    enabled: selectedId !== null,
  });

  const isLoading =
    listQuery.isLoading || categoriesQuery.isLoading || itemsQuery.isLoading;
  const isError =
    listQuery.isError || categoriesQuery.isError || itemsQuery.isError;

  function handleSelect(id: number) {
    setSelectedId(id);
    setDeleteError(null);
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

  function handleFormClose() {
    setForm(null);
    setSaveError(null);
  }

  async function handleFormSubmit(input: RecipeInput) {
    const editing = form?.mode === "edit" ? form.recipe : null;
    setSavePending(true);
    setSaveError(null);
    try {
      if (editing) {
        await patchRecipe(editing.id, input);
        await queryClient.invalidateQueries({
          queryKey: ["recipe", editing.id],
        });
      } else {
        await postRecipe(input);
      }
      setForm(null);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    } catch {
      setSaveError(
        editing ? "Could not save those changes." : "Could not save that guide.",
      );
    } finally {
      setSavePending(false);
    }
  }

  async function handleDelete() {
    if (selectedId === null) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await deleteRecipe(selectedId);
      setIsOpen(false);
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ["recipes"] });
    } catch {
      setDeleteError("Could not delete this guide.");
    } finally {
      setDeletePending(false);
    }
  }

  useEffect(() => {
    if (!isOpen && form === null) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (form !== null) {
        setForm(null);
        setSaveError(null);
      } else {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, form]);

  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen, selectedId]);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe &middot; LAN</p>
          <h1 className="text-4xl font-semibold">Barista Guide</h1>
          <p className="text-sm text-muted">Brew steps for every drink.</p>
        </Reveal>
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-start gap-4 py-16">
            <p role="alert" className="text-lg">
              Could not load the guide.
            </p>
            <button
              type="button"
              className="border border-ink px-4 py-2 text-sm font-semibold"
              onClick={() => {
                void listQuery.refetch();
                void categoriesQuery.refetch();
                void itemsQuery.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <div className="flex items-center justify-between gap-4">
              <p className="label text-xs text-muted">Solace &middot; Guide</p>
              <button
                type="button"
                onClick={() => {
                  setSaveError(null);
                  setForm({ mode: "add" });
                }}
                className="border border-ink px-4 py-2 text-sm font-semibold"
              >
                Add
              </button>
            </div>
            {recipes.length === 0 ? (
              <p className="py-16 text-center text-muted">No recipes available</p>
            ) : (
              <GuideBrowser
                recipes={drinkRecipes}
                categories={drinkCategories}
                activeCategory={activeCategory}
                onCategoryChange={setActiveCategory}
                categoryByMenuItemId={categoryByMenuItemId}
                query={query}
                onQueryChange={setQuery}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
            {isOpen && selectedId !== null && form === null ? (
              <div
                data-testid="guide-dialog-backdrop"
                onClick={handleClose}
                className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
              >
                <div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label={
                    detailQuery.data?.menu_item_name ??
                    active?.menu_item_name ??
                    "Recipe"
                  }
                  tabIndex={-1}
                  onClick={(event) => event.stopPropagation()}
                  className="w-full max-w-lg border border-ink/20 bg-paper p-6 text-ink"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="label text-xs text-muted">
                      Solace &middot; Recipe
                    </p>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="border border-ink px-3 py-1 text-sm font-semibold"
                    >
                      Close
                    </button>
                  </div>
                  {detailQuery.isLoading ? (
                    <p className="mt-4 text-muted" aria-busy="true">
                      Loading recipe…
                    </p>
                  ) : detailQuery.isError ? (
                    <div className="mt-4 flex flex-col items-start gap-4">
                      <p role="alert" className="text-lg">
                        Could not load this recipe.
                      </p>
                      <button
                        type="button"
                        className="border border-ink px-4 py-2 text-sm font-semibold"
                        onClick={() => {
                          void detailQuery.refetch();
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : detailQuery.data ? (
                    <div>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {detailQuery.data.menu_item_name}
                      </h2>
                      <h3 className="mt-6 text-sm font-semibold">Steps</h3>
                      <p className="mt-2 whitespace-pre-line text-base">
                        {detailQuery.data.steps}
                      </p>
                      <h3 className="mt-6 text-sm font-semibold">Ingredients</h3>
                      <ul className="mt-2 flex flex-col gap-2">
                        {detailQuery.data.lines.map((line) => (
                          <li key={line.id} className="text-base">
                            {formatLine(line)}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-6 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSaveError(null);
                            setIsOpen(false);
                            setForm({
                              mode: "edit",
                              recipe: detailQuery.data,
                            });
                          }}
                          className="border border-ink px-4 py-2 text-sm font-semibold"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete()}
                          disabled={deletePending}
                          className="border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-40"
                        >
                          {deletePending ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                      {deleteError ? (
                        <p role="alert" className="mt-2 text-sm text-accent">
                          {deleteError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {form !== null ? (
              <GuideForm
                drinks={addableDrinks}
                initial={form.mode === "edit" ? form.recipe : null}
                pending={savePending}
                error={saveError}
                onClose={handleFormClose}
                onSubmit={(input) => void handleFormSubmit(input)}
              />
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
