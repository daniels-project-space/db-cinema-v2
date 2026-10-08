/** New bookings authorise the agreed hold at the London pickup slot, not checkout. */
export const PICKUP_HOLD_POLICY = "2026-10-pickup-hold-v1";
const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function pickupHoldAt(booking: {
  lineItems: { start: number }[];
  pickupTime?: string;
}) {
  if (
    !booking.lineItems.length ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.pickupTime ?? "")
  )
    throw Error(
      "An agreed pickup date and time are required for the security hold.",
    );
  const day = new Date(Math.min(...booking.lineItems.map((x) => x.start)));
  const [h, m] = booking.pickupTime!.split(":").map(Number);
  const civil = Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    h,
    m,
  );
  let instant = civil;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(
      london
        .formatToParts(new Date(instant))
        .map((x) => [x.type, Number(x.value)]),
    );
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const delta = civil - represented;
    if (!delta) return instant;
    instant += delta;
  }
  throw Error(
    "This pickup time does not exist because the clocks change. Choose another time.",
  );
}
export function pickupHoldEligible(b: any) {
  return (
    !!b &&
    b.securityHoldPolicyVersion === PICKUP_HOLD_POLICY &&
    ["confirmed", "active"].includes(b.status) &&
    !b.cancellationDecision &&
    !b.returnDecision &&
    !b.returnedAt &&
    (b.depositHoldAmount ?? 0) > 0
  );
}
