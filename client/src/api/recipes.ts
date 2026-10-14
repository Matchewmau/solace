/**
 * Same-origin recipe API fetchers for the /guide barista guide.
 * Relative URLs only — no CDN, no runtime fetches outside /api.
 * Sends the login credential (x-solace-auth header); a 401 clears the
 * session so the route guard lands on /login.
 */
import { authFetch } from "../lib/auth";

export interface Recipe {
  id: number;
  menu_item_id: number;
  menu_item_name: string;
  steps: string;
}

export interface RecipeLine {
  id: number;
  ingredient: string;
  qty: number | null;
  unit: string | null;
}

export interface RecipeDetail extends Recipe {
  lines: RecipeLine[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

export function fetchRecipes(): Promise<Recipe[]> {
  return getJson<Recipe[]>("/api/recipes");
}

export function fetchRecipe(id: number): Promise<RecipeDetail> {
  return getJson<RecipeDetail>(`/api/recipes/${id}`);
}
