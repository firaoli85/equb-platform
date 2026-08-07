"use client";

import { buttonCls } from "@/components/ui/primitives";
import type { NumberConflict } from "@/lib/lucky-numbers";

/**
 * A NUMBER ALREADY IN USE IS A CHOICE, NOT A DEAD END.
 *
 * WHO holds the number, and the two things that can be done about it. When the
 * number cannot be taken — it is drawn, or it carries a payout, so it IS the
 * record of a week they won — only KEEP is offered, with the reason stated
 * rather than a disabled button the organizer has to guess at.
 *
 * Shared by the member profile's lucky-number rows and the add-member wizard.
 * It lived in the profile only, which is why the wizard — where most numbers
 * are first assigned — still answered "Number 22 is already taken in this
 * cycle" and left the organizer guessing another number.
 */
export function NumberConflictPanel({
  conflict,
  busy,
  onReplace,
  onKeep,
  onDismiss,
}: {
  conflict: NumberConflict;
  busy: boolean;
  /** Re-run the identical save with the organizer's REPLACE answer. */
  onReplace: () => void;
  /** Write the free number into the field they used, ready to save. */
  onKeep: (suggested: number) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="number-conflict"
      className="space-y-2 rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm text-gray-900 dark:text-gray-100"
    >
      <h3 className="font-black">
        #{conflict.number} already belongs to {conflict.holder.memberName}
      </h3>
      <p>{conflict.message}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {conflict.replaceRefusal === null && (
          <button
            type="button"
            disabled={busy}
            onClick={onReplace}
            className={buttonCls.primary + " !text-xs"}
          >
            Replace — take #{conflict.number} and move {conflict.holder.memberName}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onKeep(conflict.suggestedNumber)}
          className={buttonCls.secondary + " !text-xs"}
        >
          Keep — leave #{conflict.number} with {conflict.holder.memberName}, use #
          {conflict.suggestedNumber}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className={buttonCls.ghost + " !text-xs"}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
