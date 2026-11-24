const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/components/admin/RentalWorkspace.tsx", "utf8");
assert.match(source, /href="https:\/\/business\.didit\.me"[\s\S]*?aria-label="Open Didit Business Console"/);
assert.match(source, /Identity verification → User verifications · search this ID/);
assert.match(source, /Session ID · \{b\.diditSessionId\}/);
assert.doesNotMatch(source, /https:\/\/business\.didit\.me\/[^" ]*\$\{b\.diditSessionId\}/, "Do not invent an undocumented Didit session deep link");
console.log("PASS the admin opens Didit's documented console path and can search the exact session ID.");
