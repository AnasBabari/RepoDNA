# Samples and fresh GitHub analysis

Normal URL input and `?repo=` / `?url=` resolve the requested GitHub revision;
root URLs resolve current HEAD. A validated immutable-commit artifact may be
reused from the seven-day server cache. This is not a forced cache purge.

Only explicit sample actions and `?sample=` may load bundled JSON. The selector
uses a fixed allowlist, never an arbitrary resource URL. Missing/invalid snapshots
fail explicitly; retry stays a snapshot retry instead of silently scanning GitHub.
The workspace shows the recorded analysis timestamp and commit (or unavailable),
and featured snapshots offer **Analyze latest**, which uses the normal analysis
path. The synthetic demo has no invented commit or GitHub reanalysis target.

Samples retain `sample` origin, do not enter the public workflow or increase the
public successful-repository counter. Fresh public analyses retain their existing
durable/browser origin and counting/privacy rules. Snapshot provenance remains
unchanged in portable JSON. No cache TTL, retention or consent change.
