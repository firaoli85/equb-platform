import { createHash } from "node:crypto";

// WHO SIGNED IN, IN PLAIN WORDS — pure, from headers the browser already
// sends. No third-party fingerprinting library, no canvas or font probing,
// no tracking script: the user agent and the standard Sec-CH-UA client hints,
// which the browser volunteers on every request anyway.
//
// THIS IS FOR AWARENESS AND MUST NEVER BLOCK. A fingerprint changes when
// Chrome updates itself; an IP changes when someone walks from home Wi-Fi
// onto mobile data. Both happen constantly and neither means an intruder. The
// only thing a new combination earns is a notice the member can read and
// dismiss — never a refused login. Nothing in this file returns a verdict on
// whether a sign-in is allowed, and nothing should.
//
// The output is written for the person reading it: "Chrome on Windows", not
// "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36…".

export type DeviceType = "Phone" | "Tablet" | "Computer";

export type DeviceFacts = {
  browser: string;
  os: string;
  deviceType: DeviceType;
  /** One line for the UI: "Chrome on Windows". */
  label: string;
};

export type DeviceSignals = {
  userAgent: string | null;
  /** Sec-CH-UA — e.g. `"Chromium";v="150", "Google Chrome";v="150"`. */
  chUa?: string | null;
  /** Sec-CH-UA-Platform — e.g. `"Windows"`. */
  chPlatform?: string | null;
  /** Sec-CH-UA-Mobile — `?1` on a phone. */
  chMobile?: string | null;
};

const UNKNOWN_BROWSER = "Unknown browser";
const UNKNOWN_OS = "Unknown device";

/** Strip the quotes client hints arrive wrapped in. Trim FIRST — a leading
 *  space would otherwise stop the opening quote from matching. */
function unquote(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^"+|"+$/g, "").trim();
}

/**
 * The brand names out of a Sec-CH-UA header.
 *
 * Parsed by matching the quoted names directly rather than by splitting on
 * "," and ";". Splitting looks obvious and is wrong: the decoy brands browsers
 * inject to stop exactly that (`"Not;A=Brand"`, `"Not(A:Brand"`) contain those
 * separators INSIDE the quotes, so a split leaves `"Not` behind and the decoy
 * survives the filter that was meant to remove it.
 */
function brandNames(header: string | null | undefined): string[] {
  const names: string[] = [];
  for (const match of (header ?? "").matchAll(/"([^"]*)"\s*;\s*v\s*=/g)) {
    names.push(match[1].trim());
  }
  // A decoy is any brand whose letters spell "notabrand"; the punctuation
  // between them is randomised on purpose, so compare letters only.
  return names.filter(
    (name) => name && name.replace(/[^a-z]/gi, "").toLowerCase() !== "notabrand",
  );
}

/**
 * The browser name. Client hints win when present because they are the
 * browser's own statement; the UA string is a compatibility fiction that has
 * every other browser's name inside it (Edge says "Chrome", Chrome says
 * "Safari"), so order of testing is load-bearing — most specific first.
 */
function browserFrom(signals: DeviceSignals): string {
  const named = brandNames(signals.chUa);
  if (named.length > 0) {
    // "Chromium" is the engine every Chromium browser also reports; the other
    // name is the product the member would recognise.
    const preferred = named.find((n) => !/^chromium$/i.test(n)) ?? named[0];
    if (preferred) return preferred;
  }

  const ua = signals.userAgent ?? "";
  if (!ua) return UNKNOWN_BROWSER;
  if (/\bEdg[A-Z]?\//.test(ua)) return "Edge";
  if (/\bOPR\/|\bOpera\b/.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "Firefox";
  if (/\bCriOS\//.test(ua)) return "Chrome";
  if (/\bChrome\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua)) return "Safari";
  return UNKNOWN_BROWSER;
}

function osFrom(signals: DeviceSignals): string {
  const platform = unquote(signals.chPlatform);
  if (platform && platform.toLowerCase() !== "unknown") {
    return platform === "macOS" ? "Mac" : platform;
  }

  const ua = signals.userAgent ?? "";
  if (!ua) return UNKNOWN_OS;
  if (/\biPhone\b/.test(ua)) return "iPhone";
  if (/\biPad\b/.test(ua)) return "iPad";
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/\bWindows\b/.test(ua)) return "Windows";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "Mac";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bLinux\b/.test(ua)) return "Linux";
  return UNKNOWN_OS;
}

/**
 * Phone, tablet or computer.
 *
 * Sec-CH-UA-Mobile decides whenever it is present — BOTH ways, not just when
 * it says `?1`. Browser and OS above already come from the hints when they
 * exist, and letting the device type alone fall through to the user agent
 * produced incoherent rows in testing ("Chromium on Windows" labelled as a
 * Phone, because the hints said desktop Chromium while the UA string said
 * iPhone). One source per row, or the row describes no real device.
 *
 * A tablet still needs the UA: there is no client hint for it, and `?0` from
 * an iPad means only "not a phone".
 */
function deviceTypeFrom(signals: DeviceSignals, os: string): DeviceType {
  const mobileHint = unquote(signals.chMobile);
  const ua = signals.userAgent ?? "";
  const looksTablet =
    /\biPad\b/.test(ua) ||
    os === "iPad" ||
    /\bTablet\b/.test(ua) ||
    (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua));

  if (mobileHint === "?1") return "Phone";
  if (mobileHint === "?0") return looksTablet ? "Tablet" : "Computer";

  // No hint at all (Safari, Firefox): the user agent is all there is.
  if (looksTablet) return "Tablet";
  if (/\biPhone\b|\bMobile\b/.test(ua)) return "Phone";
  return "Computer";
}

/** Everything the UI needs to say where a sign-in came from. */
export function describeDevice(signals: DeviceSignals): DeviceFacts {
  const browser = browserFrom(signals);
  const os = osFrom(signals);
  const deviceType = deviceTypeFrom(signals, os);
  const label =
    browser === UNKNOWN_BROWSER && os === UNKNOWN_OS
      ? "Unrecognised device"
      : browser === UNKNOWN_BROWSER
        ? os
        : os === UNKNOWN_OS
          ? browser
          : `${browser} on ${os}`;
  return { browser, os, deviceType, label };
}

/**
 * A stable-ish handle for "this browser on this machine".
 *
 * Hashed rather than stored raw so the sessions table is not a readable list
 * of everyone's exact software versions, and truncated because we only need
 * to compare it, never to reverse it.
 *
 * DELIBERATELY WEAK. It is the browser's own self-description and nothing
 * more — two identical phones produce the same value, and one browser update
 * changes it. That is fine: it exists to say "this looks new, have a look",
 * never to prove identity.
 */
export function deviceFingerprint(signals: DeviceSignals): string {
  const facts = describeDevice(signals);
  const material = [
    facts.browser,
    facts.os,
    facts.deviceType,
    // The major version only. Including the full version would change the
    // fingerprint on every patch release and cry wolf constantly.
    (signals.userAgent ?? "").match(/\b\d+/)?.[0] ?? "",
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Approximate location, from headers the HOSTING PLATFORM adds — no
 * geolocation service is called and no IP database ships with the app.
 * Vercel provides these; anywhere else they are simply absent and we say so
 * rather than inventing a city.
 */
export function approximateLocation(geo: {
  city?: string | null;
  region?: string | null;
  country?: string | null;
}): string | null {
  const city = (geo.city ?? "").trim();
  const region = (geo.region ?? "").trim();
  const country = (geo.country ?? "").trim();
  // Vercel percent-encodes non-ASCII city names.
  const decodedCity = city ? safeDecode(city) : "";
  const parts = [decodedCity, region, country].filter(Boolean);
  if (parts.length === 0) return null;
  // "Silver Spring, MD, US" — but never repeat a value (region === country
  // happens for city-states).
  return [...new Set(parts)].join(", ");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type SeenBefore = { fingerprint: string; ip: string };

/**
 * Is this device/IP combination new for this member?
 *
 * NEW means: we have never seen this fingerprint AND never seen this IP. A
 * familiar browser on a new network is not news (they left the house), and a
 * new browser on the home network is not news either (they updated, or opened
 * a different one). Requiring BOTH to be unfamiliar is what keeps this notice
 * rare enough that a member still reads it.
 *
 * The first sign-in ever is not "new" — there is nothing to compare it to,
 * and telling someone their very first login looks suspicious is noise.
 */
export function isNewDevice(
  candidate: SeenBefore,
  history: readonly SeenBefore[],
): boolean {
  if (history.length === 0) return false;
  const knownFingerprint = history.some((h) => h.fingerprint === candidate.fingerprint);
  const knownIp = history.some((h) => h.ip === candidate.ip);
  return !knownFingerprint && !knownIp;
}

/**
 * The member-facing notice. Written so the next step is obvious to someone
 * who is not technical, and so it names the organizer rather than "support".
 *
 * Kept here, next to the detection, because the wording IS the feature: this
 * is the whole security benefit of the awareness model, and it has to be
 * readable by a member who has never thought about sessions.
 */
export function newDeviceNotice(input: {
  label: string;
  location: string | null;
  when: string;
  organizerName?: string;
}): string {
  const where = input.location ? ` near ${input.location}` : "";
  const who = input.organizerName ?? "Firaoli";
  return (
    `New sign-in from ${input.label}${where}, ${input.when}. ` +
    `Not you? Set a new PIN or tell ${who}.`
  );
}
