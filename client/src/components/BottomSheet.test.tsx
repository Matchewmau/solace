import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BottomSheet } from "./BottomSheet";

afterEach(() => cleanup());

function renderOpen(onClose = vi.fn()) {
  render(
    <BottomSheet open onClose={onClose} title="More">
      <button type="button">Settings</button>
    </BottomSheet>,
  );
  return onClose;
}

describe("BottomSheet", () => {
  it("renders nothing when closed", () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()} title="More">
        <p>Body</p>
      </BottomSheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Body")).toBeNull();
  });

  it("shows the labelled panel with the sheet entrance when open", () => {
    renderOpen();
    const panel = screen.getByRole("dialog", { name: "More" });
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.className).toContain("sheet-up");
    expect(panel.className).toContain("bottom-0");
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("calls onClose once on Escape", () => {
    const onClose = renderOpen();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click but not on panel click", () => {
    const onClose = renderOpen();
    fireEvent.click(screen.getByRole("dialog", { name: "More" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
