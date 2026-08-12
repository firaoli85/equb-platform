// WHAT TWILIO'S `status` FIELD ACTUALLY MEANS.
//
// THE BUG THIS EXISTS FOR. Ten MessageLog rows read SENT with no error.
// Twilio's own records show all ten as status=failed, error_code=63112, and
// every one was billed. The platform reported delivery for messages that never
// left Twilio.
//
// The cause was a single missing distinction. Twilio answers a create request
// with 201 Created and status:"queued" — meaning ACCEPTED FOR DELIVERY, not
// delivered. `sendWhatsAppMessage` parsed that body, lifted `status`, and then
// never looked at it: queued, accepted, sending, sent, delivered, failed and
// undelivered all returned ok:true identically, and deliver() wrote SENT for
// every one of them. 63112 is applied ASYNCHRONOUSLY, moments after the 201,
// so by the time Twilio knew the message was dead the platform had already
// recorded it as delivered and moved on.
//
// A LEAF MODULE, deliberately. Both the send path (lib/whatsapp.ts) and the
// status webhook classify the same vocabulary, and the two must never drift —
// a callback that reads "failed" differently from the send would reintroduce
// exactly the disagreement this closes.
//
// Twilio's documented values, in lifecycle order:
//   queued → accepted → sending → sent → delivered
//                                    ↘ undelivered
//                                    ↘ failed
// `read` also exists for WhatsApp specifically, after delivered.

/** How far along a message is, as far as anyone can actually know. */
export type DeliveryClass =
  /** Twilio holds it. NOT delivered, and must never be recorded as such. */
  | "accepted"
  /** Twilio (or Meta) refused it. Terminal. */
  | "failed"
  /** Confirmed to have left for the handset. Terminal. */
  | "delivered";

/** Twilio has it but has not confirmed anything about its fate. */
const ACCEPTED_STATUSES = ["queued", "accepted", "scheduled", "sending"] as const;

/** Twilio is telling us it will not arrive. */
const FAILED_STATUSES = ["failed", "undelivered", "canceled"] as const;

/**
 * Twilio is telling us it went.
 *
 * `sent` counts: for WhatsApp it means the message reached Meta, which is the
 * furthest thing the platform can honestly claim without a `delivered`
 * callback. `read` is past delivered.
 */
const DELIVERED_STATUSES = ["sent", "delivered", "read"] as const;

/**
 * Classify a raw Twilio status string.
 *
 * An UNKNOWN status classifies as "accepted", never as delivered. If Twilio
 * adds a value we have not seen, the safe reading is "we do not know yet" —
 * the whole point of this module is that the platform stops claiming outcomes
 * it has not observed, and an unrecognised word is not an observation.
 */
export function classifyTwilioStatus(status: string | null | undefined): DeliveryClass {
  const value = (status ?? "").trim().toLowerCase();
  if ((FAILED_STATUSES as readonly string[]).includes(value)) return "failed";
  if ((DELIVERED_STATUSES as readonly string[]).includes(value)) return "delivered";
  return "accepted";
}

/** The MessageLog status each class is recorded as. */
export type LoggedStatus = "SENT" | "ACCEPTED" | "FAILED";

export function loggedStatusFor(status: string | null | undefined): LoggedStatus {
  const kind = classifyTwilioStatus(status);
  if (kind === "failed") return "FAILED";
  if (kind === "delivered") return "SENT";
  return "ACCEPTED";
}

/**
 * Is this a state nothing can move on from?
 *
 * Callbacks arrive more than once and OUT OF ORDER — Twilio makes no ordering
 * guarantee. A `sent` callback overtaking a `failed` one would otherwise walk
 * a dead message back to delivered, which is the same false claim this whole
 * change exists to stop, arriving by a different route.
 */
export function isTerminal(logged: LoggedStatus): boolean {
  return logged === "FAILED" || logged === "SENT";
}

/**
 * The status a row should hold after a callback, given what it already holds.
 *
 * Terminal states never regress. Between two terminal states the FIRST one
 * observed wins: a message that Twilio said failed did fail, and a later
 * `sent` for the same SID is out-of-order noise rather than news.
 */
export function nextLoggedStatus(
  current: LoggedStatus,
  incoming: LoggedStatus,
): LoggedStatus {
  if (isTerminal(current)) return current;
  return incoming;
}
