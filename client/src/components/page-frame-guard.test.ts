import { describe, expect, it } from "vitest";

/**
 * Page-frame guard.
 *
 * Every standard page renders its content through the shared PageFrame —
 * one max width, one margin rhythm, one left/right key line — so pages
 * cannot drift apart again. No page may carry a per-page frame width or
 * the retired "· LAN" eyebrow. Login (centered login card) and POS
 * (full-bleed register) are the only documented exceptions.
 *
 * Sources load via Vite `?raw` globs, same convention as chunk-guard.test.ts
 * (this repo has no `@types/node`, and a Node import would break `tsc`).
 */

const sources = import.meta.glob(
  ["../routes.tsx", "../pages/*.tsx"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The standard framed pages, keyed relative to client/src/components. */
const STANDARD_PAGES = [
  "../pages/DashboardPage.tsx",
  "../pages/FinancePage.tsx",
  "../pages/FinanceBillsPage.tsx",
  "../pages/FinanceExpensesPage.tsx",
  "../pages/FinanceHistoryPage.tsx",
  "../pages/FinanceLoansPage.tsx",
  "../pages/FinancePayablesPage.tsx",
  "../pages/GuidePage.tsx",
  "../pages/HistoryPage.tsx",
  "../pages/InventoryPage.tsx",
  "../pages/InventoryHistoryPage.tsx",
  "../pages/MenuPage.tsx",
  "../pages/ShowcasePage.tsx",
  "../pages/TodayPage.tsx",
];

/** Frame widths belong to PageFrame only. */
const FRAME_WIDTH = /max-w-(?:3xl|4xl|5xl|6xl|7xl)/;

/** The retired eyebrow token, in JSX-entity and literal-dot spellings. */
const LAN_EYEBROW = /middot; LAN|· LAN/;

describe("page-frame guard", () => {
  it.each(STANDARD_PAGES)("%s renders through the shared PageFrame", (path) => {
    const source = sources[path];
    expect(source, `${path} should exist`).toBeDefined();
    expect(source).toContain("<PageFrame");
    expect(source).not.toMatch(FRAME_WIDTH);
  });

  it("the lazy-route fallback renders through the shared PageFrame", () => {
    const source = sources["../routes.tsx"];
    expect(source).toBeDefined();
    expect(source).toContain("<PageFrame");
    expect(source).not.toMatch(FRAME_WIDTH);
  });

  it("no page shows the retired LAN eyebrow", () => {
    for (const [path, source] of Object.entries(sources)) {
      expect(source, `${path} should not show the LAN eyebrow`).not.toMatch(
        LAN_EYEBROW,
      );
    }
  });
});
