import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Bars, Donut } from "./charts";

afterEach(() => cleanup());

const MONEY_OUT = [
  { label: "Bills", value: 6000, color: "#8a5a2b" },
  { label: "Loans", value: 2000, color: "#141210" },
];

describe("Donut", () => {
  it("lists every segment with its value and integer percent", () => {
    render(<Donut segments={MONEY_OUT} />);

    expect(screen.getByText("Bills")).toBeDefined();
    expect(screen.getByText("Loans")).toBeDefined();
    expect(screen.getByText("6000")).toBeDefined();
    expect(screen.getByText("2000")).toBeDefined();
    expect(screen.getByText("75%")).toBeDefined();
    expect(screen.getByText("25%")).toBeDefined();
  });

  it("formats legend values through formatValue", () => {
    render(
      <Donut segments={MONEY_OUT} formatValue={(value) => `₱${value}.00`} />,
    );

    expect(screen.getByText("₱6000.00")).toBeDefined();
    expect(screen.getByText("₱2000.00")).toBeDefined();
  });

  it("draws one arc per segment with dash lengths proportional to the values", () => {
    const { container } = render(<Donut segments={MONEY_OUT} />);

    const bills = container.querySelector('[data-segment="Bills"]');
    const loans = container.querySelector('[data-segment="Loans"]');
    expect(bills).not.toBeNull();
    expect(loans).not.toBeNull();

    expect(bills!.getAttribute("stroke")).toBe("#8a5a2b");
    expect(loans!.getAttribute("stroke")).toBe("#141210");

    const billsDash = Number(
      bills!.getAttribute("stroke-dasharray")!.split(" ")[0],
    );
    const loansDash = Number(
      loans!.getAttribute("stroke-dasharray")!.split(" ")[0],
    );
    expect(billsDash / loansDash).toBeCloseTo(3, 1);
    expect(Number(loans!.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      -billsDash,
      1,
    );
  });

  it("renders the center label inside the ring", () => {
    render(<Donut segments={MONEY_OUT} centerLabel="₱8000" />);

    expect(screen.getByText("₱8000")).toBeDefined();
  });

  it("shows the empty message and no ring when every value is zero", () => {
    const { container } = render(
      <Donut segments={[{ label: "Bills", value: 0, color: "#8a5a2b" }]} />,
    );

    expect(screen.getByText(/no data/i).textContent).toBe("No data yet.");
    expect(container.querySelector("circle")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("treats an empty segment list as empty", () => {
    render(<Donut segments={[]} />);

    expect(screen.getByText("No data yet.")).toBeDefined();
  });

  it("links donut segment hover and focus to the legend row", () => {
    const { container } = render(<Donut segments={MONEY_OUT} />);
    const bills = container.querySelector('[data-segment="Bills"]') as SVGElement;
    const legend = container.querySelector('[data-legend="Bills"]') as HTMLElement;

    expect(bills.getAttribute("tabindex")).toBe("0");
    fireEvent.mouseEnter(bills);
    expect(bills.getAttribute("data-active")).toBe("true");
    expect(legend.getAttribute("data-active")).toBe("true");

    fireEvent.mouseLeave(bills);
    expect(bills.getAttribute("data-active")).toBeNull();

    fireEvent.focus(bills);
    expect(bills.getAttribute("data-active")).toBe("true");
  });
});

describe("Bars", () => {
  const SALES = [
    { label: "12", value: 100 },
    { label: "13", value: 50 },
    { label: "14", value: 200 },
  ];

  it("renders a column, value, and label per item when vertical", () => {
    const { container } = render(
      <Bars items={SALES} formatValue={(value) => `₱${value}`} />,
    );

    const bars = container.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(3);
    expect(container.querySelectorAll("[data-value]").length).toBe(3);
    expect(container.querySelectorAll("[data-label]").length).toBe(3);

    expect(screen.getByText("₱100")).toBeDefined();
    expect(screen.getByText("₱50")).toBeDefined();
    expect(screen.getByText("₱200")).toBeDefined();
    for (const label of ["12", "13", "14"]) {
      expect(screen.getByText(label)).toBeDefined();
    }

    expect((bars[2] as HTMLElement).style.height).toBe("100%");
    expect((bars[1] as HTMLElement).style.height).toBe("25%");
  });

  it("labels every column with the 10px label class", () => {
    const { container } = render(<Bars items={SALES} />);

    for (const label of container.querySelectorAll("[data-label]")) {
      expect(label.className).toContain("text-[10px]");
    }
  });

  it("renders ranked rows with the label left and value right when horizontal", () => {
    const { container } = render(
      <Bars
        items={[
          { label: "Adobo", value: 12 },
          { label: "Halo-halo", value: 6 },
        ]}
        orientation="horizontal"
        formatValue={(value) => `${value} sold`}
      />,
    );

    const rows = container.querySelectorAll("[data-row]");
    const bars = container.querySelectorAll("[data-bar]");
    expect(rows.length).toBe(2);
    expect(bars.length).toBe(2);

    expect(screen.getByText("Adobo")).toBeDefined();
    expect(screen.getByText("Halo-halo")).toBeDefined();
    expect(screen.getByText("12 sold")).toBeDefined();
    expect(screen.getByText("6 sold")).toBeDefined();

    expect((bars[0] as HTMLElement).style.width).toBe("100%");
    expect((bars[1] as HTMLElement).style.width).toBe("50%");
  });

  it("shows the empty message when there are no items", () => {
    const { container } = render(<Bars items={[]} />);

    expect(screen.getByText("No data yet.")).toBeDefined();
    expect(container.querySelector("[data-bar]")).toBeNull();
  });

  it("shows the empty message when every value is zero", () => {
    render(
      <Bars
        items={[
          { label: "12", value: 0 },
          { label: "13", value: 0 },
        ]}
      />,
    );

    expect(screen.getByText("No data yet.")).toBeDefined();
  });

  it("honors a custom empty message", () => {
    render(<Bars items={[]} emptyMessage="Nothing sold yet." />);

    expect(screen.getByText("Nothing sold yet.")).toBeDefined();
  });

  it("pins bar values and exposes one keyboard entry point", () => {
    const { container } = render(
      <Bars items={SALES} formatValue={(value) => `₱${value}`} showValues={false} />,
    );
    const chart = screen.getByRole("group", { name: /bar chart/i });

    expect(chart.getAttribute("tabindex")).toBe("0");
    expect(container.querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    fireEvent.focus(chart);
    expect(within(chart).getByRole("status").textContent).toContain("12: ₱100");

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(within(chart).getByRole("status").textContent).toContain("13: ₱50");

    fireEvent.click(container.querySelectorAll("[data-bar-item]")[2]);
    expect(within(chart).getByRole("status").textContent).toContain("14: ₱200");

    fireEvent.blur(chart);
    expect(within(chart).getByRole("status").textContent).toContain("14: ₱200");
  });
});
