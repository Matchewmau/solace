import { Dialog } from "./Dialog";
import { Button } from "./ui";

/**
 * Destructive-action confirmation built on the shared Dialog.
 * The confirm button is disabled while the caller reports a pending request;
 * a failed request surfaces as an alert line without closing the dialog.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      <p className="text-sm">{message}</p>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
