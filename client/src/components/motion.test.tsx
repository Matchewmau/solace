import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  Reveal,
  StaggerGroup,
  StaggerItem,
  StaggerList,
  StaggerSection,
} from "./motion";

afterEach(() => cleanup());

describe("motion primitives (non-POS only)", () => {
  it("Reveal renders its content", () => {
    render(
      <Reveal>
        <h1>Quiet heading</h1>
      </Reveal>,
    );
    expect(screen.getByRole("heading", { name: "Quiet heading" })).toBeDefined();
  });

  it("StaggerList renders list items with content", () => {
    render(
      <StaggerList ariaLabel="Drinks">
        <StaggerItem>Cortado</StaggerItem>
        <StaggerItem>Latte</StaggerItem>
      </StaggerList>,
    );
    expect(screen.getByLabelText("Drinks")).toBeDefined();
    expect(screen.getByText("Cortado")).toBeDefined();
    expect(screen.getByText("Latte")).toBeDefined();
  });

  it("StaggerList children start hidden via the stagger item variant", () => {
    render(
      <StaggerList ariaLabel="Drinks">
        <StaggerItem>Cortado</StaggerItem>
      </StaggerList>,
    );
    const item = screen.getByLabelText("Drinks").querySelector("li");
    // Pre-animation state comes from the shared itemVariants.hidden (opacity 0, y 8).
    expect(item?.style.opacity).toBe("0");
    expect(item?.style.transform).toBe("translateY(8px)");
  });

  it("StaggerGroup renders section children with content", () => {
    render(
      <StaggerGroup>
        <StaggerSection ariaLabel="Net">
          <h2>Net</h2>
        </StaggerSection>
      </StaggerGroup>,
    );
    expect(screen.getByLabelText("Net")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Net" })).toBeDefined();
  });
});
