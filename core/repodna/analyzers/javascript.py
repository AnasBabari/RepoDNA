from __future__ import annotations

import re
from pathlib import PurePosixPath

from repodna.model import CallEdge, ExpressMount, ImportEdge, PartialAnalysis, Route, Symbol

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
    r"\b(?P<receiver>[A-Za-z_$][\w$]*)\.(?P<method>get|post|put|patch|delete|options|head|all)"
    r"\s*\(\s*[\"'](?P<path>[^\"']+)[\"']\s*,\s*(?P<handler>[A-Za-z_$][\w$]*)?",
    re.IGNORECASE,
)
EXPRESS_RECEIVER_RE = re.compile(
    r"\b(?:const|let|var)\s+(?P<receiver>[A-Za-z_$][\w$]*)\s*=\s*"
    r"(?:express\s*\(|(?:express\.)?Router\s*\()"
)
EXPRESS_MOUNT_RE = re.compile(r"\b(?P<receiver>[A-Za-z_$][\w$]*)\.use\s*\(")
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


def _infer_require_bindings(source: str, match_start: int) -> list[str]:
    line_start = source.rfind("\n", 0, match_start) + 1
    prefix = source[line_start:match_start]
    direct = re.search(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$", prefix)
    if direct:
        return [direct.group(1)]
    destructured = re.search(r"\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*$", prefix)
    if not destructured:
        return []
    names: list[str] = []
    for part in destructured.group(1).split(","):
        name = re.split(r"\s*:\s*", part.strip())[-1].strip()
        if re.fullmatch(r"[A-Za-z_$][\w$]*", name):
            names.append(name)
    return names


def _express_receivers(source: str) -> set[str]:
    return {"app", "router", *(match.group("receiver") for match in EXPRESS_RECEIVER_RE.finditer(source))}


def _read_call_arguments(source: str, open_paren: int) -> list[str] | None:
    args: list[str] = []
    start = open_paren + 1
    paren_depth = 1
    brace_depth = 0
    bracket_depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    index = open_paren + 1
    while index < len(source):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            index += 1
            continue
        if char == "/" and next_char == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and next_char == "*":
            block_comment = True
            index += 2
            continue
        if char in {"'", '"', "`"}:
            quote = char
        elif char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
            if paren_depth == 0:
                final_arg = source[start:index].strip()
                if final_arg or args:
                    args.append(final_arg)
                return args
        elif char == "{":
            brace_depth += 1
        elif char == "}":
            brace_depth -= 1
        elif char == "[":
            bracket_depth += 1
        elif char == "]":
            bracket_depth -= 1
        elif char == "," and paren_depth == 1 and brace_depth == 0 and bracket_depth == 0:
            args.append(source[start:index].strip())
            start = index + 1
        index += 1
    return None


def _static_string_value(expression: str) -> str | None:
    value = expression.strip()
    if len(value) < 2 or value[0] not in {"'", '"', "`"} or value[-1] != value[0]:
        return None
    if value[0] == "`" and "${" in value:
        return None
    return re.sub(r"\\([\\'\"`])", r"\1", value[1:-1])


def _direct_require_module(expression: str) -> str | None:
    match = re.fullmatch(r"require\s*\(\s*[\"']([^\"']+)[\"']\s*\)", expression.strip())
    return match.group(1) if match else None


def _extract_express_mounts(source: str, file, receivers: set[str]) -> list[ExpressMount]:
    mounts: list[ExpressMount] = []
    for match in EXPRESS_MOUNT_RE.finditer(source):
        receiver = match.group("receiver")
        if receiver not in receivers:
            continue
        open_paren = source.find("(", match.start())
        args = _read_call_arguments(source, open_paren)
        if not args:
            continue
        static_prefix = _static_string_value(args[0])
        has_explicit_prefix = static_prefix is not None
        target_expression = args[-1].strip()
        target_identifier = target_expression if re.fullmatch(r"[A-Za-z_$][\w$]*", target_expression) else None
        target_module = _direct_require_module(target_expression)
        prefix_expression = args[0].strip() if has_explicit_prefix or len(args) > 1 else None
        prefix = static_prefix if has_explicit_prefix else "/" if len(args) == 1 else None
        line = _line_number(source, match.start())
        mounts.append(ExpressMount(
            id=f"express-mount:{file.path}:{line}:{len(mounts)}",
            file=file.path,
            line=line,
            receiver=receiver,
            prefix=prefix,
            prefix_expression=prefix_expression,
            target_identifier=target_identifier,
            target_module=target_module,
            target_expression=target_expression,
            dynamic=prefix is None or (target_identifier is None and target_module is None),
        ))
    return mounts


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
            bindings = match.groupdict().get("bindings")
            result.imports.append(ImportEdge(
                id=f"{file.path}:import:{line}:{module}",
                source=file.path,
                module=module,
                names=_names_from_bindings(bindings) if bindings else _infer_require_bindings(source, match.start()),
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

        # 4. Express Routes and router mounts
        express_receivers = _express_receivers(source)
        for match in EXPRESS_ROUTE_RE.finditer(source):
            if match.group("receiver") not in express_receivers:
                continue
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
        result.express_mounts.extend(_extract_express_mounts(source, file, express_receivers))

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
