import type { Category } from "../api/menu";

/**
 * Categories in display order: `sort`, then name.
 *
 * Lives in lib/ so the POS page can import it WITHOUT importing
 * MenuPage (which carries motion). POS modules must stay
 * motion/three-free.
 */
export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(
    (a, b) => a.sort - b.sort || a.name.localeCompare(b.name),
  );
}
