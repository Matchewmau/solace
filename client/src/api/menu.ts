/**
 * Same-origin menu API fetchers for the LAN tablet build.
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 */

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
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

export function fetchCategories(): Promise<Category[]> {
  return getJson<Category[]>("/api/categories");
}

export function fetchActiveMenuItems(): Promise<MenuItem[]> {
  return getJson<MenuItem[]>("/api/menu_items?active=1");
}
