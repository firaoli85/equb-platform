import { describe, expect, it } from "vitest";
import {
  approximateLocation,
  describeDevice,
  deviceFingerprint,
  isNewDevice,
  newDeviceNotice,
} from "./device";

// AWARENESS, NEVER BLOCKING. The rule that matters most in this file is the
// negative one: nothing here decides whether a sign-in is allowed. The tests
// below check the wording a member reads and — critically — that the
// new-device notice stays rare enough to still be worth reading.

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const FIREFOX_ANDROID =
  "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

describe("describeDevice — words a member recognises", () => {
  it("reads Chrome on Windows from client hints", () => {
    const facts = describeDevice({
      userAgent: CHROME_WIN,
      chUa: '"Chromium";v="150", "Google Chrome";v="150", "Not;A=Brand";v="24"',
      chPlatform: '"Windows"',
      chMobile: "?0",
    });
    expect(facts.label).toBe("Google Chrome on Windows");
    expect(facts.deviceType).toBe("Computer");
  });

  it("ignores the decoy brands browsers inject into Sec-CH-UA", () => {
    const facts = describeDevice({
      userAgent: CHROME_WIN,
      chUa: '"Not(A:Brand";v="24", "Chromium";v="150"',
      chPlatform: '"Windows"',
    });
    // Chromium is the only real brand left, so it wins over the decoy.
    expect(facts.browser).toBe("Chromium");
  });

  it("works with NO client hints at all — Safari and Firefox never send them", () => {
    expect(describeDevice({ userAgent: SAFARI_IPHONE }).label).toBe("Safari on iPhone");
    expect(describeDevice({ userAgent: FIREFOX_ANDROID }).label).toBe("Firefox on Android");
  });

  it("does not call Edge 'Chrome' — the UA string claims to be both", () => {
    expect(describeDevice({ userAgent: EDGE_WIN }).browser).toBe("Edge");
  });

  it("tells a phone from a tablet from a computer", () => {
    expect(describeDevice({ userAgent: SAFARI_IPHONE }).deviceType).toBe("Phone");
    expect(describeDevice({ userAgent: FIREFOX_ANDROID }).deviceType).toBe("Phone");
    expect(
      describeDevice({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/604.1",
      }).deviceType,
    ).toBe("Tablet");
    expect(describeDevice({ userAgent: CHROME_WIN }).deviceType).toBe("Computer");
  });

  it("describes ONE device when the hints and the user agent disagree", () => {
    // Found in browser testing: a request whose client hints said desktop
    // Chromium while its UA string said iPhone produced a row reading
    // "Chromium on Windows" AND deviceType "Phone" — a device that does not
    // exist. The hints win for all three fields or none.
    const facts = describeDevice({
      userAgent: SAFARI_IPHONE,
      chUa: '"Chromium";v="150"',
      chPlatform: '"Windows"',
      chMobile: "?0",
    });
    expect(facts.label).toBe("Chromium on Windows");
    expect(facts.deviceType).toBe("Computer");
  });

  it("still spots an iPad, which has no client hint of its own", () => {
    // Sec-CH-UA-Mobile is ?0 on a tablet — that only rules out "phone".
    expect(
      describeDevice({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        chUa: '"Google Chrome";v="150"',
        chMobile: "?0",
      }).deviceType,
    ).toBe("Tablet");
  });

  it("says something honest when it recognises nothing", () => {
    const facts = describeDevice({ userAgent: null });
    expect(facts.label).toBe("Unrecognised device");
    // Never a raw UA string and never an empty string in the UI.
    expect(facts.label.length).toBeGreaterThan(0);
  });
});

describe("deviceFingerprint — stable enough to compare, weak by design", () => {
  it("is the same for the same browser across sign-ins", () => {
    const signals = { userAgent: CHROME_WIN, chPlatform: '"Windows"' };
    expect(deviceFingerprint(signals)).toBe(deviceFingerprint({ ...signals }));
  });

  it("differs between browsers on the same machine", () => {
    expect(deviceFingerprint({ userAgent: CHROME_WIN, chPlatform: '"Windows"' })).not.toBe(
      deviceFingerprint({ userAgent: EDGE_WIN, chPlatform: '"Windows"' }),
    );
  });

  it("never contains the raw user agent — it is a hash, not a record", () => {
    const fp = deviceFingerprint({ userAgent: CHROME_WIN });
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fp).not.toContain("Windows");
  });
});

describe("approximateLocation — platform headers only, no lookup service", () => {
  it("reads city, region and country when the platform supplies them", () => {
    expect(approximateLocation({ city: "Silver%20Spring", region: "MD", country: "US" })).toBe(
      "Silver Spring, MD, US",
    );
  });

  it("says NOTHING rather than inventing a city when headers are absent", () => {
    expect(approximateLocation({})).toBeNull();
    expect(approximateLocation({ city: "", region: null, country: undefined })).toBeNull();
  });

  it("does not repeat itself for a city-state", () => {
    expect(approximateLocation({ city: "Singapore", region: "SG", country: "SG" })).toBe(
      "Singapore, SG",
    );
  });
});

describe("isNewDevice — fires ONLY on a genuinely new combination", () => {
  const known = { fingerprint: "aaa", ip: "1.1.1.1" };
  const history = [known, { fingerprint: "bbb", ip: "2.2.2.2" }];

  it("does not fire for a device AND network both seen before", () => {
    expect(isNewDevice(known, history)).toBe(false);
  });

  it("does not fire for a KNOWN browser on a new network — they left the house", () => {
    expect(isNewDevice({ fingerprint: "aaa", ip: "9.9.9.9" }, history)).toBe(false);
  });

  it("does not fire for a NEW browser on a known network — they updated, or opened another", () => {
    expect(isNewDevice({ fingerprint: "zzz", ip: "1.1.1.1" }, history)).toBe(false);
  });

  it("fires when BOTH the device and the network are unfamiliar", () => {
    expect(isNewDevice({ fingerprint: "zzz", ip: "9.9.9.9" }, history)).toBe(true);
  });

  it("never fires on the very first sign-in — there is nothing to compare to", () => {
    expect(isNewDevice(known, [])).toBe(false);
  });

  it("counts ENDED sessions as history — a device they signed out of is not new", () => {
    // The caller passes every past row, revoked or not; this is the assertion
    // that the rule is about familiarity, not about what is live.
    const oldDevice = { fingerprint: "old", ip: "5.5.5.5" };
    expect(isNewDevice(oldDevice, [...history, oldDevice])).toBe(false);
  });
});

describe("the notice a member actually reads", () => {
  it("names the device, the day, and what to do about it", () => {
    const text = newDeviceNotice({
      label: "Chrome on Windows",
      location: "Silver Spring, MD, US",
      when: "6 Aug",
    });
    expect(text).toBe(
      "New sign-in from Chrome on Windows near Silver Spring, MD, US, 6 Aug. " +
        "Not you? Set a new PIN or tell Firaoli.",
    );
  });

  it("drops the location cleanly when there is none", () => {
    const text = newDeviceNotice({ label: "Safari on iPhone", location: null, when: "6 Aug" });
    expect(text).toBe("New sign-in from Safari on iPhone, 6 Aug. Not you? Set a new PIN or tell Firaoli.");
    expect(text).not.toContain("near");
    expect(text).not.toContain("null");
  });

  it("is pure — no request context — so a WhatsApp send can reuse it verbatim", () => {
    // Ruling 5: in-portal today, attachable to a message channel later
    // without rework. Same inputs, same sentence, no headers involved.
    const args = { label: "Chrome on Windows", location: null, when: "6 Aug" };
    expect(newDeviceNotice(args)).toBe(newDeviceNotice({ ...args }));
  });
});
