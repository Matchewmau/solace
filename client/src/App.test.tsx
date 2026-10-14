import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";
import { brand } from "./brand";
import { clearStoredAuth, setStoredAuth } from "./lib/auth";

afterEach(() => {
  cleanup();
  clearStoredAuth();
  localStorage.clear();
});

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
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
  });
});
