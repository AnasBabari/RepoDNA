'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from './icons';

export function MobileDetailSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const currentFocusables = focusables();
      if (currentFocusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="mobile-detail-sheet-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        ref={sheetRef}
        className="mobile-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Selected repository details"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mobile-detail-sheet-header">
          <h2 className="eyebrow">Details</h2>
          <button className="icon-button" type="button" aria-label="Close details" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="mobile-detail-sheet-content">{children}</div>
      </section>
    </div>
  );
}
