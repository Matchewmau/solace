/**
 * Same-origin menu API fetchers for the LAN tablet build.
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 * Sends the login credential (x-solace-auth header); a 401 clears the
 * session so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export interface Category {
  id: number;
  name: string;
  sort: number;
}

export interface MenuItem {
  id: number;
  category_id: number;
  name: string;
  price_cents: number;
  cost_cents: number;
  active: number;
  variants: string[];
}

export interface MenuItemInput {
  category_id: number;
  name: string;
  price_cents: number;
  variants: string[];
  cost_cents?: number;
  active?: 0 | 1;
}

export interface ItemTotals {
  menu_item_id: number;
  total_qty: number;
  total_revenue_cents: number;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

async function readApiError(res: Response, url: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error !== "") {
      return body.error;
    }
  } catch {
    // Non-JSON body — fall through to the status-based message.
  }
  return `Request failed: ${res.status} ${url}`;
}

async function sendJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await authFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res, url));
  }
  return (await res.json()) as T;
}

export function fetchCategories(): Promise<Category[]> {
  return getJson<Category[]>("/api/categories");
}

export function fetchActiveMenuItems(): Promise<MenuItem[]> {
  return getJson<MenuItem[]>("/api/menu_items?active=1");
}

export function fetchMenuItems(): Promise<MenuItem[]> {
  return getJson<MenuItem[]>("/api/menu_items");
}

export function postMenuItem(input: MenuItemInput): Promise<MenuItem> {
  return sendJson<MenuItem>("/api/menu_items", "POST", input);
}

export function patchMenuItem(id: number, input: Partial<MenuItemInput>): Promise<MenuItem> {
  return sendJson<MenuItem>(`/api/menu_items/${id}`, "PATCH", input);
}

export function fetchItemTotals(id: number): Promise<ItemTotals> {
  return getJson<ItemTotals>(`/api/menu_items/${id}/sales-totals`);
}
