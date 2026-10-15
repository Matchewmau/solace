import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { AuthedLayout } from "./AppHeader";
import { clearStoredAuth, getStoredAuth, setStoredAuth } from "../lib/auth";

afterEach(() => {
  cleanup();
  clearStoredAuth();
  localStorage.clear();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>Login</p>} />
          <Route element={<AuthedLayout />}>
            <Route path="*" element={<p>Page</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const tabs = [
  "Dashboard",
  "POS",
  "Guide",
  "Menu",
  "Finance",
  "Today",
  "History",
] as const;

const routes: Record<(typeof tabs)[number], string> = {
  Dashboard: "/dashboard",
  POS: "/pos",
  Guide: "/guide",
  Menu: "/menu",
  Finance: "/finance",
  Today: "/today",
  History: "/history",
};

describe("SideNav shell", () => {
  it("renders all seven tabs with POS active and no top bar", () => {
    renderAt("/pos");
    for (const name of tabs) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
        routes[name],
      );
    }
    expect(
      screen.getByRole("link", { name: "POS" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByLabelText("Back to dashboard")).toBeNull();
    expect(screen.queryByText("Solace · Staff")).toBeNull();
  });

  it.each([
    ["/dashboard", "Dashboard"],
    ["/pos", "POS"],
    ["/guide", "Guide"],
    ["/menu", "Menu"],
    ["/finance", "Finance"],
    ["/today", "Today"],
    ["/history", "History"],
  ] as const)("marks only %s current on %s", (path, name) => {
    renderAt(path);
    expect(
      screen.getByRole("link", { name }).getAttribute("aria-current"),
    ).toBe("page");
    for (const other of tabs) {
      if (other === name) continue;
      expect(
        screen.getByRole("link", { name: other }).getAttribute("aria-current"),
      ).toBeNull();
    }
  });

  it("marks Finance current on /finance/history deep links", () => {
    renderAt("/finance/history?loan=1");
    expect(
      screen.getByRole("link", { name: "Finance" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks no tab current off the tabbed routes", () => {
    renderAt("/inventory");
    for (const name of tabs)
      expect(
        screen.getByRole("link", { name }).getAttribute("aria-current"),
      ).toBeNull();
  });

  it("renders no rail on /login", () => {
    renderAt("/login");
    expect(screen.getByText("Login")).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: "POS" })).toBeNull();
  });

  it("logout clears the session and lands on login", () => {
    setStoredAuth("solace123");
    renderAt("/pos");
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByText("Login")).toBeDefined();
    expect(getStoredAuth()).toBeNull();
  });
});
