import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge, Box, Button, EmptyState, StatChip } from "./ui";

afterEach(() => cleanup());

describe("Badge", () => {
  it("colors danger tone with text-danger", () => {
    render(<Badge tone="danger">Voided</Badge>);
    expect(screen.getByText("Voided").className).toContain("text-danger");
  });

  it("colors ok tone with text-ok", () => {
    render(<Badge tone="ok">Paid</Badge>);
    expect(screen.getByText("Paid").className).toContain("text-ok");
  });

  it("defaults to the muted tone", () => {
    render(<Badge>Draft</Badge>);
    expect(screen.getByText("Draft").className).toContain("text-muted");
  });
});

describe("StatChip", () => {
  it("shows label and value and tones the value", () => {
    render(<StatChip label="Cash" value="₱140" tone="ok" />);
    expect(screen.getByText("Cash")).toBeDefined();
    expect(screen.getByText("₱140").className).toContain("text-ok");
  });
});

describe("Button", () => {
  it("disables and marks busy while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("uses the touch target size for lg", () => {
    render(<Button size="lg">Pay</Button>);
    expect(screen.getByRole("button", { name: "Pay" }).className).toContain(
      "min-h-11",
    );
  });

  it("borders the danger variant", () => {
    render(<Button variant="danger">Void</Button>);
    expect(screen.getByRole("button", { name: "Void" }).className).toContain(
      "border-danger",
    );
  });
});

describe("EmptyState", () => {
  it("shows the message", () => {
    render(<EmptyState message="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeDefined();
  });
});

describe("Box", () => {
  it("renders the title heading and children", () => {
    render(
      <Box title="Bills">
        <p>Water bill</p>
      </Box>,
    );
    expect(screen.getByRole("heading", { name: "Bills" })).toBeDefined();
    expect(screen.getByText("Water bill")).toBeDefined();
  });
});
