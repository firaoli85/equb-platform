import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_SIZE_OPTIONS, parsePageSize, PAGE_SIZES } from "./paging";

// ADMIN LIST CONTROLS (14 Aug 2026 order): sort, filter-on-Apply, page size.
//
// The page-size parse is pure and tested directly. The "does NOT apply on
// change" half is a SOURCE scan: the behaviour lives in JSX event handlers,
// and the failure it guards against is a handler quietly going back to
// pushing the router on every keystroke or select — which no unit test of a
// pure function can see.

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("page size is chosen, bounded, and defaulted", () => {
  it("offers exactly the four sizes the order named", () => {
    expect([...PAGE_SIZE_OPTIONS]).toEqual([10, 25, 50, 100]);
  });

  it("an absent size is the list's own default — current behaviour is unchanged", () => {
    expect(parsePageSize(undefined, PAGE_SIZES.receipts)).toBe(PAGE_SIZES.receipts);
    expect(parsePageSize("", PAGE_SIZES.balances)).toBe(PAGE_SIZES.balances);
  });

  it("accepts an offered size", () => {
    for (const n of PAGE_SIZE_OPTIONS) {
      expect(parsePageSize(String(n), PAGE_SIZES.messageLog)).toBe(n);
    }
  });

  it("accepts the list's own default even when it is not one of the four", () => {
    // receipts default to 40 — not an offered option, and still legitimate.
    expect(parsePageSize("40", PAGE_SIZES.receipts)).toBe(40);
  });

  it("refuses anything else — a crafted URL cannot request 10,000 rows", () => {
    for (const bad of ["10000", "0", "-5", "abc", "99"]) {
      expect(parsePageSize(bad, PAGE_SIZES.balances)).toBe(PAGE_SIZES.balances);
    }
  });

  it("takes the first value when a param repeats", () => {
    expect(parsePageSize(["25", "100"], PAGE_SIZES.balances)).toBe(25);
  });
});

describe("GUARD — admin filters do not fire on change alone", () => {
  it("the audit filter bar buffers its pickers and pushes only in apply()", () => {
    const src = read("app/admin/(protected)/audit/audit-filters.tsx");
    // Every picker writes local state…
    for (const control of ["action", "entity", "person", "from", "to"]) {
      expect(src, `${control} must set local state, not navigate`).toContain(`set("${control}", v)`);
    }
    // …and inside the FILTER component (AuditPager below it pages, which is
    // navigation of a different kind) exactly two things navigate: Apply,
    // and Clear.
    const filterComponent = src.slice(0, src.indexOf("export function AuditPager"));
    const pushes = filterComponent.match(/router\.push\(/g) ?? [];
    expect(filterComponent).toContain("function apply()");
    expect(pushes).toHaveLength(2);
    expect(filterComponent).toContain("Apply");
  });

  it("the conversation filter bar buffers its three controls behind Apply", () => {
    const src = read("app/admin/(protected)/messages/message-centre.tsx");
    expect(src).toContain("const [picked, setPicked] = useState<ConversationFilter>(filter)");
    expect(src).toContain('data-testid="filter-apply"');
    // The old apply-on-change helper is gone.
    expect(src).not.toMatch(/onChange=\{\(e\) => go\(/);
  });

  it("the people search applies on submit, never per keystroke — the debounce is gone", () => {
    const src = read("app/admin/(protected)/messages/message-centre.tsx");
    expect(src).toContain("const applySearch = ()");
    // A debounce is exactly what "applies on change" looks like when it is
    // trying to be polite about it.
    expect(src).not.toContain("setTimeout");
    expect(src).toMatch(/onSubmit=\{\(e\) => \{[\s\S]{0,80}applySearch\(\)/);
  });

  it("the payments member search separates what is typed from what is applied", () => {
    const src = read("app/admin/(protected)/payments/payments-members.tsx");
    expect(src).toContain("const [typed, setTyped] = useState");
    expect(src).toContain("const [search, setSearch] = useState");
    // Typing writes `typed`; only submit (or clearing) writes `search`.
    expect(src).toContain("setSearch(typed)");
  });

  it("the directory search was already a GET form — left as it was", () => {
    const src = read("app/admin/(protected)/people/page.tsx");
    expect(src).toContain('<form action="/admin/people"');
    expect(src).toContain('type="submit"');
  });
});

describe("GUARD — every paginated admin list offers a page size", () => {
  const PAGED = [
    "app/admin/(protected)/balances/page.tsx",
    "app/admin/(protected)/messages/page.tsx",
    "app/admin/(protected)/audit/page.tsx",
    "app/admin/(protected)/people/[id]/page.tsx",
    "app/admin/(protected)/cycle/position/cash-reading-panel.tsx",
  ];

  it("each paginated screen renders the selector beside its pager", () => {
    for (const file of PAGED) {
      const src = read(file);
      expect(src, `${file} paginates without offering a page size`).toContain("PageSizeSelect");
    }
  });

  it("the selector resets the page — page 4 of 25 is not page 4 of 100", () => {
    const src = read("components/ui/page-size.tsx");
    expect(src).toContain("next.delete(pageParam)");
    // And it persists, per the order.
    expect(src).toContain("localStorage.setItem(storageKey, value)");
  });
});
