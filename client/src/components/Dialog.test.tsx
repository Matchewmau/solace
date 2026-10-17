import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog } from "./Dialog";

afterEach(() => cleanup());

function renderOpen(onClose = vi.fn()) {
  render(
    <Dialog open onClose={onClose} title="Add bill">
      <button type="button">First</button>
      <button type="button">Last</button>
    </Dialog>,
  );
  return onClose;
}

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={vi.fn()} title="Add bill">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Body")).toBeNull();
  });

  it("shows the labelled panel and moves focus inside it when open", () => {
    renderOpen();
    const panel = screen.getByRole("dialog", { name: "Add bill" });
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("calls onClose once on Escape", () => {
    const onClose = renderOpen();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click but not on panel click", () => {
    const onClose = renderOpen();
    fireEvent.click(screen.getByRole("dialog", { name: "Add bill" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on close", () => {
    render(<button type="button">Open</button>);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();

    const { rerender } = render(
      <Dialog open onClose={vi.fn()} title="Add bill">
        <button type="button">First</button>
      </Dialog>,
    );
    expect(document.activeElement).not.toBe(opener);

    rerender(
      <Dialog open={false} onClose={vi.fn()} title="Add bill">
        <button type="button">First</button>
      </Dialog>,
    );
    expect(document.activeElement).toBe(opener);
  });

  it("wraps Tab and Shift-Tab within the panel's focusable elements", () => {
    renderOpen();
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
