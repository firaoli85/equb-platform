// Throttle for the UNAUTHENTICATED phone-lookup step of member login: the
// directory's phone→name pairing is 2.8-protected, so nobody may enumerate
// it by hammering the endpoint. Sliding window, keyed per caller IP and per
// tried phone.
//
// LIMITATION (documented on purpose): the counters are in-process. They
// reset on restart and do not aggregate across multiple server instances —
// acceptable for this single-instance deployment; a durable store should
// replace this if the platform is ever scaled out.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_KEY = 8;

const attempts = new Map<string, number[]>();

function prune(now: number) {
  for (const [key, times] of attempts) {
    const alive = times.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) attempts.delete(key);
    else attempts.set(key, alive);
  }
}

/** Record one attempt for the key; returns false when over the limit. */
export function allowLookup(key: string, now = Date.now()): boolean {
  if (attempts.size > 5000) prune(now);
  const times = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_KEY) {
    attempts.set(key, times);
    return false;
  }
  times.push(now);
  attempts.set(key, times);
  return true;
}

export const LOOKUP_THROTTLE_MESSAGE =
  "Too many tries. Wait a few minutes and try again.";
