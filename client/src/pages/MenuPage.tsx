import { useQuery } from "@tanstack/react-query";
import {
  fetchActiveMenuItems,
  fetchCategories,
  type Category,
  type MenuItem,
} from "../api/menu";
import { formatPeso } from "../lib/formatPeso";
import { sortCategories } from "../lib/sortCategories";
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

/**
 * Pure type-forward showcase: category headings with their items.
 * Inactive items are never shown (defensive filter; the query
 * already requests `?active=1`).
 */
export function MenuShowcase({ categories, items }: ShowcaseProps) {
  const visible = items.filter((item) => item.active === 1);
  if (categories.length === 0 || visible.length === 0) {
    return <p className="py-16 text-center text-muted">No items available</p>;
  }
  const byCategory = new Map<number, MenuItem[]>();
  for (const item of visible) {
    const list = byCategory.get(item.category_id) ?? [];
    list.push(item);
    byCategory.set(item.category_id, list);
  }
  return (
    <StaggerGroup className="flex flex-col gap-12">
      {sortCategories(categories).map((category) => (
        <StaggerSection key={category.id} ariaLabel={category.name}>
          <p className="label text-xs text-muted">Solace &middot; Menu</p>
          <h2 className="mt-2 text-2xl font-semibold">{category.name}</h2>
          <StaggerList
            className="mt-6 flex flex-col gap-5"
          >
            {(byCategory.get(category.id) ?? []).map((item) => (
              <StaggerItem
                key={item.id}
                className="flex items-baseline justify-between gap-6"
              >
                <span className="text-lg">{item.name}</span>
                <span className="text-lg font-semibold text-accent">
                  {formatPeso(item.price_cents)}
                </span>
              </StaggerItem>
            ))}
          </StaggerList>
        </StaggerSection>
      ))}
    </StaggerGroup>
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
