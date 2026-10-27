import { Button } from "./ui";

/**
 * Compact Previous/Next pager for the fixed-size dashboard lists.
 * Callers clamp `page` themselves; the pager disables the out-of-range ends
 * and hides entirely when there is nothing to page through.
 */
export function MiniPager({
  page,
  pageCount,
  summary,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
}: {
  page: number;
  pageCount: number;
  summary: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-xs text-muted">{summary}</p>
      <div className="flex items-center gap-3">
        <Button
          ariaLabel={previousLabel}
          disabled={page <= 1}
          onClick={onPrevious}
        >
          Previous
        </Button>
        <p className="text-xs text-muted">
          Page {page} of {pageCount}
        </p>
        <Button
          ariaLabel={nextLabel}
          disabled={page >= pageCount}
          onClick={onNext}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
