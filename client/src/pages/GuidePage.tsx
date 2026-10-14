import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchRecipe,
  fetchRecipes,
  type Recipe,
  type RecipeLine,
} from "../api/recipes";
import { Reveal, StaggerItem, StaggerList } from "../components/motion";

/** Case-insensitive substring match on the drink name. */
export function filterRecipes(recipes: Recipe[], query: string): Recipe[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return recipes;
  return recipes.filter((recipe) =>
    recipe.menu_item_name.toLowerCase().includes(needle),
  );
}

export function formatLine(line: RecipeLine): string {
  if (line.qty === null || line.qty === undefined) return line.ingredient;
  const amount = line.unit ? `${line.qty} ${line.unit}` : String(line.qty);
  return `${line.ingredient} — ${amount}`;
}

interface BrowserProps {
  recipes: Recipe[];
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
 * Pure list + search browser over mocked-or-fetched recipes.
 * The selected drink's detail is fetched by id (see GuidePage).
 */
export function GuideBrowser({
  recipes,
  query,
  onQueryChange,
  selectedId,
  onSelect,
}: BrowserProps & {
  query: string;
  onQueryChange: (value: string) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const filtered = filterRecipes(recipes, query);
  return (
    <div className="flex flex-col gap-6">
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

export default function GuidePage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listQuery = useQuery({ queryKey: ["recipes"], queryFn: fetchRecipes });

  const recipes = listQuery.data ?? [];
  const active = recipes.find((recipe) => recipe.id === selectedId) ?? null;

  const detailQuery = useQuery({
    queryKey: ["recipe", selectedId],
    queryFn: () => fetchRecipe(selectedId as number),
    enabled: selectedId !== null,
  });

  const isLoading = listQuery.isLoading;
  const isError = listQuery.isError;

  function handleSelect(id: number) {
    setSelectedId(id);
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

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
              }}
            >
              Retry
            </button>
          </div>
        ) : recipes.length === 0 ? (
          <p className="py-16 text-center text-muted">No recipes available</p>
        ) : (
          <div className="flex flex-col gap-10">
            <GuideBrowser
              recipes={recipes}
              query={query}
              onQueryChange={setQuery}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
            {isOpen && selectedId !== null ? (
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
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
