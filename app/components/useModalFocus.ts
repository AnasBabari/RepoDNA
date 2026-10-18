'use client';

import { useEffect, useRef } from 'react';

/** One lifecycle for labelled modal surfaces, including conditional form states. */
export function useModalFocus<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const disabled: { element: HTMLElement; inert: boolean }[] = [];
    for (let node: HTMLElement | null = dialog; node?.parentElement; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          disabled.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
    }
    const items = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const focusFirst = () => (items()[0] ?? dialog).focus({ preventScroll: true });
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current(); return;
      }
      if (event.key !== 'Tab') return;
      const controls = items();
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) ?? dialog : controls[0] ?? dialog).focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      for (const { element, inert } of disabled) element.inert = inert;
      if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
