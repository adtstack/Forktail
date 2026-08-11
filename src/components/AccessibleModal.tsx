import { useEffect, useRef, type ReactNode } from "react";
import { activateModalFocus } from "../core/modalFocus";

interface AccessibleModalProps {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  className?: string;
  onCancel: () => void;
}

export function AccessibleModal({
  children,
  labelledBy,
  describedBy,
  className,
  onCancel,
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return activateModalFocus(dialog, () => onCancelRef.current());
  }, []);

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className={`confirm-dialog${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
