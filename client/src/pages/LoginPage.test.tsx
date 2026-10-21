import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../components/AuthProvider";
import { clearStoredAuth } from "../lib/auth";
import LoginPage from "./LoginPage";

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

/** Stub only the login POST; any other /api call is a test bug. */
function stubLogin(succeeds: boolean) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/auth/login" && init?.method === "POST") {
      return succeeds
        ? ok({ ok: true })
        : ok({ ok: false, error: "invalid credentials" }, 401);
    }
    throw new Error(`unexpected fetch ${u} ${init?.method ?? "GET"}`);
  }) as typeof fetch;
}

/** /login renders the real page; /dashboard is a stub we can navigate to. */
function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<h1>Dashboard</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("renders the form with the username focused and the LAN note", () => {
    stubLogin(true);
    renderLogin();

    expect(screen.getByLabelText("Username").className).toContain("field");
    expect(screen.getByRole("heading", { name: "Login" })).toBeDefined();
    expect(screen.getByLabelText("Username")).toBe(document.activeElement);
    expect(screen.getByLabelText("Password")).toHaveProperty("type", "password");
    expect(screen.getByRole("button", { name: "Log in" })).toBeDefined();
    expect(
      screen.getByText(
        "Open orders live in this browser — use one address (the LAN IP) consistently.",
      ),
    ).toBeDefined();
  });

  it("flips the password field between hidden and visible", () => {
    stubLogin(true);
    renderLogin();

    const show = screen.getByRole("button", { name: "Show password" });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Password")).toHaveProperty("type", "password");

    fireEvent.click(show);
    const hide = screen.getByRole("button", { name: "Hide password" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Password")).toHaveProperty("type", "text");

    fireEvent.click(hide);
    const showAgain = screen.getByRole("button", { name: "Show password" });
    expect(showAgain.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Password")).toHaveProperty("type", "password");
  });

  it("shows the alert and stays on login when the credentials fail", async () => {
    stubLogin(false);
    renderLogin();

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "solace" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("invalid credentials");
    expect(screen.getByRole("heading", { name: "Login" })).toBeDefined();
  });

  it("navigates to the dashboard on a successful login", async () => {
    stubLogin(true);
    renderLogin();

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
  });
});
