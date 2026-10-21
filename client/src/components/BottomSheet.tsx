import type { ReactNode } from "react";
import { useDialogFocus } from "./Dialog";

/**
 * Bottom-anchored counterpart to {@link Dialog}, sharing its focus contract
 * (focus trap + restore) via `useDialogFocus`. The entrance is the pure-CSS
 * `.sheet-up` utility, so this stays on the eager/POS chain.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
}) {
  const panelRef = useDialogFocus(open, onClose);
  if (!open) return null;

  return (
    <div
      data-testid="sheet-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-ink/40"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="sheet-up fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-box bg-paper px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-ink shadow-sheet"
      >
        {children}
      </div>
    </div>
  );
}
