# Public API rate-limit boundary

The public `rateLimit.hit` mutation accepts only the four Next API route buckets and their fixed one-minute policies. Server-owned counters, including verification reuse, contact, follow-up and waitlist limits, cannot be reset through that mutation. The existing daily stale-counter cleanup is unchanged.

This is namespace isolation, not a complete abuse boundary. An anonymous caller can still consume a known public route bucket, causing a targeted denial of service, or create many distinct keys within the length limit. Empty or oversized client identifiers use the anonymous bucket instead of causing a validation error, but this does not authenticate forwarding headers. The Next helper currently fails open if its Convex call fails, so a limiter outage can also leave routes unthrottled.

A separate improvement should authenticate server-to-server limiter calls with a dedicated secret scoped to that purpose, configured independently in the website and Convex environments. Roll out and verify the authenticated caller before retiring the anonymous endpoint; verify missing configuration and failure behavior without exposing secrets or interrupting customer flows. Do not reuse the admin or inbound-email secret.
