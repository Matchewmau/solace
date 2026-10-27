import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MiniPager } from "./MiniPager";

afterEach(() => cleanup());

describe("MiniPager", () => {
  it("pages and reports its position", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(
      <MiniPager
        page={2}
        pageCount={3}
        summary="Showing 4–6 of 9"
        previousLabel="Previous upcoming dues"
        nextLabel="Next upcoming dues"
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );
    expect(screen.getByText("Showing 4–6 of 9")).toBeDefined();
    expect(screen.getByText("Page 2 of 3")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Previous upcoming dues" }));
    fireEvent.click(screen.getByRole("button", { name: "Next upcoming dues" }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disappears on a single page", () => {
    render(<MiniPager page={1} pageCount={1} summary="Showing 1–2 of 2" previousLabel="Previous" nextLabel="Next" onPrevious={vi.fn()} onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(
      <MiniPager page={1} pageCount={3} summary="Showing 1–3 of 9" previousLabel="Previous" nextLabel="Next" onPrevious={vi.fn()} onNext={vi.fn()} />,
    );
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <MiniPager page={3} pageCount={3} summary="Showing 7–9 of 9" previousLabel="Previous" nextLabel="Next" onPrevious={vi.fn()} onNext={vi.fn()} />,
    );
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
