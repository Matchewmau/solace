import { useState, type FormEvent } from "react";
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
import { canonicalUnit } from "../lib/units";
import { Reveal, StaggerGroup, StaggerItem, StaggerList, StaggerSection } from "../components/motion";
import { Box, Button, PageFrame } from "../components/ui";
import { Dialog } from "../components/Dialog";
import { UnitSelect } from "../components/UnitSelect";

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
  const unit = canonicalUnit(line.unit);
  const amount = unit ? `${line.qty} ${unit}` : String(line.qty);
  return `${line.ingredient} — ${amount}`;
}

/**
 * Card hint derived from the list payload. The list endpoint carries the
 * brew steps but not the ingredient lines, so the count of non-empty
 * steps is the per-card secondary hint.
 */
function stepHint(steps: string): string {
  const count = steps.split("\n").filter((line) => line.trim() !== "").length;
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

type RecipeSort = "name-asc" | "name-desc";

const RECIPE_SORT_OPTIONS: { value: RecipeSort; label: string }[] = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
];

/** Sort one category's recipe cards without mutating the query data. */
function sortRecipes(recipes: Recipe[], sort: RecipeSort): Recipe[] {
  return [...recipes].sort((a, b) =>
    sort === "name-asc"
      ? a.menu_item_name.localeCompare(b.menu_item_name) || a.id - b.id
      : b.menu_item_name.localeCompare(a.menu_item_name) || a.id - b.id,
  );
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
 * The toolbar `Box` mirrors POS: `All` plus each drink type in the shared
 * `sortCategories` order (Food never lists) over the `Search drinks` input.
 * Matches render as Menu-style category boxes, one recipe row per drink;
 * the selected drink's detail is fetched by id (see GuidePage).
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
  const [sort, setSort] = useState<RecipeSort>("name-asc");
  const filtered = filterRecipes(
    recipes,
    query,
    activeCategory,
    categoryByMenuItemId,
  );
  const groups = sortCategories(categories)
    .map((category) => ({
      category,
      rows: sortRecipes(
        filtered.filter(
          (recipe) =>
            categoryByMenuItemId.get(recipe.menu_item_id) === category.id,
        ),
        sort,
      ),
    }))
    .filter((group) => group.rows.length > 0);
  return (
    <div className="flex flex-col gap-6">
      <Box className="flex flex-col gap-4">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Category filter"
        >
          <Button
            variant={activeCategory === "all" ? "primary" : "outline"}
            ariaPressed={activeCategory === "all"}
            onClick={() => onCategoryChange("all")}
          >
            All
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={activeCategory === category.id ? "primary" : "outline"}
              ariaPressed={activeCategory === category.id}
              onClick={() => onCategoryChange(category.id)}
            >
              {category.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-2">
            <span className="label text-xs text-muted">Search drinks</span>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search drinks…"
              aria-label="Search drinks"
              className="field"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="label text-xs text-muted">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as RecipeSort)}
              aria-label="Sort drinks"
              className="border border-ink/20 bg-paper px-3 py-2 text-sm text-ink"
            >
              {RECIPE_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Box>
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-muted">No drinks found</p>
      ) : (
        <StaggerGroup className="flex flex-col gap-6">
          {groups.map(({ category, rows }) => (
            <StaggerSection key={category.id}>
              <Box title={category.name}>
                <StaggerList className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((recipe) => (
                    <StaggerItem key={recipe.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelect(recipe.id)}
                        aria-pressed={recipe.id === selectedId}
                        aria-label={recipe.menu_item_name}
                        className={`press flex h-full min-h-24 w-full flex-col items-start justify-between gap-3 rounded-box border bg-paper px-4 py-3 text-left transition-colors ${
                          recipe.id === selectedId
                            ? "border-accent text-accent"
                            : "border-ink/15 hover:border-ink/40"
                        }`}
                      >
                        <span className="text-lg font-medium leading-snug">
                          {recipe.menu_item_name}
                        </span>
                        <span className="text-sm text-muted">
                          {stepHint(recipe.steps)}
                        </span>
                      </button>
                    </StaggerItem>
                  ))}
                </StaggerList>
              </Box>
            </StaggerSection>
          ))}
        </StaggerGroup>
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
    unit: canonicalUnit(line.unit),
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
 * Owner Add/Edit guide form on the shared `Dialog` primitive (focus trap,
 * Escape, backdrop close and focus restore all live there). The linked
 * drink comes from the picker on Add (drinks without guides only — the
 * menu row must exist first) and is fixed while editing (no relinking).
 * Steps plus ingredient rows carry the recipe; qty/unit are optional, so a
 * bare ingredient saves and displays as a plain description line. Rows
 * stack on phone.
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
    <Dialog open onClose={onClose} title={isEdit ? "Edit recipe" : "Add recipe"}>
      <form
        aria-label={isEdit ? "Edit recipe form" : "Add recipe form"}
        className="flex flex-col gap-3"
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
              className="field"
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
            className="field"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm">Ingredients</span>
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_7rem_auto] sm:items-end"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span>Ingredient</span>
                <input
                  type="text"
                  value={row.ingredient}
                  onChange={(event) =>
                    updateRow(row.id, { ingredient: event.target.value })
                  }
                  placeholder="Ingredient or description"
                  aria-label={`Ingredient ${index + 1}`}
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
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
                  className="field"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Unit</span>
                <UnitSelect
                  value={row.unit}
                  onChange={(unit) => updateRow(row.id, { unit })}
                  ariaLabel={`Unit ${index + 1}`}
                />
              </label>
              <Button
                variant="danger"
                ariaLabel={`Remove ingredient ${index + 1}`}
                onClick={() =>
                  setRows((current) =>
                    current.filter((candidate) => candidate.id !== row.id),
                  )
                }
              >
                &minus;
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setRows((current) => [...current, emptyRow()])}
          >
            Add ingredient
          </Button>
          <p className="text-sm text-muted">
            Qty and unit are optional — leave both blank to save a plain
            description line.
          </p>
        </div>
        <div className="mt-1 flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={pending || (!isEdit && drinks.length === 0)}
          >
            Save
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      {formError ?? error ? (
        <p role="alert" className="mt-2 text-sm text-accent">
          {formError ?? error}
        </p>
      ) : null}
    </Dialog>
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
    } catch (err) {
      // Surface the server's {error} text when the API layer provided one;
      // otherwise keep the generic copy.
      const fallback = editing
        ? "Could not save those changes."
        : "Could not save that guide.";
      setSaveError(
        err instanceof Error && err.message !== "" ? err.message : fallback,
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
    } catch (err) {
      setDeleteError(
        err instanceof Error && err.message !== ""
          ? err.message
          : "Could not delete this guide.",
      );
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <Reveal className="flex flex-col gap-3">
          <p className="label text-xs text-muted">Cafe</p>
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
            {/*
              The detail dialog and the add/edit form can never both be
              open: the form takes priority in this single mount point, and
              opening Edit clears `isOpen` first. Each Dialog owns its own
              Escape / backdrop / focus contract — there is no document-level
              key handler doubling it.
            */}
            {form !== null ? (
              <GuideForm
                drinks={addableDrinks}
                initial={form.mode === "edit" ? form.recipe : null}
                pending={savePending}
                error={saveError}
                onClose={handleFormClose}
                onSubmit={(input) => void handleFormSubmit(input)}
              />
            ) : isOpen && selectedId !== null ? (
              <Dialog
                open
                onClose={handleClose}
                title={`Recipe — ${
                  detailQuery.data?.menu_item_name ?? active?.menu_item_name ?? "…"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="label text-xs text-muted">
                    Solace &middot; Recipe
                  </p>
                  <Button variant="outline" onClick={handleClose}>
                    Close
                  </Button>
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
                    <Button
                      variant="outline"
                      onClick={() => {
                        void detailQuery.refetch();
                      }}
                    >
                      Retry
                    </Button>
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
                      <Button
                        variant="primary"
                        onClick={() => {
                          setSaveError(null);
                          setIsOpen(false);
                          setForm({
                            mode: "edit",
                            recipe: detailQuery.data,
                          });
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        disabled={deletePending}
                        onClick={() => void handleDelete()}
                      >
                        {deletePending ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                    {deleteError ? (
                      <p role="alert" className="mt-2 text-sm text-accent">
                        {deleteError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Dialog>
            ) : null}
          </div>
        )}
      </PageFrame>
    </main>
  );
}
