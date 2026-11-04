# Voice lead abuse boundary

The public voice lead mutation accepts bounded fields and limits submissions through a fixed server-owned global counter. Both the website voice tool and the phone webhook continue to submit leads, and report failure rather than claiming an unsaved lead was recorded.

This is not caller authentication. An anonymous caller can consume the shared limit and temporarily prevent legitimate leads; a global cap also does not distinguish malicious traffic from a busy period. A durable solution needs an authenticated, rate-limited voice-session or server-issued capability, with a safe migration for both browser and phone callers. Do not treat this mitigation as proof that the caller or submitted details are genuine.
