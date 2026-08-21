from __future__ import annotations

import re
from pathlib import PurePosixPath

from repodna.model import CallEdge, ImportEdge, PartialAnalysis, Route, Symbol

from .base import LanguageAnalyzer


IMPORT_RE = re.compile(
    r"(?:import\s+(?P<bindings>[\s\S]*?)\s+from\s+|import\s*\(|require\s*\()"
    r"[\"'](?P<module>[^\"']+)[\"']"
)
EXPORT_RE = re.compile(r"^\s*export\s+(?:default\s+)?")
CLASS_RE = re.compile(r"\bclass\s+(?P<name>[A-Za-z_$][\w$]*)")
FUNCTION_RE = re.compile(
    r"(?:async\s+)?function\s+(?P<decl>[A-Za-z_$][\w$]*)\s*\(|"
    r"(?:const|let|var)\s+(?P<arrow>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?"
    r"(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
INTERFACE_RE = re.compile(r"\binterface\s+(?P<name>[A-Za-z_$][\w$]*)")
TYPE_RE = re.compile(r"\btype\s+(?P<name>[A-Za-z_$][\w$]*)\s*=")
EXPRESS_ROUTE_RE = re.compile(
    r"\b(?:app|router)\.(?P<method>get|post|put|patch|delete|options|head|all)"
    r"\s*\(\s*[\"'](?P<path>[^\"']+)[\"']\s*,\s*(?P<handler>[A-Za-z_$][\w$]*)?",
    re.IGNORECASE,
)
NEST_CONTROLLER_RE = re.compile(r"@Controller\s*\(\s*[\"'](?P<prefix>[^\"']*)[\"']\s*\)")
NEST_ROUTE_RE = re.compile(
    r"@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*(?:[\"'](?P<path>[^\"']*)[\"'])?\s*\)\s*\n\s*(?:async\s+)?(?P<handler>[A-Za-z_$][\w$]*)\s*\(",
    re.IGNORECASE,
)
CALL_RE = re.compile(r"\b(?P<name>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(")

EXTERNALS = {
    "stripe": "Stripe", "ioredis": "Redis", "redis": "Redis",
    "@aws-sdk": "AWS", "aws-sdk": "AWS", "openai": "OpenAI",
    "@anthropic-ai": "Anthropic", "@supabase": "Supabase",
    "firebase": "Firebase", "kafkajs": "Kafka", "amqplib": "RabbitMQ",
    "@sendgrid": "SendGrid", "resend": "Resend", "twilio": "Twilio",
    "mongodb": "MongoDB", "mongoose": "MongoDB", "graphql": "GraphQL",
    "@apollo": "GraphQL", "@grpc": "gRPC",
}
FRAMEWORKS = {
    "react": "React", "next": "Next.js", "express": "Express",
    "@nestjs": "NestJS", "vite": "Vite", "vitest": "Vitest",
    "playwright": "Playwright", "@playwright": "Playwright",
    "vue": "Vue", "nuxt": "Nuxt", "svelte": "Svelte", "@sveltejs": "SvelteKit",
    "astro": "Astro", "@remix-run": "Remix", "hono": "Hono", "fastify": "Fastify",
}
DATABASES = {
    "@prisma": "Prisma", "prisma": "Prisma", "drizzle-orm": "Drizzle ORM",
    "typeorm": "TypeORM", "pg": "PostgreSQL", "postgres": "PostgreSQL",
    "mysql": "MySQL", "mysql2": "MySQL", "sqlite": "SQLite", "better-sqlite3": "SQLite",
    "mongodb": "MongoDB", "mongoose": "MongoDB", "@supabase": "Supabase",
}


def _line_number(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def _names_from_bindings(bindings: str | None) -> list[str]:
    if not bindings:
        return []
    # Strip multiline comments and types
    cleaned = re.sub(r"//.*|/\*[\s\S]*?\*/", " ", bindings)
    cleaned = re.sub(r"\b(?:type|as|default)\b", " ", cleaned)
    return [name for name in re.findall(r"[A-Za-z_$][\w$]*", cleaned) if name not in {"from", "import"}]


def _module_root(module: str) -> str:
    if module.startswith("@"):
        parts = module.split("/")
        return "/".join(parts[:2]) if len(parts) > 1 else module
    return module.split("/", 1)[0]


class JavaScriptAnalyzer(LanguageAnalyzer):
    extensions = frozenset({".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"})

    def analyze(self, file, source: str) -> PartialAnalysis:
        result = PartialAnalysis(file=file)
        file.parsed = True
        result.symbols.append(Symbol(
            id=file.path,
            type="module",
            name=PurePosixPath(file.path).name,
            file=file.path,
            line=1,
            end_line=file.lines,
        ))

        # 1. Imports
        for match in IMPORT_RE.finditer(source):
            module = match.group("module")
            line = _line_number(source, match.start())
            result.imports.append(ImportEdge(
                id=f"{file.path}:import:{line}:{module}",
                source=file.path,
                module=module,
                names=_names_from_bindings(match.groupdict().get("bindings")),
                line=line,
            ))
            root = _module_root(module)
            for prefix, name in EXTERNALS.items():
                if root == prefix or root.startswith(prefix + "/"):
                    result.externals.add(name)
            for prefix, name in FRAMEWORKS.items():
                if root == prefix or root.startswith(prefix + "/"):
                    result.frameworks.add(name)
            for prefix, name in DATABASES.items():
                if root == prefix or root.startswith(prefix + "/"):
                    result.databases.add(name)

        # 2. Classes, Interfaces, Types
        symbols_by_line: list[Symbol] = []
        for regex, kind in ((CLASS_RE, "class"), (INTERFACE_RE, "interface"), (TYPE_RE, "type")):
            for match in regex.finditer(source):
                line = _line_number(source, match.start())
                name = match.group("name")
                symbol = Symbol(
                    id=f"{file.path}::{name}",
                    type=kind,
                    name=name,
                    file=file.path,
                    line=line,
                    exported=bool(EXPORT_RE.match(source[source.rfind("\n", 0, match.start()) + 1:match.start()])),
                )
                result.symbols.append(symbol)
                symbols_by_line.append(symbol)

        # 3. Functions & Components
        for match in FUNCTION_RE.finditer(source):
            line = _line_number(source, match.start())
            name = match.group("decl") or match.group("arrow")
            kind = "component" if file.path.endswith((".jsx", ".tsx")) and name[:1].isupper() else "function"
            symbol = Symbol(
                id=f"{file.path}::{name}",
                type=kind,
                name=name,
                file=file.path,
                line=line,
                exported=bool(EXPORT_RE.match(source[source.rfind("\n", 0, match.start()) + 1:match.start()])),
                evidence=["capitalized JSX/TSX function"] if kind == "component" else [],
            )
            result.symbols.append(symbol)
            symbols_by_line.append(symbol)

        symbols_by_line.sort(key=lambda symbol: symbol.line)

        # 4. Express Routes
        for match in EXPRESS_ROUTE_RE.finditer(source):
            line = _line_number(source, match.start())
            handler_name = match.group("handler") or f"anonymous@{line}"
            handler = next((symbol.id for symbol in symbols_by_line if symbol.name == handler_name), f"{file.path}::{handler_name}")
            result.frameworks.add("Express")
            result.routes.append(Route(
                id=f"route:{file.path}:{line}:{match.group('method').upper()}:{match.group('path')}",
                method=match.group("method").upper(),
                path=match.group("path"),
                handler=handler,
                file=file.path,
                line=line,
                framework="Express",
                confidence=0.96,
            ))

        # 5. NestJS Controller Routes
        controller_match = NEST_CONTROLLER_RE.search(source)
        if controller_match:
            result.frameworks.add("NestJS")
            prefix = controller_match.group("prefix") or ""
            prefix = "/" + prefix.strip("/") if prefix.strip("/") else ""
            for rmatch in NEST_ROUTE_RE.finditer(source):
                line = _line_number(source, rmatch.start())
                method = rmatch.group(1).upper()
                subpath = rmatch.group("path") or ""
                subpath = "/" + subpath.strip("/") if subpath.strip("/") else ""
                full_path = f"{prefix}{subpath}" or "/"
                handler_name = rmatch.group("handler") or f"handler@{line}"
                result.routes.append(Route(
                    id=f"route:{file.path}:{line}:{method}:{full_path}",
                    method=method,
                    path=full_path,
                    handler=f"{file.path}::{handler_name}",
                    file=file.path,
                    line=line,
                    framework="NestJS",
                    confidence=0.95,
                ))

        # 6. Next.js App Router & Pages Router Routes
        path = PurePosixPath(file.path)
        if path.name in {"route.ts", "route.js", "route.tsx", "route.jsx"} and "app" in path.parts:
            for method in re.findall(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b", source):
                line_match = re.search(rf"export\s+(?:async\s+)?function\s+{method}\b", source)
                line = _line_number(source, line_match.start()) if line_match else 1
                app_index = path.parts.index("app")
                # Filter out route groups like (auth), (dashboard)
                route_parts = [part for part in path.parts[app_index + 1:-1] if not (part.startswith("(") and part.endswith(")"))]
                route_path = "/" + "/".join(route_parts)
                result.frameworks.add("Next.js")
                result.routes.append(Route(
                    id=f"route:{file.path}:{line}:{method}:{route_path or '/'}",
                    method=method,
                    path=route_path or "/",
                    handler=f"{file.path}::{method}",
                    file=file.path,
                    line=line,
                    framework="Next.js",
                    confidence=0.94,
                ))

        if "pages" in path.parts and "api" in path.parts and path.suffix.lower() in self.extensions:
            api_index = path.parts.index("api")
            route_parts = list(path.parts[api_index + 1:])
            if route_parts:
                route_parts[-1] = PurePosixPath(route_parts[-1]).stem
            route_path = "/api/" + "/".join(part for part in route_parts if part != "index")
            result.frameworks.add("Next.js")
            default_handler = next((symbol.id for symbol in symbols_by_line if symbol.exported), f"{file.path}::default")
            result.routes.append(Route(
                id=f"route:{file.path}:1:ANY:{route_path.rstrip('/') or '/api'}",
                method="ANY",
                path=route_path.rstrip("/") or "/api",
                handler=default_handler,
                file=file.path,
                line=1,
                framework="Next.js",
                confidence=0.9,
            ))

        # 7. Function Calls
        for match in CALL_RE.finditer(source):
            line = _line_number(source, match.start())
            source_symbol = next((symbol for symbol in reversed(symbols_by_line) if symbol.line <= line), None)
            if source_symbol:
                callee = match.group("name")
                if callee not in {"if", "for", "while", "switch", "function", "catch", "return"}:
                    result.calls.append(CallEdge(
                        id=f"{source_symbol.id}:call:{line}:{callee}",
                        source=source_symbol.id,
                        callee=callee,
                        file=file.path,
                        line=line,
                    ))

        # 8. Entrypoint evidence & Framework helpers
        if path.name in {"index.js", "index.ts", "server.js", "server.ts", "main.js", "main.ts"}:
            result.entrypoint_evidence.append(f"uses a conventional {path.name} entrypoint filename")
        if re.search(r"\b(?:app|server)\.listen\s*\(", source):
            result.entrypoint_evidence.append("starts an HTTP listener")
        if "createRoot(" in source or "ReactDOM.render(" in source or "createApp(" in source:
            result.frameworks.add("React" if "createApp(" not in source else "Vue")
            result.entrypoint_evidence.append("mounts a client application")
        if "createClient(" in source and "supabase" in source.lower():
            result.externals.add("Supabase")
            result.databases.add("Supabase")
        return result
