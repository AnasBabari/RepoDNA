from __future__ import annotations

import unittest

from repodna.analyzers.javascript import JavaScriptAnalyzer
from repodna.analyzers.python import PythonAnalyzer
from repodna.model import FileRecord


def record(path: str, source: str) -> FileRecord:
    return FileRecord(f"file:{path}", path, "test", len(source.splitlines()), len(source), "test")


class PythonAnalyzerTests(unittest.TestCase):
    def test_extracts_symbols_routes_imports_calls_and_models(self) -> None:
        source = '''from fastapi import APIRouter
from sqlalchemy.orm import DeclarativeBase
router = APIRouter()
class Base(DeclarativeBase): pass
class User(Base): pass
@router.post("/users")
def create_user():
    return save_user()
'''
        result = PythonAnalyzer().analyze(record("app/users.py", source), source)
        self.assertTrue(result.file.parsed)
        self.assertEqual([route.method for route in result.routes], ["POST"])
        self.assertEqual(result.routes[0].path, "/users")
        self.assertIn("FastAPI", result.frameworks)
        self.assertIn("SQLAlchemy", result.frameworks)
        self.assertIn("database_model", {symbol.type for symbol in result.symbols})
        self.assertIn("save_user", {call.callee for call in result.calls})

    def test_extracts_fastapi_router_prefix(self) -> None:
        source = '''from fastapi import APIRouter
router = APIRouter(prefix="/api/v1")
@router.get("/items")
def list_items():
    pass
@router.post("/items/{item_id}")
def update_item(item_id: int):
    pass
'''
        result = PythonAnalyzer().analyze(record("app/routers/items.py", source), source)
        self.assertEqual([(r.method, r.path) for r in result.routes], [("GET", "/api/v1/items"), ("POST", "/api/v1/items/{item_id}")])

    def test_extracts_sqlmodel_and_beanie_models(self) -> None:
        source = '''from sqlmodel import SQLModel
from beanie import Document
class Item(SQLModel): pass
class UserDoc(Document): pass
'''
        result = PythonAnalyzer().analyze(record("app/models.py", source), source)
        self.assertIn("SQLModel", result.frameworks)
        self.assertIn("Beanie", result.frameworks)
        models = [s.name for s in result.symbols if s.type == "database_model"]
        self.assertIn("Item", models)
        self.assertIn("UserDoc", models)

    def test_degrades_gracefully_on_invalid_python(self) -> None:
        result = PythonAnalyzer().analyze(record("broken.py", "def broken(:"), "def broken(:")
        self.assertFalse(result.file.parsed)
        self.assertTrue(result.file.error.startswith("parse_error"))

    def test_extracts_basic_django_url_patterns(self) -> None:
        source = '''from django.urls import path
from .views import home
urlpatterns = [path("home/", home)]
'''
        result = PythonAnalyzer().analyze(record("app/urls.py", source), source)
        self.assertEqual([(route.method, route.path, route.framework) for route in result.routes], [("ANY", "/home/", "Django")])


class JavaScriptAnalyzerTests(unittest.TestCase):
    def test_extracts_react_component_express_route_and_external(self) -> None:
        source = '''import React from "react";
import express from "express";
import Stripe from "stripe";
export function Checkout() { return charge(); }
app.post("/checkout", Checkout);
'''
        result = JavaScriptAnalyzer().analyze(record("src/Checkout.tsx", source), source)
        self.assertIn("React", result.frameworks)
        self.assertIn("Express", result.frameworks)
        self.assertIn("Stripe", result.externals)
        self.assertEqual(result.routes[0].path, "/checkout")
        self.assertIn("component", {symbol.type for symbol in result.symbols})

    def test_extracts_next_pages_api_route(self) -> None:
        source = "export default function handler() { return Response.json({ ok: true }); }"
        result = JavaScriptAnalyzer().analyze(record("pages/api/health.ts", source), source)
        self.assertEqual([(route.method, route.path, route.framework) for route in result.routes], [("ANY", "/api/health", "Next.js")])

    def test_extracts_nextjs_app_router_route_groups(self) -> None:
        source = "export async function POST(req) { return Response.json({ status: 'ok' }); }"
        result = JavaScriptAnalyzer().analyze(record("app/(auth)/login/route.ts", source), source)
        self.assertEqual([(r.method, r.path, r.framework) for r in result.routes], [("POST", "/login", "Next.js")])

    def test_extracts_nestjs_controller_routes(self) -> None:
        source = '''@Controller("users")
export class UserController {
    @Get()
    findAll() {}

    @Post("create")
    create() {}
}
'''
        result = JavaScriptAnalyzer().analyze(record("src/users/users.controller.ts", source), source)
        self.assertIn("NestJS", result.frameworks)
        self.assertEqual([(r.method, r.path) for r in result.routes], [("GET", "/users"), ("POST", "/users/create")])


if __name__ == "__main__":
    unittest.main()
