import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

/** Desktop rail scope — the phone nav repeats some link names. */
function rail() {
  return within(screen.getByRole("navigation", { name: "Pages" }));
}

/** Phone bottom nav scope. */
function phoneNav() {
  return within(screen.getByRole("navigation", { name: "Primary" }));
}

const tabs = [
  "Dashboard",
  "POS",
  "Guide",
  "Menu",
  "Finance",
  "Today",
  "History",
  "Inventory",
] as const;

const routes: Record<(typeof tabs)[number], string> = {
  Dashboard: "/dashboard",
  POS: "/pos",
  Guide: "/guide",
  Menu: "/menu",
  Finance: "/finance",
  Today: "/today",
  History: "/history",
  Inventory: "/inventory",
};

describe("SideNav shell", () => {
  it("renders all eight tabs in the rail with POS active and no top bar", () => {
    renderAt("/pos");
    for (const name of tabs) {
      expect(rail().getByRole("link", { name }).getAttribute("href")).toBe(
        routes[name],
      );
    }
    const logo = rail().getByRole("img", { name: "Solace Cafe" });
    expect(logo.getAttribute("src")).toBe("/solace-logo.png");
    expect(
      rail().getByRole("link", { name: "POS" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(screen.queryByLabelText("Back to dashboard")).toBeNull();
    expect(screen.queryByText("Solace · Staff")).toBeNull();
  });

  it("keeps the rail pinned with an icon on every item", () => {
    renderAt("/pos");
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(pages.className).toContain("sticky");
    expect(pages.className).toContain("top-0");
    expect(pages.className).toContain("h-screen");
    // Wide enough for icon+word rows, and nothing scrolls inside: every
    // tab shows at once for quick navigation.
    expect(pages.className).toContain("w-44");
    const list = rail().getByRole("link", { name: "Dashboard" }).parentElement;
    expect(list?.className).not.toContain("overflow");
    for (const name of tabs) {
      const link = rail().getByRole("link", { name });
      expect(link.className).toContain("flex-row");
      expect(link.className).not.toContain("flex-col");
      const icon = link.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(
      rail().getByRole("button", { name: "Log out" }).querySelector("svg"),
    ).not.toBeNull();
  });

  it("ships the rail logo asset", () => {
    const assets = import.meta.glob("../../public/solace-logo.png");
    expect(Object.keys(assets)).toHaveLength(1);
  });

  it("hides the phone nav below md and shows the rail from md up", () => {
    renderAt("/pos");
    expect(
      screen.getByRole("navigation", { name: "Primary" }).className,
    ).toContain("md:hidden");
    const pages = screen.getByRole("navigation", { name: "Pages" }).className;
    expect(pages).toContain("hidden");
    expect(pages).toContain("md:flex");
  });

  it.each([
    ["/dashboard", "Dashboard"],
    ["/pos", "POS"],
    ["/guide", "Guide"],
    ["/menu", "Menu"],
    ["/finance", "Finance"],
    ["/today", "Today"],
    ["/history", "History"],
    ["/inventory", "Inventory"],
  ] as const)("%s marks only %s current in the rail", (path, name) => {
    renderAt(path);
    const active = rail().getByRole("link", { name });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("bg-accent");
    expect(active.className).toContain("rounded-box");
    for (const other of tabs) {
      if (other === name) continue;
      expect(
        rail().getByRole("link", { name: other }).getAttribute("aria-current"),
      ).toBeNull();
      expect(
        rail().getByRole("link", { name: other }).className,
      ).not.toContain("bg-accent");
    }
  });

  it("marks Finance current on /finance/history deep links", () => {
    renderAt("/finance/history?loan=1");
    expect(
      rail().getByRole("link", { name: "Finance" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks Inventory current on /inventory/history deep links", () => {
    renderAt("/inventory/history");
    expect(
      rail()
        .getByRole("link", { name: "Inventory" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("marks no rail tab current off the tabbed routes", () => {
    renderAt("/showcase");
    for (const name of tabs)
      expect(
        rail().getByRole("link", { name }).getAttribute("aria-current"),
      ).toBeNull();
  });

  it("renders no nav on /login", () => {
    renderAt("/login");
    expect(screen.getByText("Login")).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("link", { name: "POS" })).toBeNull();
  });

  it("logout in the rail clears the session and lands on login", () => {
    setStoredAuth("solace123");
    renderAt("/pos");
    fireEvent.click(rail().getByRole("button", { name: "Log out" }));
    expect(screen.getByText("Login")).toBeDefined();
    expect(getStoredAuth()).toBeNull();
  });
});

describe("BottomNav", () => {
  it("shows the four phone targets with POS active and a More trigger", () => {
    renderAt("/pos");
    expect(
      phoneNav().getByRole("link", { name: "POS" }).getAttribute("href"),
    ).toBe("/pos");
    expect(
      phoneNav().getByRole("link", { name: "Today" }).getAttribute("href"),
    ).toBe("/today");
    expect(
      phoneNav().getByRole("link", { name: "Money" }).getAttribute("href"),
    ).toBe("/finance");
    expect(phoneNav().getByRole("button", { name: "More" })).toBeDefined();
    expect(
      phoneNav().getByRole("link", { name: "POS" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      phoneNav()
        .getByRole("link", { name: "Today" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks Money current on finance drill-in routes", () => {
    renderAt("/finance/loans");
    expect(
      phoneNav()
        .getByRole("link", { name: "Money" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("renders no duplicate Log out while the More sheet is closed", () => {
    renderAt("/pos");
    expect(screen.queryByRole("dialog", { name: "More pages" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Log out" })).toHaveLength(1);
  });

  it("opens the More sheet listing the overflow pages and Log out", () => {
    renderAt("/pos");
    fireEvent.click(phoneNav().getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More pages" });
    for (const name of [
      "Dashboard",
      "Guide",
      "Menu",
      "History",
      "Inventory",
    ] as const) {
      expect(within(sheet).getByRole("link", { name }).getAttribute("href")).toBe(
        routes[name],
      );
    }
    expect(within(sheet).getByRole("button", { name: "Log out" })).toBeDefined();
  });

  it("logs out from the More sheet and lands on login", () => {
    setStoredAuth("solace123");
    renderAt("/pos");
    fireEvent.click(phoneNav().getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More pages" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Log out" }));
    expect(screen.getByText("Login")).toBeDefined();
    expect(getStoredAuth()).toBeNull();
  });
});
