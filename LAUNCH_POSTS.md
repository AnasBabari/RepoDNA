# 🚀 RepoDNA v1.1.0 — Community Launch Kit & Copy

This document contains pre-formatted submission copy, direct 1-click submit links, and tags ready for Reddit, Hacker News, Product Hunt, and X (Twitter).

---

## 1. Reddit Launch

### Direct Submit Links:
- 🔗 [Submit to r/programming](https://www.reddit.com/r/programming/submit?title=RepoDNA%3A%20I%20built%20a%20zero-code-execution%20visual%20architecture%20and%20execution%20trace%20visualizer%20for%20Python%2C%20JS%2C%20and%20TS)
- 🔗 [Submit to r/webdev](https://www.reddit.com/r/webdev/submit?title=RepoDNA%3A%20I%20built%20a%20zero-code-execution%20visual%20architecture%20and%20execution%20trace%20visualizer%20for%20Python%2C%20JS%2C%20and%20TS)
- 🔗 [Submit to r/Python](https://www.reddit.com/r/Python/submit?title=RepoDNA%3A%20I%20built%20a%20zero-code-execution%20visual%20architecture%20and%20execution%20trace%20visualizer%20for%20Python%20and%20TypeScript)
- 🔗 [Submit to r/typescript](https://www.reddit.com/r/typescript/submit?title=RepoDNA%3A%20I%20built%20a%20zero-code-execution%20visual%20architecture%20and%20execution%20trace%20visualizer%20for%20TypeScript%20and%20Python)

### Post Title:
```text
RepoDNA: I built a zero-code-execution visual architecture and execution trace visualizer for Python, JS, and TS
```

### Post Body (Markdown):
```markdown
Hey everyone!

Whenever I jump into a new or unfamiliar codebase, I spend the first few days manually digging through routers, tracking down database models, and mentally mapping architecture layers.

I built **[RepoDNA](https://repodna-one.vercel.app)** ([GitHub](https://github.com/AnasBabari/RepoDNA)) to turn any repository into an interactive structural map in seconds.

### Key Features:
- **Zero Runtime Code Execution**: It never runs `npm install`, `pip install`, `eval`, or untrusted scripts. It parses abstract syntax trees as text safely in memory or 100% inside your browser tab.
- **Deep Execution Tracing**: Follows multi-tier execution paths from HTTP routes (FastAPI, Express, NestJS, Next.js App Router) down through controllers, services, and ORM models (Prisma, SQLAlchemy, SQLModel, Beanie).
- **Interactive Architecture Map**: Drag, pan, and zoom through clustered layers with glowing dependency edges and instant **Mermaid flowchart export**.
- **Change Impact & Blast Radius**: Inspect what symbols and files break when a core model or function changes.
- **Client-Side First**: Analyze public GitHub URLs, pick a local folder directly from your machine (`webkitdirectory`), or upload a `.zip`.
- **Private Repository Beta**: Sign in with GitHub OAuth to securely inspect your own private repositories transiently in memory.

### Tech Stack:
- **Core Engine**: TypeScript AST parser + Python static analyzer
- **Frontend**: Next.js / React Flow / Lucide icons / Custom cyberpunk theme & transparent scrollbars
- **Safety**: Upstash sliding-window rate limiting, ZIP-bomb protection, and EU-hosted privacy-safe telemetry.

Live App: **https://repodna-one.vercel.app**  
Source Code: **https://github.com/AnasBabari/RepoDNA**

I’d love to hear your feedback, thoughts on missing framework adapters, or feature ideas!
```

---

## 2. Hacker News (Show HN)

- 🔗 [Submit to Hacker News](https://news.ycombinator.com/submit)

### Title:
```text
Show HN: RepoDNA – Zero-execution visual architecture and trace explorer
```

### URL:
```text
https://repodna-one.vercel.app
```

### First Comment:
```text
Hey HN,

I built RepoDNA (https://github.com/AnasBabari/RepoDNA) to make exploring unfamiliar codebases fast and visual.

Instead of running the repository (which requires installing dependencies, configuring Docker, or running untrusted code), RepoDNA statically parses Python, TypeScript, and JavaScript syntax as text:
- Resolves routes (FastAPI, Express, NestJS, Next.js) down to database models (SQLAlchemy, Prisma, Beanie).
- Renders an interactive React Flow architecture map with layer clustering and Mermaid diagram export.
- Supports public GitHub URLs, private repositories (via GitHub OAuth in-memory transience), and local folders via browser file system access.

It's free, open-source (MIT), and does not use LLMs for parsing. Feedback and ideas welcome!
```

---

## 3. Product Hunt Launch

- 🔗 [New Product on Product Hunt](https://www.producthunt.com/posts/new)

### Listing Details:
- **Product Name**: `RepoDNA`
- **Tagline**: `Understand and trace any codebase visually in seconds`
- **Short Description**: `Deterministic, zero-code-execution architecture visualizer and execution tracer for Python, TypeScript, and JavaScript repositories.`
- **Pricing**: `Free / Open Source (MIT)`
- **Links**: 
  - Website: `https://repodna-one.vercel.app`
  - GitHub: `https://github.com/AnasBabari/RepoDNA`

### First Maker Comment:
```markdown
Hey Product Hunt! 👋

When onboarding onto a new codebase or reviewing complex pull requests, understanding how layers connect is the hardest part.

We built RepoDNA to solve this:
1. Paste any GitHub URL or select a local project folder.
2. RepoDNA deterministically parses the code (zero execution, safe static analysis).
3. Explore the visual architecture map, multi-tier route execution flows, and export Mermaid diagrams for your documentation.

It’s 100% free and open-source (MIT). Try it out and let us know what frameworks or features you'd like to see next!
```

---

## 4. X / Twitter Announcement

```text
🚀 Introducing RepoDNA v1.1: Understand any codebase visually in seconds.

⚡ Zero code execution (safe AST parsing)
🗺️ Interactive Architecture Map + Mermaid export
🔍 Deep multi-tier execution tracing (Route → Service → DB)
🔒 Private Repo Beta with GitHub OAuth

Try it live: https://repodna-one.vercel.app
GitHub: https://github.com/AnasBabari/RepoDNA

#buildinpublic #opensource #webdev #python #typescript
```
