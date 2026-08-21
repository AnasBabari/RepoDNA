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


if __name__ == "__main__":
    unittest.main()
