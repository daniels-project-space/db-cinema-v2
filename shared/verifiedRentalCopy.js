const INTERNAL_COPY = [
  /\bnot currently stocked\b/i,
  /\b(?:enquiry|inquiry)[\s-]+only\b/i,
  /\bcannot be booked as listed\b/i,
  /\bconfirm\b.{0,220}\b(?:generation|gimbal|charge|cable|mount(?:ing)?|balance)\b/i,
  /\b(?:must|needs? to|need to) be checked\b/i,
];

const GIMBAL_TERMS = /\b(?:gimbal|stabili[sz]er|ronin|rs\s*[- ]?\d+)\b/i;
const RS2 = /\b(?:dji\s*)?rs\s*[- ]?2\b/i;
const ACCESSORY_TERMS = /\b(?:battery|charger|cable|tripod|plate|case|grip|holder|raveneye|mounting)\b/i;

function sanitizeCustomerCopy(value) {
  if (typeof value !== "string") return value;
  const parts = value.replace(/\r/g, "").split(/((?<=[!?])\s+|(?<!\d)\.(?=\s+[A-Z0-9])\s+|\n+)/u);
  const sentences = [];
  for (let index = 0; index < parts.length; index += 2) {
    const sentence = parts[index]?.trim();
    if (!sentence || INTERNAL_COPY.some((pattern) => pattern.test(sentence))) continue;
    const delimiter = parts[index + 1] ?? "";
    sentences.push(`${sentence}${delimiter.startsWith(".") ? "." : ""}`);
  }
  return sentences
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isVerifiedGimbalOwner(listing) {
  const facts = listing?.inventoryFacts;
  return listing?.active === true && !listing.suppressed && !listing.marketingOnly &&
    listing.stockMappingStatus === "complete" && listing.itemType === "gimbal" &&
    facts?.version === 1 && facts.owned === true && Array.isArray(facts.contents) &&
    facts.contents.length > 0 && Array.isArray(listing.components) && listing.components.length > 0;
}

function cleanQuantity(line) {
  return String(line).replace(/^\s*\d+(?:[.,]\d+)?\s*(?:x|×)\s*/i, "").trim();
}

function scaleQuantity(line, multiplier) {
  if (multiplier <= 1) return String(line).trim();
  const text = String(line).trim();
  const match = /^(\s*)(\d+(?:[.,]\d+)?)(\s*(?:x|×)\s*)(.+)$/i.exec(text);
  if (match) return `${match[1]}${Number(match[2].replace(",", ".")) * multiplier}${match[3]}${match[4]}`;
  return `${multiplier} × ${text}`;
}

function lineKey(line) {
  return cleanQuantity(line).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function primaryGimbalFact(owner) {
  return owner.inventoryFacts.contents.find((line) =>
    typeof line === "string" && GIMBAL_TERMS.test(line) && !ACCESSORY_TERMS.test(line),
  );
}

function verifiedGimbalMatches(listing, owners) {
  if (!Array.isArray(listing?.components) || !Array.isArray(owners) || !owners.length) return [];
  const required = new Map();
  for (const component of listing.components) {
    if (!component || !Number.isSafeInteger(component.qty) || component.qty < 1 || !component.inventoryUnitId) continue;
    const unit = String(component.inventoryUnitId);
    required.set(unit, (required.get(unit) ?? 0) + component.qty);
  }
  const matches = [];
  for (const [unit, quantity] of required) {
    const found = owners.filter((owner) =>
      isVerifiedGimbalOwner(owner) && String(owner._id) !== String(listing._id) &&
      owner.components.some((part) => String(part.inventoryUnitId) === unit && Number.isSafeInteger(part.qty) && part.qty > 0),
    );
    const unique = [...new Map(found.map((owner) => [String(owner._id), owner])).values()];
    if (unique.length !== 1) continue;
    const primary = primaryGimbalFact(unique[0]);
    if (!primary) continue;
    matches.push({ owner: unique[0], quantity, primary });
  }
  return matches;
}

function modelFromFact(line) {
  return cleanQuantity(line).replace(/\b(?:gimbal|stabili[sz]er)\b.*$/i, "").trim();
}

function rewriteGimbalReference(value, actualModel) {
  if (typeof value !== "string" || !actualModel || !RS2.test(value)) return value;
  return value.replace(/\b(?:dji\s*)?rs\s*[- ]?2\b/ig, actualModel);
}

function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    if (typeof line !== "string" || !line.trim()) return false;
    const key = lineKey(line);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function displayListingCopy(listing, gimbalOwners = []) {
  if (!listing || typeof listing !== "object") return listing;
  const matches = verifiedGimbalMatches(listing, gimbalOwners);
  let title = sanitizeCustomerCopy(listing.title) ?? listing.title;
  let description = sanitizeCustomerCopy(listing.description);
  let knowledge = listing.knowledge;
  if (knowledge && typeof knowledge === "object") {
    const summary = sanitizeCustomerCopy(knowledge.summary);
    knowledge = { ...knowledge, summary: summary || null };
  }

  let rentalContents = listing.rentalContents;
  let verifiedComponentContents = Array.isArray(listing.verifiedComponentContents)
    ? [...listing.verifiedComponentContents]
    : [];
  for (const match of matches) {
    const actualModel = modelFromFact(match.primary);
    if (actualModel) {
      title = rewriteGimbalReference(title, actualModel);
      description = rewriteGimbalReference(description, actualModel);
      if (knowledge?.summary) knowledge = { ...knowledge, summary: rewriteGimbalReference(knowledge.summary, actualModel) };
    }
    const facts = match.owner.inventoryFacts.contents.map((line) => scaleQuantity(line, match.quantity));
    const included = Array.isArray(rentalContents?.included)
      ? rentalContents.included.filter((line) => typeof line === "string").map((line) => sanitizeCustomerCopy(rewriteGimbalReference(line, actualModel))).filter(Boolean)
      : [];
    const staleGimbalIndex = included.findIndex((line) => RS2.test(line) && GIMBAL_TERMS.test(line));
    if (staleGimbalIndex >= 0) included.splice(staleGimbalIndex, 1, scaleQuantity(match.primary, match.quantity));
    verifiedComponentContents = uniqueLines([...verifiedComponentContents, ...facts]);
    if (rentalContents) rentalContents = { ...rentalContents, included: uniqueLines(included), notes: (rentalContents.notes ?? []).map(sanitizeCustomerCopy).filter(Boolean) };
  }

  if (!rentalContents && matches.length) {
    rentalContents = { included: [], optional: [], excluded: [], notes: [], sources: [], status: "documented" };
  } else if (rentalContents) {
    rentalContents = {
      ...rentalContents,
      included: uniqueLines((rentalContents.included ?? []).map((line) => sanitizeCustomerCopy(line)).filter(Boolean)),
      optional: uniqueLines((rentalContents.optional ?? []).map((line) => sanitizeCustomerCopy(line)).filter(Boolean)),
      excluded: uniqueLines((rentalContents.excluded ?? []).map((line) => sanitizeCustomerCopy(line)).filter(Boolean)),
      notes: (rentalContents.notes ?? []).map(sanitizeCustomerCopy).filter(Boolean),
    };
  }

  const safeRentalContents=rentalContents?{
    ...rentalContents,
    sources:Array.isArray(rentalContents.sources)?rentalContents.sources.map((source)=>({account:source.account,productId:source.productId,url:source.url,checkedAt:source.checkedAt})):[],
  }:null;

  return {
    ...listing,
    title,
    ...(description !== undefined ? { description: description || null } : {}),
    ...(knowledge ? { knowledge } : {}),
    ...(safeRentalContents ? { rentalContents:safeRentalContents } : {}),
    ...(verifiedComponentContents.length ? { verifiedComponentContents } : {}),
  };
}

function includedKeys(listing) {
  const lines = [
    ...(listing?.rentalContents?.included ?? []),
    ...(listing?.verifiedComponentContents ?? []),
    ...(listing?.inventoryFacts?.contents ?? []),
  ];
  return new Set(lines.map(lineKey).filter(Boolean));
}

function componentCounts(listing) {
  const counts = new Map();
  for (const component of listing?.components ?? []) {
    if (!component?.inventoryUnitId || !Number.isSafeInteger(component.qty) || component.qty < 1) continue;
    const unit = String(component.inventoryUnitId);
    counts.set(unit, (counts.get(unit) ?? 0) + component.qty);
  }
  return counts;
}

function bundleContentSimilarity(source, candidate) {
  const left = componentCounts(source), right = componentCounts(candidate);
  const leftTotal = [...left.values()].reduce((sum, qty) => sum + qty, 0);
  const rightTotal = [...right.values()].reduce((sum, qty) => sum + qty, 0);
  let physical = 0;
  if (leftTotal && rightTotal) {
    let shared = 0;
    for (const [unit, qty] of left) shared += Math.min(qty, right.get(unit) ?? 0);
    physical = shared / Math.max(leftTotal, rightTotal);
  }
  const a = includedKeys(source), b = includedKeys(candidate);
  let textual = 0;
  if (a.size && b.size) {
    let shared = 0;
    for (const line of a) if (b.has(line)) shared++;
    textual = shared / Math.max(a.size, b.size);
  }
  if (leftTotal && rightTotal && a.size && b.size) return physical * 0.8 + textual * 0.2;
  return leftTotal && rightTotal ? physical : textual;
}

function mayHaveGimbalComponents(listing) {
  if (!Array.isArray(listing?.components) || listing.components.length === 0) return false;
  if (["Cameras", "Drones", "Packages", "Stabilizers"].includes(listing.category)) return true;
  const text = [listing.title, listing.description, listing.knowledge?.summary, ...(listing.rentalContents?.included ?? [])].filter(Boolean).join(" ");
  return GIMBAL_TERMS.test(text);
}

module.exports = {
  sanitizeCustomerCopy,
  isVerifiedGimbalOwner,
  displayListingCopy,
  bundleContentSimilarity,
  mayHaveGimbalComponents,
};
