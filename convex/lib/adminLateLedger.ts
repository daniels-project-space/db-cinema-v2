import { dateLabel, londonRentalInstant } from "../../shared/rentalWindow";
import { rentalPricingDays } from "../../shared/rentalDuration";

const DAY = 86400000;

export function adminLateBillingLines(booking: any, request: any) {
  const terms = request.adminLateTerms, items = request.quoteItems;
  if (!booking || !Array.isArray(booking.lineItems) || !terms || !Array.isArray(terms.entries) || !terms.entries.length || !Array.isArray(items) || items.length !== terms.entries.length ||
      !Number.isSafeInteger(terms.lateDays) || terms.lateDays < 1 || terms.lateDays > 30 || terms.requestedReturnTime !== request.approvedReturnTime ||
      !Number.isSafeInteger(terms.targetEnd) || dateLabel(terms.targetEnd) !== terms.targetEnd ||
      !Array.isArray(terms.manualRates) || new Set(terms.manualRates.map((rate: any) => rate.lineIndex)).size !== terms.manualRates.length ||
      ![terms.latePence, terms.extensionPence, terms.discountPence, terms.totalPence].every((value: any) => Number.isSafeInteger(value) && value >= 0) ||
      Math.round(request.priceDelta * 100) !== terms.totalPence)
    throw Error("The itemised late extension needs review.");
  const seen = new Set<number>();
  let latePence = 0, extensionPence = 0, billedExtensionPence = 0;
  const charges = terms.entries.flatMap((entry: any) => {
    const line = booking.lineItems?.[entry.lineIndex];
    const item = items.find((candidate: any) => candidate.lineIndex === entry.lineIndex);
    const slot = line?.returnTime === undefined ? booking.returnTime : line?.returnTime;
    const manual = terms.manualRates.find((rate: any) => rate.lineIndex === entry.lineIndex);
    const savedRate = Number.isFinite(line?.dailyRate) ? Math.round(line.dailyRate * 100) : 0;
    if (seen.has(entry.lineIndex) || !line || !item || !slot || String(line.listingId) !== String(entry.listingId) || String(item.listingId) !== String(entry.listingId) ||
        line.title !== entry.title || item.title !== entry.title || line.qty !== entry.qty || item.qty !== entry.qty ||
        entry.coveredEnd !== dateLabel(line.end) + terms.lateDays * DAY || entry.coveredTime !== slot || entry.targetEnd !== terms.targetEnd ||
        item.start !== line.end + DAY || item.end !== terms.targetEnd || londonRentalInstant(entry.coveredEnd, slot) >= londonRentalInstant(terms.targetEnd, terms.requestedReturnTime) ||
        !Number.isSafeInteger(entry.lateDailyPence) || entry.lateDailyPence < 1 || entry.latePence !== entry.lateDailyPence * terms.lateDays ||
        entry.extensionDays !== rentalPricingDays(entry.coveredEnd, terms.targetEnd, slot, terms.requestedReturnTime) ||
        !Number.isSafeInteger(entry.extensionPence) || entry.extensionPence < 0 || !Number.isSafeInteger(Math.round(item.lineTotal * 100)) || item.lineTotal < 0 ||
        (entry.lateRateSource === "manual" ? !manual || manual.confirmed !== true || manual.dailyPence !== entry.lateDailyPence || (line.qty === 1 && savedRate > 0) : entry.lateRateSource !== "booking" || !!manual || line.qty !== 1 || savedRate !== entry.lateDailyPence))
      throw Error("The itemised late extension needs review.");
    seen.add(entry.lineIndex);
    latePence += entry.latePence; extensionPence += entry.extensionPence; billedExtensionPence += Math.round(item.lineTotal * 100);
    return [
      { requestId: request._id, title: `${entry.title} · late rental time`, start: line.end, end: entry.coveredEnd, qty: 1, lineTotal: entry.latePence / 100, returnTime: slot },
      { requestId: request._id, title: `${item.title} · approved extension`, start: entry.coveredEnd, end: item.end, qty: item.qty, lineTotal: item.lineTotal, returnTime: request.approvedReturnTime },
    ];
  });
  const custom = terms.customFee;
  if (custom && (typeof custom.description !== "string" || custom.description.trim().length < 3 || custom.description.length > 120 || !Number.isSafeInteger(custom.amountPence) || custom.amountPence < 1 || custom.amountPence > 100000000)) throw Error("The itemised late extension needs review.");
  const customPence = custom?.amountPence ?? 0;
  if (terms.manualRates.some((rate: any) => !seen.has(rate.lineIndex)) || latePence !== terms.latePence || extensionPence !== terms.extensionPence ||
      billedExtensionPence !== extensionPence - terms.discountPence || latePence + billedExtensionPence + customPence !== terms.totalPence)
    throw Error("The itemised late extension needs review.");
  if (custom) charges.push({ requestId: request._id, title: custom.description.trim(), start: terms.targetEnd, end: terms.targetEnd, qty: 1, lineTotal: customPence / 100, returnTime: request.approvedReturnTime });
  return charges;
}
