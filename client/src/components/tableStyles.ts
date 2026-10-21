/**
 * Shared table class strings. The row-card pair is reused verbatim by every
 * table page: below `md` the row becomes a block so its cells stack, while
 * each cell becomes a flex line with its label on the left (from
 * `data-label`) and its value on the right. Keep `ROW_CARD` and `CELL_CARD`
 * separate — `block` + `flex` on the same element loses to stylesheet order.
 */
export const ROW_CARD = "max-md:block";
export const CELL_CARD =
  "max-md:flex max-md:justify-between max-md:before:content-[attr(data-label)] max-md:text-muted";
export const ROW_HOVER = "row-hover focus-within:bg-ink/[0.04]";
export const ROW_HOVER_STRONG =
  "row-hover-strong focus-within:bg-ink/[0.04]";
export const SORT_HEADER =
  "inline-flex min-h-11 items-center font-semibold underline decoration-dotted underline-offset-4 hover:text-accent";
