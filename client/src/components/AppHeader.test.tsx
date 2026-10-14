import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./AuthProvider";
import { AppHeader } from "./AppHeader";

afterEach(() => cleanup());

function renderHeaderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppHeader />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("BackToDashboard", () => {
  const subpages = ["/menu", "/pos", "/guide", "/inventory", "/finance", "/showcase"];

  for (const path of subpages) {
    it(`renders a back link to /dashboard on ${path}`, () => {
      renderHeaderAt(path);
      const back = screen.getByLabelText("Back to dashboard");
      expect(back.getAttribute("href")).toBe("/dashboard");
    });
  }

  it("renders no back button on the dashboard", () => {
    renderHeaderAt("/dashboard");
    expect(screen.queryByLabelText("Back to dashboard")).toBeNull();
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
  });
});
