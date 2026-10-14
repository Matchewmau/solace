import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { brand } from "./brand";

describe("Solace shell", () => {
  it("uses the verbatim brand tokens", () => {
    expect(brand).toEqual({
      ink: "#141210",
      paper: "#faf8f4",
      accent: "#8a5a2b",
      muted: "#6f6a61",
    });
  });

  it("renders the branded shell page", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Dashboard" }).textContent,
    ).toBe("Dashboard");
  });
});
