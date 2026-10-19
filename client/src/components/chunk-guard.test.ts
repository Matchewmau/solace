import { describe, expect, it } from "vitest";

/**
 * Entry-chunk guard.
 *
 * POS and the other eager routes must never drag `motion/react` or `three`
 * into the entry chunk. This reads the real source of every file on the
 * eager import chain and asserts none of them import either. Files that do
 * not exist yet are skipped, so this passes today and starts guarding each
 * later task the moment it creates the file.
 *
 * Sources are loaded with Vite's `import.meta.glob(..., "?raw")` (typed via
 * `vite/client`) rather than `node:fs`: this repo has no `@types/node`, and
 * a Node import would break the `tsc` step of `npm run build`.
 */

const FORBIDDEN = /motion\/react|from "three"|from 'three'/;

const sources = import.meta.glob(
  ["../routes.tsx", "../pages/*.tsx", "./*.tsx"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** Eager-chain files, keyed relative to this test (client/src/components). */
const EAGER_CHAIN = [
  "../routes.tsx",
  "../pages/PosPage.tsx",
  "../pages/TodayPage.tsx",
  "../pages/InventoryPage.tsx",
  "../pages/InventoryHistoryPage.tsx",
  "./AppHeader.tsx",
  "./DueAlerts.tsx",
  "./SalesTable.tsx",
  "./ui.tsx",
  "./charts.tsx",
  "./Dialog.tsx",
  "./BottomSheet.tsx",
  "./DataTable.tsx",
  "./PaySheet.tsx",
  "./icons.tsx",
];

describe("eager-chunk guard", () => {
  it.each(EAGER_CHAIN)("%s stays free of motion/react and three", (path) => {
    const source = sources[path];
    if (source === undefined) return; // Not created yet — guarded once it is.
    expect(source).not.toMatch(FORBIDDEN);
  });
});
