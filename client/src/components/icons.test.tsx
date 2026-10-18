import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  BoxIcon,
  BookIcon,
  CartIcon,
  ChartIcon,
  GridIcon,
  LogoutIcon,
  MoreIcon,
  ReceiptIcon,
  WalletIcon,
} from "./icons";

afterEach(() => cleanup());

/** Every icon in the global set, exercised through the same smoke contract. */
const icons: Array<[string, ComponentType<{ className?: string }>]> = [
  ["CartIcon", CartIcon],
  ["ReceiptIcon", ReceiptIcon],
  ["WalletIcon", WalletIcon],
  ["BookIcon", BookIcon],
  ["GridIcon", GridIcon],
  ["ChartIcon", ChartIcon],
  ["BoxIcon", BoxIcon],
  ["MoreIcon", MoreIcon],
  ["LogoutIcon", LogoutIcon],
];

describe("icon set", () => {
  it.each(icons)(
    "%s renders one hidden, stroke-drawn 20px svg carrying the class",
    (_name, Icon) => {
      const { container } = render(<Icon className="h-5 w-5" />);
      const svg = container.querySelector("svg");

      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 20 20");
      expect(svg?.getAttribute("fill")).toBe("none");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.classList.contains("h-5")).toBe(true);
    },
  );
});
