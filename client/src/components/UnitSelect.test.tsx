import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnitSelect } from "./UnitSelect";

afterEach(() => cleanup());

function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll("option")).map(
    (option) => option.textContent?.trim() ?? "",
  );
}

describe("UnitSelect", () => {
  it("offers No unit plus the standard units with spelled-out labels", () => {
    render(<UnitSelect value="" onChange={() => {}} ariaLabel="Unit" />);
    const select = screen.getByLabelText("Unit") as HTMLSelectElement;

    expect(select.tagName).toBe("SELECT");
    const labels = optionLabels(select);
    expect(labels[0]).toBe("No unit");
    expect(labels).toContain("g (grams)");
    expect(labels).toContain("ml (milliliters)");
    expect(labels).toContain("L (liters)");
    expect(labels).toContain("pack");
    expect(labels).toContain("bottle");
    expect(select.value).toBe("");
  });

  it("keeps a stored non-standard unit selectable until the user changes it", () => {
    render(<UnitSelect value="3333" onChange={() => {}} ariaLabel="Unit" />);
    const select = screen.getByLabelText("Unit") as HTMLSelectElement;

    expect(select.value).toBe("3333");
    expect(Array.from(select.querySelectorAll("option")).map((o) => o.value)).toContain(
      "3333",
    );
  });

  it("reports the chosen unit", () => {
    const onChange = vi.fn();
    render(<UnitSelect value="" onChange={onChange} ariaLabel="Unit" />);
    const select = screen.getByLabelText("Unit") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "ml" } });
    expect(onChange).toHaveBeenCalledWith("ml");
  });

  it("carries a form field name for FormData-based dialogs", () => {
    render(
      <UnitSelect name="unit" value="g" onChange={() => {}} ariaLabel="Unit" />,
    );
    const select = screen.getByLabelText("Unit") as HTMLSelectElement;

    expect(select.name).toBe("unit");
    expect(select.value).toBe("g");
  });
});
