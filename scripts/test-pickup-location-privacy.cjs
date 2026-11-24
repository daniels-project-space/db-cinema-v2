const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, db, put } = require("./lib/rentalTestHarness.cjs");

const {
  TRAFALGAR_PICKUP_ADDRESS,
  TRAFALGAR_PICKUP_AREA,
  gafferPickupDisclosureInstruction,
  redactPickupDisclosureText,
} = load("shared/pickupLocation.ts");

async function main() {
  const beforeGates = gafferPickupDisclosureInstruction(TRAFALGAR_PICKUP_AREA, null);
  assert.match(beforeGates, /general area before a booking is paid, verified and confirmed/i);
  assert.match(beforeGates, /in Trafalgar Square/i);
  assert.doesNotMatch(beforeGates, /The Grand Building|Waterstones|WC2N\s*5EJ|\+44/i);

  const afterGates = gafferPickupDisclosureInstruction(TRAFALGAR_PICKUP_AREA, TRAFALGAR_PICKUP_ADDRESS);
  assert.match(afterGates, /passed payment, verification and booking confirmation/i);
  assert.ok(afterGates.includes(TRAFALGAR_PICKUP_ADDRESS));

  const historicalMessage = `Pickup address: The Grand Building\nTrafalgar Square\nLondon\nWC2N 5EJ\nPlease meet us at the confirmed time outside the Waterstones bookstore at Trafalgar Square.\nhttps://www.google.com/maps/search/The+Grand+Building\nCall +44 7933 019849`;
  const redacted = redactPickupDisclosureText(historicalMessage, "10 Example Street, London SW1A 1AA");
  assert.match(redacted, /Trafalgar Square/);
  assert.doesNotMatch(redacted, /The Grand Building|Waterstones|WC2N\s*5EJ|google\.com\/maps\/search|\+44\s*7933/i);
  for (const phone of ["07933 019849", "0044 7933 019849", "44 (0)7933-019849"]) {
    assert.doesNotMatch(redactPickupDisclosureText(`Call Leo on ${phone} outside the Grand Building.`), /07933|7933|Grand Building/i,
      `alternate formatting cannot bypass the pre-handover disclosure filter: ${phone}`);
  }
  assert.doesNotMatch(redactPickupDisclosureText("Delivery address: 10 Example Street, London SW1A 1AA", "10 Example Street, London SW1A 1AA"), /10 Example Street/i);

  const settings = load("convex/settings.ts");
  put("settings", { businessAddress: TRAFALGAR_PICKUP_ADDRESS });
  const publicSettings = await settings.get.handler({ db }, {});
  assert.equal("businessAddress" in publicSettings, false, "public settings never expose the configured exact address");

  const contactPage = fs.readFileSync(path.join(__dirname, "../src/app/contact/page.tsx"), "utf8");
  assert.match(contactPage, /Trafalgar Square, London/);
  assert.doesNotMatch(contactPage, /The Grand Building|WC2N\s*5EJ|Waterstones bookstore/i);
  console.log("PASS pickup disclosure: public area stays visible; exact address, landmark and directions stay gated and historical Gaffer context is redacted.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
