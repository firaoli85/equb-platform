"use client";

import { buttonCls } from "@/components/ui/primitives";
import type { ArchiveData } from "@/lib/cycle-close";
import { formatMoney } from "@/lib/format";

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The archive as a CSV the organizer can keep, print, or hand to anyone. */
export function ExportArchiveButton({ archive }: { archive: ArchiveData }) {
  function download() {
    const lines: string[] = [];
    lines.push(`${archive.cycleName} — closed ${archive.closedAt.slice(0, 10)}`);
    lines.push(
      `${archive.startDate} to ${archive.closedAt.slice(0, 10)}, ${archive.plannedWeeks} weeks, ${archive.feePercent}% fee`,
    );
    lines.push("");
    lines.push("MEMBERS");
    lines.push(
      ["Member", "Amharic", "Weekly", "Weeks paid", "Committed", "Total paid", "Drawn week", "Received net", "Settled on win week", "Closing balance", "Statement"]
        .map(csvCell)
        .join(","),
    );
    for (const m of archive.members) {
      lines.push(
        [
          m.name,
          m.nameAmharic,
          formatMoney(m.weeklyAmount),
          m.weeksPaid,
          m.weeksCommitted,
          formatMoney(m.totalPaid),
          m.drawnWeek ?? "never drawn",
          formatMoney(m.receivedNet),
          formatMoney(m.settledFromPayout),
          formatMoney(m.outstanding),
          m.statement,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    lines.push("");
    lines.push("WEEK BY WEEK");
    lines.push(["Week", "Date", "Skipped", "Received", "Draw", "Payouts"].map(csvCell).join(","));
    for (const w of archive.weeks) {
      lines.push(
        [
          w.weekNumber,
          w.date,
          w.isSkipped ? "yes" : "",
          formatMoney(w.received),
          w.draw ? `${w.draw.numbers.map((n) => `#${n}`).join(" + ")} — ${w.draw.winners.join(", ")}` : "",
          w.draw
            ? w.draw.payouts
                .map((p) => `#${p.number} ${p.who}: ${formatMoney(p.net)} ${p.status}${p.paidAt ? ` ${p.paidAt}` : ""}`)
                .join(" | ")
            : "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    lines.push("");
    lines.push("TOTALS");
    lines.push(`Received,${csvCell(formatMoney(archive.totals.received))}`);
    lines.push(`Paid out (net),${csvCell(formatMoney(archive.totals.paidOutNet))}`);
    lines.push(`Still held at close,${csvCell(formatMoney(archive.totals.stillHeld))}`);
    lines.push(
      `Carried forward,${csvCell(formatMoney(archive.totals.outstanding))} across ${archive.totals.membersShort} member(s)`,
    );

    // BOM so Excel opens the Amharic names correctly.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${archive.cycleName.replace(/[^\w\d-]+/g, "-")}-archive.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" onClick={download} className={buttonCls.secondary + " !px-3 !py-1.5 !text-xs"}>
      Download CSV
    </button>
  );
}
