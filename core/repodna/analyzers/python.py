from __future__ import annotations

import ast
from collections.abc import Iterator

from repodna.model import CallEdge, ImportEdge, PartialAnalysis, Route, Symbol

from .base import LanguageAnalyzer


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "websocket"}
EXTERNALS = {
    "stripe": "Stripe", "redis": "Redis", "boto3": "AWS", "openai": "OpenAI",
    "anthropic": "Anthropic", "supabase": "Supabase", "firebase_admin": "Firebase",
    "kafka": "Kafka", "celery": "Celery", "sendgrid": "SendGrid",
    "resend": "Resend", "twilio": "Twilio", "pymongo": "MongoDB",
}


def dotted_name(node: ast.AST | None) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = dotted_name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    if isinstance(node, ast.Call):
        return dotted_name(node.func)
    return ""


def literal_string(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _node_span(node: ast.AST) -> tuple[int, int]:
    return getattr(node, "lineno", 1), getattr(node, "end_lineno", getattr(node, "lineno", 1))


def _symbol_id(path: str, parents: list[str], name: str) -> str:
    return "::".join([path, *parents, name])


class _PythonVisitor(ast.NodeVisitor):
    def __init__(self, result: PartialAnalysis) -> None:
        self.result = result
        self.parents: list[str] = []
        self.symbol_stack: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.result.imports.append(ImportEdge(
                id=f"{self.result.file.path}:import:{node.lineno}:{alias.name}",
                source=self.result.file.path,
                module=alias.name,
                names=[alias.asname or alias.name],
                line=node.lineno,
            ))
            self._record_external(alias.name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = "." * node.level + (node.module or "")
        names = [alias.name for alias in node.names]
        self.result.imports.append(ImportEdge(
            id=f"{self.result.file.path}:import:{node.lineno}:{module}",
            source=self.result.file.path,
            module=module,
            names=names,
            line=node.lineno,
        ))
        self._record_external(node.module or "")

    def _record_external(self, module: str) -> None:
        root = module.split(".", 1)[0]
        if root in EXTERNALS:
            self.result.externals.add(EXTERNALS[root])
        if root in {"fastapi"}:
            self.result.frameworks.add("FastAPI")
        elif root in {"flask"}:
            self.result.frameworks.add("Flask")
        elif root in {"django"}:
            self.result.frameworks.add("Django")
        elif root in {"sqlalchemy"}:
            self.result.frameworks.add("SQLAlchemy")
            self.result.databases.add("SQL database")

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        bases = {dotted_name(base) for base in node.bases}
        kind = "class"
        evidence: list[str] = []
        if any(base.endswith(("Base", "DeclarativeBase", "models.Model")) for base in bases):
            kind = "database_model"
            evidence.append("inherits from an ORM model base")
            if any("models.Model" in base for base in bases):
                self.result.frameworks.add("Django")
                self.result.databases.add("Django ORM")
            else:
                self.result.frameworks.add("SQLAlchemy")
                self.result.databases.add("SQL database")
        start, end = _node_span(node)
        symbol_id = _symbol_id(self.result.file.path, self.parents, node.name)
        self.result.symbols.append(Symbol(
            id=symbol_id,
            type=kind,
            name=node.name,
            file=self.result.file.path,
            line=start,
            end_line=end,
            parent=self.symbol_stack[-1] if self.symbol_stack else None,
            evidence=evidence,
        ))
        self.parents.append(node.name)
        self.symbol_stack.append(symbol_id)
        self.generic_visit(node)
        self.symbol_stack.pop()
        self.parents.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        start, end = _node_span(node)
        kind = "method" if self.parents else "function"
        symbol_id = _symbol_id(self.result.file.path, self.parents, node.name)
        self.result.symbols.append(Symbol(
            id=symbol_id,
            type=kind,
            name=node.name,
            file=self.result.file.path,
            line=start,
            end_line=end,
            parent=self.symbol_stack[-1] if self.symbol_stack else None,
        ))
        for decorator in node.decorator_list:
            self._route_from_decorator(decorator, node, symbol_id)
        self.parents.append(node.name)
        self.symbol_stack.append(symbol_id)
        self.generic_visit(node)
        self.symbol_stack.pop()
        self.parents.pop()

    def _route_from_decorator(
        self,
        decorator: ast.AST,
        function: ast.FunctionDef | ast.AsyncFunctionDef,
        handler_id: str,
    ) -> None:
        if not isinstance(decorator, ast.Call):
            return
        decorator_name = dotted_name(decorator.func)
        method = decorator_name.rsplit(".", 1)[-1].lower()
        path = literal_string(decorator.args[0]) if decorator.args else None
        framework = "FastAPI"
        if method == "route":
            framework = "Flask"
            method = "GET"
            for keyword in decorator.keywords:
                if keyword.arg == "methods" and isinstance(keyword.value, (ast.List, ast.Tuple)):
                    methods = [literal_string(item) for item in keyword.value.elts]
                    method = ",".join(item for item in methods if item) or "GET"
        elif method not in HTTP_METHODS:
            return
        if path is None:
            return
        self.result.frameworks.add(framework)
        self.result.routes.append(Route(
            id=f"route:{self.result.file.path}:{function.lineno}:{method.upper()}:{path}",
            method=method.upper(),
            path=path,
            handler=handler_id,
            file=self.result.file.path,
            line=function.lineno,
            framework=framework,
            confidence=0.98,
        ))

    def visit_Call(self, node: ast.Call) -> None:
        name = dotted_name(node.func)
        if self.symbol_stack and name:
            self.result.calls.append(CallEdge(
                id=f"{self.symbol_stack[-1]}:call:{node.lineno}:{name}",
                source=self.symbol_stack[-1],
                callee=name,
                file=self.result.file.path,
                line=node.lineno,
            ))
        if name.endswith("FastAPI"):
            self.result.frameworks.add("FastAPI")
            self.result.entrypoint_evidence.append("creates a FastAPI application")
        elif name.endswith("Flask"):
            self.result.frameworks.add("Flask")
            self.result.entrypoint_evidence.append("creates a Flask application")
        elif name.endswith(("create_engine", "sessionmaker")):
            self.result.frameworks.add("SQLAlchemy")
            self.result.databases.add("SQL database")
        elif name.rsplit(".", 1)[-1] in {"path", "re_path"} and node.args:
            route_path = literal_string(node.args[0])
            handler_name = dotted_name(node.args[1]) if len(node.args) > 1 else "unknown"
            if route_path is not None:
                normalized_path = "/" + route_path.lstrip("/")
                self.result.frameworks.add("Django")
                self.result.routes.append(Route(
                    id=f"route:{self.result.file.path}:{node.lineno}:ANY:{normalized_path}",
                    method="ANY",
                    path=normalized_path,
                    handler=f"{self.result.file.path}::{handler_name}",
                    file=self.result.file.path,
                    line=node.lineno,
                    framework="Django",
                    confidence=0.88,
                ))
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        try:
            if ast.unparse(node.test).replace(" ", "") in {"__name__=='__main__'", '__name__=="__main__"'}:
                self.result.entrypoint_evidence.append("contains a __main__ execution guard")
        except Exception:
            pass
        self.generic_visit(node)


class PythonAnalyzer(LanguageAnalyzer):
    extensions = frozenset({".py", ".pyi"})

    def analyze(self, file, source: str) -> PartialAnalysis:
        result = PartialAnalysis(file=file)
        try:
            tree = ast.parse(source, filename=file.path, type_comments=True)
        except (SyntaxError, ValueError) as exc:
            file.error = f"parse_error:{exc.__class__.__name__}:{getattr(exc, 'lineno', 0) or 0}"
            return result
        file.parsed = True
        result.symbols.append(Symbol(
            id=file.path,
            type="module",
            name=file.path.rsplit("/", 1)[-1],
            file=file.path,
            line=1,
            end_line=file.lines,
        ))
        _PythonVisitor(result).visit(tree)
        lowered = source.lower()
        if "postgresql://" in lowered or "postgres://" in lowered:
            result.databases.add("PostgreSQL")
        if "mongodb://" in lowered or "mongodb+srv://" in lowered:
            result.databases.add("MongoDB")
        return result
