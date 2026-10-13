/**
 * POS cart state (Zustand).
 *
 * Spec ruling (open item #2): GCash ref numbers are skipped, so the
 * checkout payload is exactly {payment, items} — cart lines hold only
 * menu_item_id + qty.
 */
import { create } from "zustand";
import type { MenuItem } from "../api/menu";

export interface CartLine {
  menu_item_id: number;
  qty: number;
}

interface CartState {
  lines: CartLine[];
  add: (menuItemId: number) => void;
  setQty: (menuItemId: number, qty: number) => void;
  remove: (menuItemId: number) => void;
  clear: () => void;
}

export const useCart = create<CartState>()((set) => ({
  lines: [],
  add: (menuItemId) =>
    set((state) => {
      const existing = state.lines.find(
        (line) => line.menu_item_id === menuItemId,
      );
      if (existing) {
        return {
          lines: state.lines.map((line) =>
            line.menu_item_id === menuItemId
              ? { ...line, qty: line.qty + 1 }
              : line,
          ),
        };
      }
      return {
        lines: [...state.lines, { menu_item_id: menuItemId, qty: 1 }],
      };
    }),
  setQty: (menuItemId, qty) =>
    set((state) => {
      if (!Number.isInteger(qty) || qty < 1) {
        return {
          lines: state.lines.filter(
            (line) => line.menu_item_id !== menuItemId,
          ),
        };
      }
      const existing = state.lines.find(
        (line) => line.menu_item_id === menuItemId,
      );
      if (!existing) {
        return {
          lines: [...state.lines, { menu_item_id: menuItemId, qty }],
        };
      }
      return {
        lines: state.lines.map((line) =>
          line.menu_item_id === menuItemId ? { ...line, qty } : line,
        ),
      };
    }),
  remove: (menuItemId) =>
    set((state) => ({
      lines: state.lines.filter((line) => line.menu_item_id !== menuItemId),
    })),
  clear: () => set({ lines: [] }),
}));

/**
 * Client-side cart total from menu prices (display estimate only —
 * the binding total is computed server-side on POST /api/sales).
 */
export function cartTotalCents(
  lines: CartLine[],
  items: MenuItem[],
): number {
  const prices = new Map(items.map((item) => [item.id, item.price_cents]));
  return lines.reduce(
    (sum, line) => sum + (prices.get(line.menu_item_id) ?? 0) * line.qty,
    0,
  );
}
