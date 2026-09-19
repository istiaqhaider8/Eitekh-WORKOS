'use client';

import { useEffect, useRef } from 'react';

/**
 * D3 — keep keyboard focus inside an open dialog, and give it back on close.
 *
 * WHAT WAS WRONG
 *
 * Twelve components render `role="dialog" aria-modal="true"`, which tells a
 * screen reader that everything behind the dialog is inert. Nothing enforced
 * it. `tabIndex` appeared ZERO times in the codebase and `onKeyDown` four
 * times, so:
 *
 *   - opening a dialog left focus on the button behind it, and the first Tab
 *     moved through the page UNDER the overlay — invisible, but focusable,
 *     and a screen reader happily read it out;
 *   - Tab could leave the dialog entirely and land in the browser chrome,
 *     with no way back except a mouse;
 *   - closing it dropped focus to the top of the document, so a keyboard user
 *     who opened a dialog from halfway down a board had to tab back there.
 *
 * `aria-modal` without a focus trap is a promise the markup makes and the
 * behaviour breaks — which is worse than not making it, because assistive
 * technology acts on the promise.
 *
 * axe cannot catch any of this: it inspects a static snapshot and focus
 * behaviour only exists while keys are being pressed. That is why this is a
 * hook with its own tests rather than something the audit would have found.
 *
 * USAGE
 *
 *   const ref = useFocusTrap<HTMLDivElement>(isOpen, onClose);
 *   <div ref={ref} role="dialog" aria-modal="true"> ... </div>
 */

/**
 * Everything that can hold focus, in DOM order.
 *
 * `:not([disabled])` and the negative-tabindex exclusion matter: a disabled
 * button and an element deliberately removed from the tab order are both
 * matched by the simple selectors, and trapping focus onto one of them would
 * strand the user.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    // A focusable element inside a collapsed section is still matched by the
    // selector but cannot actually take focus, and Tab would appear to do
    // nothing.
    if (el.hasAttribute('aria-hidden')) return false;
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
  onEscape?: () => void
) {
  const ref = useRef<T | null>(null);
  /** Where focus was before the dialog opened, so it can be given back. */
  const previouslyFocused = useRef<HTMLElement | null>(null);
  /** Kept in a ref so changing the handler does not re-run the effect. */
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus in. The first focusable element is usually right — a close
    // button or the first field — and the dialog itself is the fallback for a
    // dialog with nothing focusable in it, which would otherwise leave focus
    // outside the thing claiming to be modal.
    const initial = focusableWithin(root)[0] ?? root;
    if (initial === root && !root.hasAttribute('tabindex')) {
      root.setAttribute('tabindex', '-1');
    }
    // After paint: the content may still be rendering when the effect runs,
    // and focusing an element that is about to be replaced loses it.
    const raf = requestAnimationFrame(() => initial.focus?.());

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (escapeRef.current) {
          e.stopPropagation();
          escapeRef.current();
        }
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusableWithin(root);
      if (items.length === 0) {
        // Nothing to move to; keep focus on the dialog rather than letting it
        // escape to the page behind.
        e.preventDefault();
        root.focus?.();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;

      // Wrap at both ends. Also catches focus having escaped the dialog
      // entirely — if the active element is outside, Tab brings it back.
      if (e.shiftKey) {
        if (current === first || !root.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !root.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);

      // Give focus back to whatever opened the dialog. Without this a keyboard
      // user who opened it from halfway down a long board is returned to the
      // top of the document and has to tab back.
      const previous = previouslyFocused.current;
      if (previous && document.contains(previous)) {
        previous.focus?.();
      }
    };
  }, [active]);

  return ref;
}
