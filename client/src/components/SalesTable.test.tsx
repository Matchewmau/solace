import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SalesTable from "./SalesTable";
import type { SaleRow } from "../api/sales";

afterEach(() => cleanup());

function row(partial: Partial<SaleRow> & { id: number }): SaleRow {
  return {
    daily_seq: partial.id,
    total_cents: 7000,
    payment: "cash",
    voided: 0,
    paid: 0,
    created_at: "2026-10-17 06:30:00",
    ...partial,
  };
}

/** <td> text of the first body row (the table's sort winner). */
function firstRowText(): string {
  return document.querySelector("tbody tr")?.textContent ?? "";
}

describe("SalesTable", () => {
  it("replaces the Voided column with a Status badge per row", () => {
    render(
      <SalesTable
        label="Sales"
        rows={[row({ id: 1, paid: 0 }), row({ id: 2, paid: 1, total_cents: 9000 })]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Status" })).toBeDefined();
    expect(screen.queryByRole("columnheader", { name: "Voided" })).toBeNull();
  });

  it("tones the status badge danger/ok/neutral with voided precedence", () => {
    render(
      <SalesTable
        label="Sales"
        rows={[
          row({ id: 1, paid: 0 }),
          row({ id: 2, paid: 1 }),
          row({ id: 3, paid: 0, voided: 1 }),
          row({ id: 4, paid: 1, voided: 1 }),
        ]}
      />,
    );

    expect(screen.getByText("Unpaid").className).toContain("text-danger");
    expect(screen.getByText("Paid").className).toContain("text-ok");
    // Voided wins over both paid and unpaid (rows 3 and 4).
    const voided = screen.getAllByText("Voided");
    expect(voided).toHaveLength(2);
    for (const badge of voided) {
      expect(badge.className).toContain("text-muted");
      expect(badge.className).not.toContain("text-danger");
      expect(badge.className).not.toContain("text-ok");
    }
  });

  it("mutes voided rows", () => {
    render(
      <SalesTable
        label="Sales"
        rows={[row({ id: 1, paid: 0 }), row({ id: 2, paid: 0, voided: 1 })]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].className).not.toContain("text-muted");
    expect(rows[1].className).toContain("text-muted");
  });

  it("labels every body cell with its column via data-label", () => {
    render(
      <SalesTable
        label="Sales"
        rows={[row({ id: 1 })]}
        renderActions={() => <button type="button">Void</button>}
      />,
    );

    const bodyRows = screen.getAllByRole("row").slice(1);
    for (const bodyRow of bodyRows) {
      const labels = Array.from(bodyRow.querySelectorAll("td")).map((cell) =>
        cell.getAttribute("data-label"),
      );
      expect(labels).toEqual([
        "Sale #",
        "Date",
        "Time",
        "Payment",
        "Total",
        "Status",
        "Actions",
      ]);
    }
  });

  it("carries the corrected row-card classes on tr and td", () => {
    render(<SalesTable label="Sales" rows={[row({ id: 1 })]} />);

    const tr = document.querySelector("tbody tr");
    expect(tr?.className).toContain("max-md:block");
    expect(tr?.className).not.toContain("max-md:flex");
    const td = tr?.querySelector("td");
    expect(td?.className).toContain("max-md:flex");
    expect(td?.className).toContain("max-md:justify-between");
    expect(td?.className).toContain(
      "max-md:before:content-[attr(data-label)]",
    );
  });

  it("keeps first-click-descending sort and aria-sort", () => {
    render(
      <SalesTable
        label="Sales"
        rows={[
          row({ id: 31, total_cents: 5000, created_at: "2026-10-17 01:00:00" }),
          row({ id: 32, total_cents: 9000, created_at: "2026-10-17 02:00:00" }),
        ]}
      />,
    );

    const totalHeader = screen.getByRole("columnheader", { name: "Total" });
    expect(totalHeader.getAttribute("aria-sort")).toBe("none");

    // First click sorts descending: the larger total leads.
    fireEvent.click(screen.getByRole("button", { name: "Total" }));
    expect(totalHeader.getAttribute("aria-sort")).toBe("descending");
    expect(firstRowText()).toContain("Sale #32");

    // Second click flips to ascending.
    fireEvent.click(screen.getByRole("button", { name: "Total" }));
    expect(totalHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(firstRowText()).toContain("Sale #31");
  });

  it("opens details from a row click and from the keyboard-focusable Sale # button", () => {
    const onRowClick = vi.fn();
    const target = row({ id: 7 });
    render(
      <SalesTable
        label="Sales"
        rows={[target]}
        onRowClick={onRowClick}
        renderActions={() => <button type="button">Void</button>}
      />,
    );

    const clickable = screen.getAllByRole("row").slice(1)[0];
    expect(clickable.className).toContain("row-hover-strong");
    expect(clickable.className).toContain("cursor-pointer");

    // The Sale # cell is a real button, so Enter/Space work for free.
    const opener = screen.getByRole("button", { name: "Sale #7" });
    fireEvent.click(opener);
    expect(onRowClick).toHaveBeenCalledWith(target);

    // Clicking anywhere else on the row opens the same details.
    fireEvent.click(document.querySelector("tbody tr")!);
    expect(onRowClick).toHaveBeenCalledTimes(2);

    // Row actions stay independent: clicking Void must not open details.
    fireEvent.click(screen.getByRole("button", { name: "Void" }));
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });
});
