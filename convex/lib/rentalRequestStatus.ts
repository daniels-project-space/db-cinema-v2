/** Bounded summaries fail closed when a rental has more history than we inspect. */
export const RENTAL_REQUEST_HISTORY_LIMIT = 200;

export type RentalRequestStatusRow = {
  _id?: string;
  kind?: string;
  status?: string;
  execution?: { status?: string };
};

export function rentalRequestStillOpen(request: RentalRequestStatusRow) {
  return (request.status ?? "pending") === "pending" || request.status === "approved" &&
    !((request.kind === "items" || request.kind === "extension") && !request.execution) &&
    request.execution?.status !== "applied";
}

export function summarizeRentalRequests(rows: RentalRequestStatusRow[], ignoreId?: string) {
  if (rows.length > RENTAL_REQUEST_HISTORY_LIMIT) {
    return { ready: false, any: true, dates: true, cancel: true, handover: true, other: true };
  }
  const open = rows.filter(request => request._id !== ignoreId && rentalRequestStillOpen(request));
  const dates = open.some(request => request.kind === "dates");
  const cancel = open.some(request => request.kind === "cancel");
  const handover = open.some(request => request.kind === "handover");
  const other = open.some(request => request.kind === "items" || request.kind === "extension");
  return { ready: true, any: dates || cancel || handover || other, dates, cancel, handover, other };
}
