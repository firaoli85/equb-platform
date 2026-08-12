import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — A PAGE THAT NOTHING LINKS TO DOES NOT EXIST.
//
// Four settings pages shipped working: access and security, messaging, cycle
// rules, your own devices. docs/ADMIN_IA.md §3 put them in an ACCOUNT MENU at
// the foot of the rail, deliberately out of the six working sections, and that
// menu was never built. `SETTINGS_LINKS` existed with an icon for every route,
// and its only consumer was the nav INSIDE the settings area — which you can
// only reach once you are already there.
//
// So for the whole life of the IA restructure those pages were reachable
// exclusively by typing the URL, and the organizer reported Settings as
// missing from the admin. It was.
//
// A source scan is the right shape for this because the failure is an ABSENCE.
// No render test fails when a link is simply not there, and no type error
// fires: every piece compiled, and nothing joined them up.

const ROOT = join(import.meta.dirname, "..");
const ADMIN_ROUTES = join(ROOT, "app", "admin", "(protected)");
const SIDEBAR = join(ROOT, "components", "admin", "admin-sidebar.tsx");
const ACCOUNT_MENU = join(ROOT, "components", "admin", "account-menu.tsx");
const LAYOUT = join(ADMIN_ROUTES, "layout.tsx");

/** Every .tsx under a directory, recursively. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Route paths of every settings page that actually exists on disk. */
function settingsRoutes(): string[] {
  const dir = join(ADMIN_ROUTES, "settings");
  return tsxFiles(dir)
    .filter((f) => f.endsWith("page.tsx"))
    .map((f) => {
      const rel = relative(dir, f).replace(/\\/g, "/").replace(/\/?page\.tsx$/, "");
      return rel === "" ? "/admin/settings" : `/admin/settings/${rel}`;
    })
    .sort();
}

describe("GUARD — every settings page is reachable from the admin chrome", () => {
  const sidebar = readFileSync(SIDEBAR, "utf8");
  const menu = readFileSync(ACCOUNT_MENU, "utf8");
  const layout = readFileSync(LAYOUT, "utf8");

  it("the settings pages exist on disk", () => {
    const routes = settingsRoutes();
    expect(routes).toContain("/admin/settings/access");
    expect(routes).toContain("/admin/settings/messaging");
    expect(routes).toContain("/admin/settings/cycle");
    expect(routes).toContain("/admin/settings/account");
  });

  // THE DEFECT, STATED DIRECTLY. Every settings route that exists must appear
  // in SETTINGS_LINKS — a new page added without one is a page nobody can find.
  it("every settings route on disk has a link in SETTINGS_LINKS", () => {
    const missing = settingsRoutes()
      // The index links the other four itself; it is the fallback, not a leaf.
      .filter((r) => r !== "/admin/settings")
      .filter((r) => !sidebar.includes(`"${r}"`));
    expect(missing, `settings pages with no entry in SETTINGS_LINKS: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  // THE HALF THAT WAS ACTUALLY MISSING. Links in an array are not navigation.
  // Something rendered on EVERY admin page has to consume them, or they are
  // reachable only from inside the area they lead to.
  it("the account menu consumes SETTINGS_LINKS and the layout renders it", () => {
    expect(menu).toMatch(/\bSETTINGS_LINKS\b/);
    expect(menu).toMatch(/SETTINGS_LINKS\.map/);
    expect(layout).toMatch(/<AccountMenu\b/);
    expect(layout).toMatch(/from "@\/components\/admin\/account-menu"/);
  });

  it("it is in the persistent chrome, not one page — desktop rail AND mobile bar", () => {
    // Two call sites: the rail foot and the mobile header. A phone had no way
    // to reach settings either.
    const renders = layout.match(/<AccountMenu\b/g) ?? [];
    expect(renders.length).toBeGreaterThanOrEqual(2);
  });

  // ONE SIGN-OUT, NOT TWO (UI_STANDARDS rule 3). It used to sit beside the
  // rail; ADMIN_IA §3 makes it the last item of this menu. Leaving both would
  // be two controls for one action, and the orphaned component would drift.
  it("sign-out lives in the account menu, and only there", () => {
    expect(menu).toMatch(/signOutAction/);
    expect(menu).toMatch(/Sign out/);
    expect(existsSync(join(ROOT, "components", "sign-out-button.tsx"))).toBe(false);
    // No admin surface calls signOutAction on its own any more.
    const strays = tsxFiles(ADMIN_ROUTES).filter((f) =>
      /\bsignOutAction\b/.test(readFileSync(f, "utf8")),
    );
    expect(strays.map((f) => relative(ROOT, f).replace(/\\/g, "/"))).toEqual([]);
  });

  // The IA is explicit that Settings is not a seventh working section. A rail
  // row for it would put "somewhere you go" among "where you work".
  it("Settings is NOT a rail section — it is the account menu (ADMIN_IA §2)", () => {
    const navGroups = sidebar.slice(
      sidebar.indexOf("NAV_GROUPS"),
      sidebar.indexOf("SETTINGS_LINKS"),
    );
    expect(navGroups).not.toMatch(/\/admin\/settings/);
  });
});
