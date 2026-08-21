# RepoDNA v1.1.0 — Community Launch Kit

This runbook covers a two-day launch for individual developers. It prepares copy and links; every public submission remains a human-approved Chrome handoff.

## Positioning guardrails

- RepoDNA never executes repository code, installs repository dependencies, evaluates downloaded scripts, or invokes repository hooks.
- The web engine uses deterministic language-specific structural parsing. The Python CLI uses the standard-library AST; the web and Python engines are checked against shared structural fixtures.
- Public and private GitHub URL analyses are processed transiently by the Vercel service. Local folders and ZIP uploads are parsed inside the browser.
- Route, architecture, database, and impact results are static inferences with evidence and confidence—not runtime guarantees.
- GitHub OAuth requires the `repo` scope for private repositories. RepoDNA makes read-only GitHub requests and does not modify repositories or persist source code.
- Do not ask users to upvote, coordinate comments, or disclose confidential source code in feedback.

## Launch schedule

Times below use daylight offsets for 25–26 August 2026:

| Date | Time | Platform | Action |
| --- | --- | --- | --- |
| Tue 25 Aug | 00:01 PT / 03:01 ET / 08:01 BST | Product Hunt | Publish the listing and maker comment |
| Tue 25 Aug | 05:30 PT / 08:30 ET / 13:30 BST | X | Publish a two-post announcement thread |
| Wed 26 Aug | 05:00 PT / 08:00 ET / 13:00 BST | Hacker News | Submit the Show HN story and technical comment |
| Wed 26 Aug | 07:30 PT / 10:30 ET / 15:30 BST | r/webdev | Submit the web visualizer post after checking rules |
| Wed 26 Aug | 10:30 PT / 13:30 ET / 18:30 BST | r/Python | Submit the Python-focused post if the first Reddit thread is healthy |

The initial Reddit rollout is limited to `r/webdev` and `r/Python`. `r/programming` and `r/typescript` are reserved for a substantive later release.

## Pre-launch checklist — 22–24 August

- [ ] Create a Product Hunt draft; verify the listing, links, pricing, and accepted image dimensions.
- [ ] Prepare `docs/screenshots/overview.png`, `architecture.png`, `routes-trace.png`, and `dependencies.png`.
- [ ] Smoke-test public GitHub analysis, private-repository OAuth, local folder and ZIP analysis, Mermaid export, JSON export, feedback, and mobile layout.
- [ ] Confirm Vercel production health, Upstash rate limiting, GitHub CI, OAuth callback URLs, and PostHog EU consent/events.
- [ ] Inspect the current `r/webdev` and `r/Python` rules immediately before preparing each form.
- [ ] Add source-specific UTM links only; never include repository URLs, names, paths, symbols, or analysis output in analytics properties.

## Hacker News — Show HN

- Submit: <https://news.ycombinator.com/submit>
- Title: `Show HN: RepoDNA – Zero-execution visual architecture and trace explorer`
- URL: <https://repodna-one.vercel.app/?utm_source=hackernews&utm_medium=launch&utm_campaign=repodna_v1_1>

First comment:

```text
Hey HN,

I built RepoDNA to make exploring unfamiliar codebases faster and more visual.

Instead of running a repository, installing its dependencies, or relying on an LLM, RepoDNA reads source as text and builds a deterministic structural map:

- Python, JavaScript, and TypeScript language-specific parsing.
- Route and execution-flow inference for FastAPI, Express, NestJS, and Next.js patterns.
- Architecture layers, dependency edges, cycle signals, impact slices, and Mermaid export.
- Public GitHub URLs, private repositories through GitHub OAuth, and local folders or ZIPs.

The analyzer never executes repository code. Results are static inferences with evidence and confidence, and the project is free and open source under MIT.

I would especially value feedback on parser edge cases, false positives, and which language adapter would be most useful next.
```

## Reddit: r/webdev

- Submit: [r/webdev submission](https://www.reddit.com/r/webdev/submit?title=RepoDNA%3A%20Interactive%20architecture%20maps%20and%20execution%20flows%20for%20Next.js%2C%20Express%2C%20and%20FastAPI)
- Title: `RepoDNA: Interactive architecture maps and execution flows for Next.js, Express, and FastAPI`
- URL: <https://repodna-one.vercel.app/?utm_source=reddit_webdev&utm_medium=launch&utm_campaign=repodna_v1_1>
- Focus: React Flow architecture map, Next.js/Express route detection, Mermaid export, and browser-local folder analysis.

```markdown
Hey r/webdev!

I built [RepoDNA](https://repodna-one.vercel.app/?utm_source=reddit_webdev&utm_medium=launch&utm_campaign=repodna_v1_1), an open-source visualizer for understanding unfamiliar web codebases.

It reads source statically and never executes repository code. It can:

- Group files into inferred API, services, frontend, database, and configuration layers.
- Trace likely paths from Next.js, Express, NestJS, and FastAPI routes through local symbols.
- Show dependency and impact views and export the architecture as Mermaid.
- Analyze a public GitHub URL, a local folder selected with `webkitdirectory`, or a ZIP entirely in the browser.

The results are evidence-backed inferences rather than runtime guarantees. I would love feedback on the architecture heuristics and missing web framework adapters.

Live app: https://repodna-one.vercel.app
Source: https://github.com/AnasBabari/RepoDNA
```

## Reddit: r/Python

- Submit: [r/Python submission](https://www.reddit.com/r/Python/submit?title=RepoDNA%3A%20Visual%20architecture%20mapping%20and%20route-to-model%20tracing%20for%20Python%20codebases)
- Title: `RepoDNA: Visual architecture mapping and route-to-model tracing for Python codebases`
- URL: <https://repodna-one.vercel.app/?utm_source=reddit_python&utm_medium=launch&utm_campaign=repodna_v1_1>
- Focus: Python AST CLI, shared fixtures, FastAPI/Flask/Django patterns, ORM detection, and confidence-based flow inference.

```markdown
Hey Pythonistas!

I built [RepoDNA](https://repodna-one.vercel.app/?utm_source=reddit_python&utm_medium=launch&utm_campaign=repodna_v1_1), an open-source static analyzer and visualizer for Python and full-stack repositories.

The Python CLI uses the standard-library `ast` module to extract classes, functions, imports, routes, calls, and ORM evidence without running the project. The web engine provides a browser-first structural analyzer, and both engines are checked against shared structural fixtures.

It recognizes patterns such as FastAPI router prefixes, Flask routes, Django URL patterns, SQLAlchemy/SQLModel/Beanie models, and local dependency flows. Results include evidence and confidence so heuristics are visible.

Try it: https://repodna-one.vercel.app
Source: https://github.com/AnasBabari/RepoDNA

Feedback on parser edge cases and useful Python framework adapters is welcome.
```

## Product Hunt

- Draft: <https://www.producthunt.com/posts/new>
- Product name: `RepoDNA`
- Tagline: `Understand and trace any codebase visually in seconds`
- Pricing: `Free / Open Source (MIT)`
- Website: <https://repodna-one.vercel.app/?utm_source=producthunt&utm_medium=launch&utm_campaign=repodna_v1_1>
- Source: <https://github.com/AnasBabari/RepoDNA>
- Media: `docs/screenshots/overview.png`, `architecture.png`, `routes-trace.png`, `dependencies.png`

Maker comment:

```markdown
Hey Product Hunt! 👋

When onboarding to an unfamiliar codebase, understanding how routes, services, components, and data layers connect is often the hardest part.

RepoDNA turns that structure into an interactive map:

1. Paste a public or authorized private GitHub URL, or select a local folder.
2. RepoDNA reads source statically and never executes repository code.
3. Explore architecture layers, route-flow inferences, impact views, and Mermaid export.

It is free, open source under MIT, and designed to make parser evidence visible instead of hiding guesses behind a black box.

I would love to hear which frameworks and codebase questions should come next.
```

## X — two-post thread

Post 1:

```text
🚀 RepoDNA is live: understand unfamiliar codebases visually.

🗺️ Architecture maps
🔍 Route-flow and impact views
📐 Mermaid export
🔒 Public + authorized private GitHub repos
🧭 Local folder/ZIP analysis in the browser

Try it: https://repodna-one.vercel.app/?utm_source=x&utm_medium=launch&utm_campaign=repodna_v1_1
```

Post 2:

```text
RepoDNA reads source as text and never executes repository code. Results are deterministic structural inferences with evidence and confidence—not LLM-generated guesses.

Open source: https://github.com/AnasBabari/RepoDNA

#opensource #webdev #python
```

## Chrome-assisted handoff

1. Open the target platform in the user’s signed-in Chrome session.
2. Verify the current URL, title, community rules, flair, copy, links, and screenshots.
3. Stop for user approval immediately before publishing each story, post, or comment.
4. If a login, CAPTCHA, OAuth prompt, moderation warning, or safety interstitial appears, hand control to the user.
5. After publishing, record the live URL and timestamp in the launch log; do not solicit votes or coordinated engagement.

## Response and measurement

- Reply to genuine questions and acknowledge parser limitations.
- Monitor Vercel errors, GitHub OAuth failures, Upstash quotas, and PostHog opt-in events.
- Track only source type, platform, outcome code, duration bucket, and engagement events—never repository identity or code.
- After 48 hours, record visitors, analysis starts/completions, workspace engagement, private-auth conversion, errors, feedback score, and GitHub stars.

## FAQ

**How is this different from a basic dependency graph?**

RepoDNA combines import edges with symbols, routes, framework evidence, architecture layers, confidence-rated flows, and impact slices.

**Is my code sent to an LLM?**

No. RepoDNA does not use an LLM for parsing and never executes repository code. Local folders and ZIPs stay in the browser; GitHub URL analysis is processed transiently by the service.

**Does private-repository access modify my code?**

No. GitHub OAuth is used for read-only GET requests. RepoDNA does not write to repositories, install hooks, or persist source code.

**Will you support Go, Rust, or Java?**

Language adapters are possible, but no release date is promised. Feedback on the next most useful adapter is welcome.
