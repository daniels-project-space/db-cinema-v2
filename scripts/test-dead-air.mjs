/**
 * Regression test for the dead-air watchdog in GafferSession.
 *
 * This has now cut off two live calls. First a stale `lastActivity` fired on the
 * opening tick; then — the case here — a caller asked for three items at once
 * and the watchdog hung up while Gaffer was still fetching them.
 *
 * Replayed from a real call, conv_0701m0kgz59ffxabws8rn3nktfcq (2026-08-22,
 * 172s, marked failure). The caller asked for three items at 129s; the agent
 * chained seven lookups between 145s and 164s and only spoke again at 165s.
 * The old rule sent "the caller has gone quiet" twice during that, at 128s and
 * 142s, and the call died at 172s.
 *
 * The rule under test must satisfy three things at once:
 *   1. never fire during that call
 *   2. still hang up on someone who genuinely walks away, at 20s
 *   3. survive dropped user transcripts — short utterances don't always reach
 *      onMessage, which is what left the timer stale enough to fire at 128s
 *
 * Run: node scripts/test-dead-air.mjs
 */

const SILENCE_MS = 20_000;
const OPENING_SILENCE_MS = 60_000;
const SPEAK_SECS = 9; // TTS time per agent reply; these were multi-sentence

/** 'user_DROPPED' = the caller spoke but the client never saw a transcript. */
const REAL_CALL = [
  [0, "agent"], [8, "user"], [16, "agent"], [25, "user"], [37, "agent"],
  [61, "user"], [69, "agent"], [92, "user"], [99, "agent"],
  [118, "user_DROPPED"],
  [121, "ts"], [123, "te"], [127, "ts"], [128, "te"],
  [129, "user"],
  [145, "ts"], [146, "te"], [148, "ts"], [149, "te"], [151, "ts"], [152, "te"],
  [154, "ts"], [155, "te"], [159, "ts"], [159, "te"], [161, "ts"], [161, "te"],
  [164, "ts"], [164, "te"], [165, "agent"],
];

/**
 * @param opts.stampOnTools  treat a running lookup as activity
 * @param opts.useAwaiting   don't blame the caller while Gaffer owes a reply
 */
function replay(events, { stampOnTools, useAwaiting, until = 175, seenSpeak = false }) {
  const s = {
    last: 0, hasSpoken: seenSpeak, talkUntil: 0,
    tools: 0, awaiting: false, signingOff: false,
  };
  const fired = [];
  let i = 0;

  for (let t = 0; t <= until; t++) {
    while (i < events.length && events[i][0] === t) {
      const e = events[i++][1];
      if (e === "user") { s.last = t * 1000; s.hasSpoken = true; s.awaiting = true; s.signingOff = false; }
      if (e === "agent") { s.awaiting = false; s.last = t * 1000; s.talkUntil = t + SPEAK_SECS; }
      if (e === "ts") { s.tools++; if (stampOnTools) s.last = t * 1000; }
      if (e === "te") { s.tools = Math.max(0, s.tools - 1); if (stampOnTools) s.last = t * 1000; }
      // 'user_DROPPED' deliberately does nothing
    }
    const busy =
      t < s.talkUntil ||
      s.signingOff ||
      (stampOnTools && s.tools > 0) ||
      (useAwaiting && s.awaiting);
    if (busy) { s.last = t * 1000; continue; }
    if (t * 1000 - s.last < (s.hasSpoken ? SILENCE_MS : OPENING_SILENCE_MS)) continue;
    s.signingOff = true;
    fired.push(t);
  }
  return fired;
}

const OLD = { stampOnTools: false, useAwaiting: false };
const NEW = { stampOnTools: true, useAwaiting: true };

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// 1. the bug still reproduces under the old rule, so this test is proving something
const before = replay(REAL_CALL, OLD);
check(
  "old rule cuts the real call off mid-request",
  before.some((t) => t >= 120 && t <= 155),
  `fired at ${before.join("s, ")}s`,
);

// 2. the shipped rule leaves that call alone
const after = replay(REAL_CALL, NEW);
check("new rule never fires during the real call", after.length === 0, after.length ? `fired at ${after.join("s, ")}s` : "never fires");

// 3. a caller who walks away is still hung up on, on time
//    Measured from the moment Gaffer stops speaking, not from t=0 — the greeting
//    owns the first SPEAK_SECS and silence cannot start before it ends.
const walkAway = replay([[0, "agent"]], { ...NEW, until: 60, seenSpeak: true });
const walkSilence = walkAway[0] - SPEAK_SECS;
check(
  "caller who walks away still ends after ~20s of real silence",
  Math.abs(walkSilence - SILENCE_MS / 1000) <= 1,
  `${walkSilence}s of silence (fired at ${walkAway[0]}s)`,
);

// 4. the protection cannot depend on transcripts arriving
const noTranscripts = replay(
  REAL_CALL.map(([t, e]) => [t, e === "user" ? "user_DROPPED" : e]),
  { ...NEW, seenSpeak: true },
);
check(
  "three-item window survives even with every user transcript dropped",
  !noTranscripts.some((t) => t >= 129 && t <= 165),
  noTranscripts.length ? `fired at ${noTranscripts.join("s, ")}s` : "never fires",
);

// 5. someone silent from the very start gets the long opening rope, not 20s
const openingOnly = replay([[0, "agent"]], { ...NEW, until: 80 });
const openingSilence = openingOnly[0] - SPEAK_SECS;
check(
  "silent-from-the-start caller gets the full opening grace, not the short one",
  Math.abs(openingSilence - OPENING_SILENCE_MS / 1000) <= 1,
  `${openingSilence}s of silence (fired at ${openingOnly[0]}s)`,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
