import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { routes } from "../routes";
import {
  AUTH_STORAGE_KEY,
  authHeaders,
  clearStoredAuth,
  getStoredAuth,
  loginRequest,
  setStoredAuth,
} from "../lib/auth";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredAuth();
  localStorage.clear();
});

function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

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

describe("auth lib", () => {
  it("attaches no header when logged out, x-solace-auth once stored", () => {
    expect(getStoredAuth()).toBeNull();
    expect(authHeaders()).toEqual({});
    setStoredAuth("solace123");
    expect(getStoredAuth()).toBe("solace123");
    expect(authHeaders()).toEqual({ "x-solace-auth": "solace123" });
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBe("solace123");
  });

  it("clears the session from memory and localStorage", () => {
    setStoredAuth("solace123");
    clearStoredAuth();
    expect(getStoredAuth()).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("loginRequest posts username/password and parses ok/error", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/auth/login" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        seen.push({ url: u, body });
        if (body.username === "solace" && body.password === "solace123") {
          return ok({ ok: true });
        }
        return ok({ ok: false, error: "invalid credentials" }, 401);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    const good = await loginRequest("solace", "solace123");
    expect(good).toEqual({ ok: true });
    const bad = await loginRequest("solace", "nope");
    expect(bad).toEqual({ ok: false, error: "invalid credentials" });
    expect(seen[0].body).toEqual({
      username: "solace",
      password: "solace123",
    });
  });
});

describe("login guard", () => {
  it("logged-out deep link lands on login without calling /api", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;

    renderAt("/inventory");
    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeDefined();
    expect(calls).toEqual([]);
  });

  it("login success lands on the dashboard and keeps the session", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/auth/login" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { password?: string };
        if (body.password === "solace123") return ok({ ok: true });
        return ok({ ok: false, error: "invalid credentials" }, 401);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    renderAt("/login");
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "solace" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "solace123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeDefined();
    expect(getStoredAuth()).toBe("solace123");
  });

  it("bad combo shows the server error and stays on login", async () => {
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u === "/api/auth/login" && init?.method === "POST") {
        return ok({ ok: false, error: "invalid credentials" }, 401);
      }
      throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
    }) as typeof fetch;

    renderAt("/login");
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "solace" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await screen.findByText("invalid credentials");
    expect(screen.getByRole("heading", { name: "Login" })).toBeDefined();
    expect(getStoredAuth()).toBeNull();
  });

  it("visiting /login while logged in redirects to /dashboard", async () => {
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async (url: unknown) => {
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;

    renderAt("/login");
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeDefined();
  });

  it("reload stays in via the localStorage mirror", async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, "solace123");
    globalThis.fetch = vi.fn(async (url: unknown) => {
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;

    renderAt("/dashboard");
    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Login" })).toBeNull();
  });

  it("any API 401 redirects to login and clears the session", async () => {
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith("/api/dashboard")) {
        return ok({ error: "auth required" }, 401);
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    renderAt("/dashboard");
    expect(
      await screen.findByRole("heading", { name: "Login" }, { timeout: 5000 }),
    ).toBeDefined();
    expect(getStoredAuth()).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("shared-header logout clears the session and lands on login", async () => {
    setStoredAuth("solace123");
    globalThis.fetch = vi.fn(async (url: unknown) => {
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;

    renderAt("/dashboard");
    await screen.findByRole("heading", { name: "Dashboard" });
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(
      await screen.findByRole("heading", { name: "Login" }),
    ).toBeDefined();
    expect(getStoredAuth()).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});
