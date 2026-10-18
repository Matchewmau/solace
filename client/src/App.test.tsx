import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import { brand } from "./brand";
import { AuthProvider } from "./components/AuthProvider";
import { routes } from "./routes";
import { clearStoredAuth, setStoredAuth } from "./lib/auth";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearStoredAuth();
  localStorage.clear();
});

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Solace shell", () => {
  it("uses the verbatim brand tokens", () => {
    expect(brand).toEqual({
      ink: "#141210",
      paper: "#faf8f4",
      accent: "#8a5a2b",
      muted: "#6f6a61",
    });
  });

  it("redirects logged-out visits to the login page", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Login" }).textContent,
    ).toBe("Login");
  });

  it("renders the branded shell page with logout when logged in", () => {
    setStoredAuth("solace123");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Dashboard" }).textContent,
    ).toBe("Dashboard");
    // Exactly one visible "Log out" (the rail) — the More sheet is closed.
    expect(screen.getAllByRole("button", { name: "Log out" })).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeDefined();
  });

  it("showcase renders inside the authed layout (global rail present)", async () => {
    setStoredAuth("solace123");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderAt("/showcase");
    expect(
      await screen.findByRole("heading", { name: "Showcase" }),
    ).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
  });

  it("inventory renders inside the authed layout (global rail present)", async () => {
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }) as Response) as typeof fetch;
    renderAt("/inventory");
    expect(
      await screen.findByRole("heading", { name: "Inventory" }),
    ).toBeDefined();
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
  });
});
