# RepoDNA

**Understand any codebase visually.**

RepoDNA turns an unfamiliar Python, JavaScript, or TypeScript repository into a portable structural map: files, symbols, imports, routes, databases, external systems, architecture layers, execution traces, impact slices, and an onboarding tour.

It is deterministic, local-first, and does not use an LLM. The analyzer reads source as text and never executes repository code.

## Screenshots

### Repository overview

![RepoDNA repository overview](docs/screenshots/overview.png)

### Interactive architecture map

![RepoDNA interactive architecture map](docs/screenshots/architecture.png)

## What V1 does

- Analyses local repositories and public GitHub URLs.
- Parses Python with the standard-library AST.
- Extracts JavaScript and TypeScript structure with a dedicated language adapter.
- Detects FastAPI, Flask, Django, React, Express, and Next.js patterns.
- Detects SQLAlchemy, Django ORM, Prisma, Supabase, raw SQL, and common external services.
- Resolves local import edges and high-confidence call edges.
- Ranks entry points and important files with visible evidence and confidence.
- Groups files into architecture components and calculates graph health signals.
- Traces common route-to-function execution paths.
- Answers “what depends on this?” from the normalized graph.
- Generates a deterministic onboarding tour.
- Exports the complete analysis as `repodna.json`.
- Reuses cached results for unchanged files on later runs.
- Renders the result in an interactive React Flow workspace.

## Quick start

RepoDNA requires Python 3.11+ and Node.js 22.13+.

```bash
git clone https://github.com/AnasBabari/RepoDNA.git
cd RepoDNA
python -m pip install -e .
npm install
```

Analyse a local repository:

```bash
repodna analyse ../your-project
```

Analyse a public GitHub repository:

```bash
repodna analyse https://github.com/owner/repository
```

Both commands write:

```text
.repodna/project.json
.repodna/cache.json
```

Open the visualizer:

```bash
npm run dev
```

Then open `http://localhost:3000`, choose **Analyse repository**, and load `.repodna/project.json`.

## CLI

```bash
repodna analyse <path-or-public-github-url> [-o output.json]
repodna trace <route-or-symbol> [--project output.json]
repodna impact <symbol> [--project output.json]
repodna --version
```

Examples:

```bash
repodna trace checkout
repodna impact UserService
```

## Architecture

```text
Repository layer
  local filesystem / public GitHub archive / ignore and safety limits
        ↓
Language adapters
  Python AST / JavaScript and TypeScript structural parser
        ↓
Graph generator
  files / symbols / imports / calls / routes / components / flows
        ↓
repodna.json
  versioned portable protocol
        ↓
Visualizer
  overview / architecture / trace / impact / files / onboarding
```

The analyzer and viewer are deliberately independent. The viewer only consumes the normalized artifact; it does not know how the repository was acquired or parsed. See [Architecture](docs/ARCHITECTURE.md) and [Schema](docs/SCHEMA.md).

## Safety model

RepoDNA does not run `npm install`, `pip install`, application entry points, shell scripts, Makefiles, Dockerfiles, or repository hooks while analysing a project.

It also:

- honours `.gitignore` plus built-in generated/vendor exclusions;
- ignores symlinks and binary files;
- limits file count, individual file size, archive download size, and extracted archive size;
- validates GitHub archive paths before extraction;
- records parse failures as diagnostics instead of failing the full repository.

See [SECURITY.md](SECURITY.md) for the trust boundary and reporting process.

## Development

Run the engine tests:

```bash
python -m pip install -e .
python -m unittest discover -s tests -v
```

Validate the viewer:

```bash
npm run lint
npm run build
```

Regenerate the checked-in demo artifact:

```bash
repodna analyse tests/fixtures/mixed-basic -o public/demo-project.json
```

The golden fixture covers a mixed React/Express/FastAPI/SQLAlchemy repository and verifies routes, symbols, local dependency resolution, architecture grouping, tracing, impact analysis, ignore rules, archive safety, JSON export, and incremental caching.

## V1 boundaries

V1 intentionally excludes AI chat, private GitHub OAuth, accounts, billing, collaboration, PR review, cloud repository storage, automated code modification, and broad language support. The goal is to prove that static structure alone can make an unfamiliar repository understandable.

## License

[MIT](LICENSE)
