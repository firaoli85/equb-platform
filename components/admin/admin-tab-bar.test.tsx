import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminTabBar, FIELD_TAB_HREFS } from "@/components/admin/admin-tab-bar";
import { AdminSidebar, ALL_NAV_LINKS } from "@/components/admin/admin-sidebar";

// WHAT ACTUALLY RENDERS ON A PHONE.
//
// The guard in lib/admin-nav.test.ts pins that a mobile nav EXISTS and that it
// draws from one list. This file renders it, at the routes the organizer is
// standing on when he reaches for it.
//
// The full flow — tapping More, the sheet rising, a destination loading —
// needs a signed-in admin, and the admin password does not go into a test
// harness. So this asserts everything the server sends: the markup, the
// destinations, and which one is announced as current. The tap belongs to Oli
// and his own phone.

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

function bar(at: string): string {
  pathname = at;
  return renderToStaticMarkup(<AdminTabBar queuedCount={0} />);
}

describe("the bar the organizer sees outside", () => {
  it("renders five destinations, Payments first", () => {
    const html = bar("/admin");
    for (const href of FIELD_TAB_HREFS) {
      expect(html, `${href} is missing from the bar`).toContain(`href="${href}"`);
    }
    // Leftmost is where the thumb lands. Recording money is the job.
    expect(html.indexOf('href="/admin/payments"')).toBeLessThan(html.indexOf('href="/admin"'));
    expect(html).toContain(">More<");
  });

  it("announces exactly one current page, on every route in the rail", () => {
    for (const link of ALL_NAV_LINKS) {
      const html = bar(link.href);
      const current = html.match(/aria-current="page"/g) ?? [];
      expect(current.length, `${link.href} announced ${current.length} current pages`).toBeLessThanOrEqual(1);
    }
  });

  // React emits aria-current before href whatever order the JSX declares, so
  // these match the whole anchor rather than assuming the attributes' order.
  const CURRENT_PAYMENTS = /<a[^>]*aria-current="page"[^>]*href="\/admin\/payments"/;

  it("lights Payments on the payment screen, and nothing else", () => {
    const html = bar("/admin/payments");
    expect(html).toMatch(CURRENT_PAYMENTS);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it("keeps Payments lit on its child routes", () => {
    // Recording a payment walks into /admin/payments/... — the bar must not go
    // blank the moment he starts the thing it exists for.
    expect(bar("/admin/payments/new")).toMatch(CURRENT_PAYMENTS);
  });

  it("does not light Dashboard on every admin page", () => {
    // /admin is a prefix of all nineteen routes.
    const html = bar("/admin/cash");
    expect(html).not.toMatch(/<a[^>]*aria-current="page"[^>]*href="\/admin"/);
  });

  it("falls back to More when the page is somewhere else entirely", () => {
    // Never nothing selected: on a route outside the four, More carries the
    // inverted capsule so the bar still says where you are.
    const html = bar("/admin/cycle/close");
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(0);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*class="[^"]*bg-\[#0F172A\]/);
  });

  it("the drawer is shut until it is opened", () => {
    const html = bar("/admin");
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("reserves the safe area and does not delay taps", () => {
    const html = bar("/admin");
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain("touch-action:manipulation");
  });

  it("carries the waiting count where the queue is not visible", () => {
    pathname = "/admin";
    const html = renderToStaticMarkup(<AdminTabBar queuedCount={3} />);
    // Messages lives behind More on a phone, so the badge has to ride More or
    // a held message is invisible until he opens the sheet.
    expect(html).toContain(">3<");
  });
});

describe("what the drawer holds", () => {
  it("is the whole rail — all nineteen destinations", () => {
    pathname = "/admin";
    const html = renderToStaticMarkup(<AdminSidebar queuedCount={0} />);
    for (const link of ALL_NAV_LINKS) {
      expect(html, `${link.href} unreachable on a phone`).toContain(`href="${link.href}"`);
    }
    expect(ALL_NAV_LINKS.length).toBeGreaterThanOrEqual(19);
  });

  it("gives every row a thumb-sized target", () => {
    pathname = "/admin";
    const html = renderToStaticMarkup(<AdminSidebar queuedCount={0} />);
    // py-3 below md, py-2 above: 44px under a thumb, tighter under a mouse.
    expect(html).toMatch(/py-3[^"]*md:py-2/);
  });
});
