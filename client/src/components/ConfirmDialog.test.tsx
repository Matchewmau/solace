import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("ConfirmDialog", () => {
  it("confirms, shows pending, and shows the error", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog open title="Delete Meralco" message="This removes the bill." pending={false} error={null} onCancel={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(
      <ConfirmDialog open title="Delete Meralco" message="This removes the bill." pending error="offline" onCancel={vi.fn()} onConfirm={onConfirm} />,
    );
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("offline");
  });

  it("cancels from the Cancel button", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete Meralco" message="This removes the bill." pending={false} error={null} onCancel={onCancel} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
