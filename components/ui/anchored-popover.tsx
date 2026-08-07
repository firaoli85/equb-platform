"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// AN ANCHORED POPOVER THAT CANNOT BE CLIPPED (UI_STANDARDS 10b).
//
// THE PROBLEM. A popover positioned with `absolute` inside its own `relative`
// wrapper lands in the right place — ancestor transforms do not move it, unlike
// `fixed`. But it is still a child of the trigger's subtree, so ANY ancestor
// with `overflow: hidden | auto | scroll` cuts it off. `Table` wraps its
// children in `overflow-x-auto`, so every select and date picker inside a table
// row is clipped at the table's edge.
//
// THE FIX, and why it is not just "use fixed". Rendering into document.body
// escapes every clip AND every transform — but a portalled element has no
// relationship to its trigger any more, so the position has to be MEASURED and
// re-measured. That is what this component does:
//
//   - measures the trigger's viewport rect on open, on scroll, and on resize
//   - positions with `fixed`, so the coordinates are viewport coordinates
//   - FLIPS above the trigger when there is not enough room below
//   - CLAMPS horizontally so it never hangs off the screen edge
//   - matches the trigger's width when asked (a select should line up)
//
// Scroll is listened to with `capture: true` because the clipping ancestor is
// usually the thing scrolling, and a scroll inside it does not bubble.

export type PopoverPlacement = "below" | "above";

export function AnchoredPopover({
  anchorRef,
  open,
  onRequestClose,
  children,
  /** Match the trigger's width — right for a select, wrong for a calendar. */
  matchTriggerWidth = false,
  /** Gap between trigger and panel, in px. */
  offset = 6,
  className = "",
  role,
  ariaLabel,
  id,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  /** Called on outside click, Escape, or when the anchor scrolls out of view. */
  onRequestClose: () => void;
  children: React.ReactNode;
  matchTriggerWidth?: boolean;
  offset?: number;
  className?: string;
  role?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width?: number;
    placement: PopoverPlacement;
  } | null>(null);

  useEffect(() => setMounted(true), []);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const panel = panelRef.current;
    // Before the first paint the panel has no size; fall back to a sensible
    // guess so the first frame is not wildly wrong, then correct on the next.
    const panelH = panel?.offsetHeight ?? 280;
    const panelW = matchTriggerWidth ? a.width : (panel?.offsetWidth ?? 336);

    const spaceBelow = window.innerHeight - a.bottom;
    const spaceAbove = a.top;
    // Flip only when below genuinely does not fit AND above fits better —
    // flipping toward an even smaller gap just moves the problem.
    const placement: PopoverPlacement =
      spaceBelow < panelH + offset && spaceAbove > spaceBelow ? "above" : "below";

    const top = placement === "below" ? a.bottom + offset : a.top - panelH - offset;

    // Clamp horizontally so the panel never hangs off either edge.
    const margin = 8;
    const maxLeft = window.innerWidth - panelW - margin;
    const left = Math.max(margin, Math.min(a.left, Math.max(margin, maxLeft)));

    setPos({
      top: Math.max(margin, top),
      left,
      width: matchTriggerWidth ? a.width : undefined,
      placement,
    });
  }, [anchorRef, matchTriggerWidth, offset]);

  // Position BEFORE paint so the panel never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;

    // capture:true — the clipping ancestor is usually what scrolls, and its
    // scroll event does not bubble to window.
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onRequestClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onRequestClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, reposition, onRequestClose, anchorRef]);

  // Re-measure once the panel has real dimensions — the first pass used an
  // estimate, and a tall calendar near the bottom of the screen needs the flip
  // decision made from its actual height.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const observer = new ResizeObserver(() => reposition());
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, [open, reposition]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      // z-[90]: above page content, deliberately BELOW the modal layer (100)
      // so a popover can never cover a confirmation dialog.
      className={`fixed z-[90] ${className}`}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: pos?.width,
        // Hidden until measured, so it never flashes at the wrong coordinates.
        visibility: pos ? "visible" : "hidden",
      }}
      data-placement={pos?.placement}
    >
      {children}
    </div>,
    document.body,
  );
}
