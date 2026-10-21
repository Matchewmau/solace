import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DataTable, { type Column } from "./DataTable";

afterEach(() => cleanup());

type Row = { id: number; name: string; amount_cents: number };

const ROWS: Row[] = [
  { id: 1, name: "Water", amount_cents: 350 },
  { id: 2, name: "Rent", amount_cents: 6000 },
];

const columns: Column<Row>[] = [
  { key: "name", label: "Name", render: (row) => row.name },
  {
    key: "amount",
    label: "Amount",
    sortable: true,
    align: "right",
    value: (row) => row.amount_cents,
    render: (row) => String(row.amount_cents),
  },
];

/** Body rows (header row excluded), in DOM order, as their visible text. */
function bodyRowText(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent ?? "");
}

describe("DataTable", () => {
  it("renders every row and the column headers", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    expect(screen.getByRole("table", { name: "Bills" })).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Amount")).toBeDefined();
    expect(screen.getByText("Water")).toBeDefined();
    expect(screen.getByText("Rent")).toBeDefined();
    expect(screen.getByText("350")).toBeDefined();
    expect(screen.getByText("6000")).toBeDefined();

    const rows = screen.getAllByRole("row").slice(1);
    for (const row of rows) {
      expect(row.className).toContain("row-hover");
      expect(row.className).toContain("focus-within:bg-ink/[0.04]");
    }

    const amount = screen.getByRole("button", { name: "Amount" });
    expect(amount.className).toContain("min-h-11");
    expect(amount.className).toContain("hover:text-accent");
  });

  it("sorts descending on the first click and ascending on the second", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    const amountHeader = screen.getByRole("columnheader", { name: "Amount" });
    expect(amountHeader.getAttribute("aria-sort")).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(amountHeader.getAttribute("aria-sort")).toBe("descending");
    expect(bodyRowText()[0]).toContain("Rent");
    expect(bodyRowText()[1]).toContain("Water");

    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    expect(amountHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(bodyRowText()[0]).toContain("Water");
    expect(bodyRowText()[1]).toContain("Rent");
  });

  it("starts in the order and direction given by defaultSort", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={ROWS}
        rowKey={(row) => row.id}
        defaultSort={{ key: "amount", dir: "asc" }}
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: "Amount" }).getAttribute("aria-sort"),
    ).toBe("ascending");
    expect(bodyRowText()[0]).toContain("Water");
  });

  it("shows the empty message as a single row when there are no rows", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
      />,
    );

    expect(screen.getByText("Nothing here yet.")).toBeDefined();
    expect(screen.getAllByRole("row")).toHaveLength(2); // header + empty row
  });

  it("renders a custom empty message", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyMessage="No bills."
      />,
    );

    expect(screen.getByText("No bills.")).toBeDefined();
  });

  it("renders renderActions output inside its row under an Actions header", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={ROWS}
        rowKey={(row) => row.id}
        renderActions={(row) => (
          <button type="button">{`Void ${row.name}`}</button>
        )}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeDefined();
    const voidWater = screen.getByRole("button", { name: "Void Water" });
    const waterRow = voidWater.closest("tr");
    expect(waterRow).not.toBeNull();
    expect(waterRow?.textContent).toContain("Water");
    expect(screen.getByRole("button", { name: "Void Rent" })).toBeDefined();
  });

  it("labels every body cell with its column via data-label", () => {
    render(
      <DataTable
        label="Bills"
        columns={columns}
        rows={ROWS}
        rowKey={(row) => row.id}
        renderActions={() => <button type="button">Void</button>}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1);
    for (const row of rows) {
      const labels = Array.from(row.querySelectorAll("td")).map((cell) =>
        cell.getAttribute("data-label"),
      );
      expect(labels).toEqual(["Name", "Amount", "Actions"]);
    }
  });

  it("does not reorder when a sortable column has no value accessor", () => {
    const noValue: Column<Row>[] = [
      { key: "name", label: "Name", render: (row) => row.name },
      { key: "amount", label: "Amount", sortable: true, render: (row) => String(row.amount_cents) },
    ];
    render(
      <DataTable
        label="Bills"
        columns={noValue}
        rows={ROWS}
        rowKey={(row) => row.id}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Amount" }));

    expect(
      screen.getByRole("columnheader", { name: "Amount" }).getAttribute("aria-sort"),
    ).toBe("descending");
    expect(bodyRowText()[0]).toContain("Water");
    expect(bodyRowText()[1]).toContain("Rent");
  });
});
