import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaySheet } from "./PaySheet";

afterEach(() => cleanup());

/** Cash sheet for a ₱140.00 sale; Confirm is only enabled once received ≥ total. */
function renderSheet(overrides: Partial<Parameters<typeof PaySheet>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <PaySheet
      totalCents={14000}
      pending={false}
      error=""
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm };
}

describe("PaySheet cash calculator", () => {
  it("opens on the total with Confirm disabled and a red short readout", () => {
    renderSheet();

    const confirm = screen.getByRole("button", {
      name: "Confirm — paid ₱140.00",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const short = screen.getByText("short ₱140.00");
    expect(short.className).toContain("text-danger");
  });

  it("tapping the ₱200 chip shows ₱60.00 change in green and enables Confirm", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "₱200" }));

    const change = screen.getByText("₱60.00");
    expect(change.className).toContain("text-ok");
    expect(
      (screen.getByRole("button", {
        name: "Confirm — paid ₱140.00",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("the Exact chip gives ₱0.00 change and enables Confirm", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Exact ₱140.00" }));

    const change = screen.getByText("₱0.00");
    expect(change.className).toContain("text-ok");
    expect(
      (screen.getByRole("button", {
        name: "Confirm — paid ₱140.00",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("a custom amount below the total reads short and keeps Confirm disabled", () => {
    renderSheet();

    fireEvent.change(screen.getByLabelText("Amount received"), {
      target: { value: "100" },
    });

    const short = screen.getByText("short ₱40.00");
    expect(short.className).toContain("text-danger");
    expect(
      (screen.getByRole("button", {
        name: "Confirm — paid ₱140.00",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("Confirm passes the received cents and Cancel calls onCancel", () => {
    const { onCancel, onConfirm } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "₱200" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm — paid ₱140.00" }),
    );
    expect(onConfirm).toHaveBeenCalledWith(20000);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("pending disables Confirm and shows the busy label", () => {
    renderSheet({ pending: true });

    const confirm = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("Escape and the backdrop cancel the sheet", () => {
    const { onCancel } = renderSheet();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
