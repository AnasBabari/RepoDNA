# Feedback delivery and retention (#16)

The survey is explicitly aggregate-only, not a support-message inbox. Only
rating 1–5, the six listed use cases and the six listed capability choices are
accepted. Unknown fields (including comments, repository details and identities)
are rejected with 400. No authentication, user hash or free-text logging occurs.

Existing server-only Upstash credentials are reused; no paid service or new
environment variables are provisioned. One bounded Lua operation increments
fixed counters in `repodna:feedback:v1:daily:YYYY-MM-DD`. That day's hash expires
30 days after UTC midnight, never extended by subsequent submissions.
There are no individual responses in this hash and no public read endpoint.
The maintainer may inspect aggregate hashes in Upstash's authenticated console.

A random UUID delivery receipt, unrelated to account/IP/repository, expires in
24 hours. Identical client retries reuse the receipt. An acknowledged receipt
does not count twice within that window, including after a lost HTTP response.
Changed selections create a new receipt. A global 120-request/minute limit uses
a separate 60-second counter, not analysis quotas or identifying IP keys.

The API returns 200 only after Redis acknowledgement. Missing configuration,
timeouts and storage failures return 503; throttling returns 429 plus Retry-After.
The UI preserves selections on all failures and emits success analytics only
after both HTTP success and `{ success: true }`. Existing analytics consent
still governs optional PostHog events. No survey values enter raw server logs.

Tests use mocked Redis or a disposable local Redis instance, never production
survey counters (`node tests/integration/feedback-redis.mjs` verifies real Lua,
TTL, throttling and duplicate retries in an owned Redis 7 container, removed in
finally). Local development without Redis intentionally cannot confirm
delivery; it does not fabricate success or fall back to console logging.
