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

export interface RecipeLineInput {
  ingredient: string;
  qty: number | null;
  unit: string | null;
}

export interface RecipeInput {
  menu_item_id: number;
  steps: string;
  lines: RecipeLineInput[];
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

async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
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

export function fetchRecipes(): Promise<Recipe[]> {
  return getJson<Recipe[]>("/api/recipes");
}

export function fetchRecipe(id: number): Promise<RecipeDetail> {
  return getJson<RecipeDetail>(`/api/recipes/${id}`);
}

export function postRecipe(input: RecipeInput): Promise<RecipeDetail> {
  return sendJson<RecipeDetail>("/api/recipes", "POST", input);
}

/** Edit steps/lines for the same linked drink. Relinking is rejected server-side. */
export function patchRecipe(
  id: number,
  input: RecipeInput,
): Promise<RecipeDetail> {
  return sendJson<RecipeDetail>(`/api/recipes/${id}`, "PATCH", input);
}

/** Delete the guide only — the linked menu item stays. 204 on success. */
export async function deleteRecipe(id: number): Promise<void> {
  const res = await authFetch(`/api/recipes/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readApiError(res, `/api/recipes/${id}`));
  }
}
