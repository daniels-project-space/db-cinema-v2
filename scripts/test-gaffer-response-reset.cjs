const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const file = path.join(__dirname, '../src/components/gaffer/responseTurnGate.ts');
const compiled = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const moduleContext = { exports: {} };
vm.runInNewContext(compiled, { module: moduleContext, exports: moduleContext.exports });
const gate = moduleContext.exports.createResponseTurnGate();

assert.equal(gate.acceptPart({ type: 'start', event_id: 1 }, true), true);
assert.equal(gate.acceptPart({ type: 'start', event_id: 2 }, true), false);
assert.equal(gate.isAmbiguous, true);
gate.reset();
assert.equal(gate.isAmbiguous, false, 'A new connection must not inherit an ambiguous response');
assert.equal(gate.acceptMessage({ event_id: 1, message: 'Hello' }, true), true,
  'A new connection accepts a final-only provider response');
gate.reset();
assert.equal(gate.noteCallerTurn({ event_id: 20 }), true);
assert.equal(gate.acceptPart({ type: 'start', event_id: 21, response_id: 'current' }, true), true);
assert.equal(gate.interrupt({ event_id: 19, response_id: 'previous' }), false,
  'A delayed interruption from an older turn must not close the current answer');
assert.equal(gate.interrupt({ event_id: 22, response_id: 'previous' }), false,
  'An interruption tied to a different response must not close the current answer');
assert.equal(gate.acceptPart({ type: 'delta', event_id: 22, response_id: 'current', text: 'Still speaking' }), true);
assert.equal(gate.interrupt({ event_id: 23, response_id: 'current' }), true,
  'A current interruption still stops the answer');
assert.equal(gate.hasActiveResponse, false);
assert.equal(gate.canInterrupt({ event_id: 22 }), false,
  'An interruption older than the most recent response start is rejected before provider audio state changes');
gate.reset();
assert.equal(gate.noteCallerTurn({ event_id: 30 }), true);
assert.equal(gate.acceptPart({ type: 'start', event_id: 31, response_id: 'spoken-response' }, true), true);
assert.equal(gate.acceptPart({ type: 'delta', event_id: 32, response_id: 'spoken-response', text: 'I will check the dates.' }), true);
assert.equal(gate.acceptPart({ type: 'start', event_id: 33, response_id: 'overlapping-final-only' }, false), false);
assert.equal(gate.acceptMessage({ event_id: 34, message: 'The booking has been cancelled.' }, false), false,
  'A final-only overlapping response without an ID cannot replace the active spoken transcript');
assert.equal(gate.acceptMessage({ event_id: 35, message: 'I will check the dates.' }, false), true,
  'The matching active response transcript remains acceptable after an overlapping start');
gate.reset();
assert.equal(gate.acceptPart({ type: 'start', event_id: 1 }, true), true);
assert.equal(gate.interrupt(), true, 'An unlabelled provider interruption preserves caller barge-in');
assert.equal(gate.suppressAudio, true, 'An interruption cannot leak replacement audio before a new caller turn');
assert.equal(gate.noteCallerTurn({ event_id: 2 }), true);
assert.equal(gate.suppressAudio, true, 'A caller turn does not unsuppress delayed audio before its response starts');
assert.equal(gate.acceptPart({ type: 'start', event_id: 3, response_id: 'replacement' }, true), true);
assert.equal(gate.suppressAudio, false, 'An accepted replacement response start re-enables spoken audio');
gate.reset();
assert.equal(gate.noteCallerTurn({ event_id: 200 }), true);
assert.equal(gate.acceptPart({ type: 'start', event_id: 199, response_id: 'late-prior-turn' }, true), false,
  'An out-of-order response start from before the latest caller turn cannot open a stale conclusion');
assert.equal(gate.hasActiveResponse, false, 'Rejecting a stale start leaves the current turn available to answer');
assert.equal(gate.acceptPart({ type: 'start', event_id: 200, response_id: 'same-turn-response' }, true), true,
  'A provider response sharing the caller turn event ID remains valid');
console.log('Gaffer response reset regression passed');
