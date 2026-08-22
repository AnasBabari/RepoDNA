from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import jsonschema


def load_canonical_schema() -> dict[str, Any]:
    """Loads the canonical JSON schema file from the schema/ directory."""
    schema_path = Path(__file__).resolve().parent.parent.parent / "schema" / "repodna.schema.json"
    if not schema_path.exists():
        raise FileNotFoundError(f"Canonical schema not found at {schema_path}")
    return json.loads(schema_path.read_text(encoding="utf-8"))


_CANONICAL_SCHEMA = load_canonical_schema()
_VALIDATOR = jsonschema.Draft7Validator(_CANONICAL_SCHEMA)


def validate_analysis_result(data: dict[str, Any]) -> tuple[bool, list[str]]:
    """
    Validates that a serialized dictionary adheres to the canonical RepoDNA Draft-07 schema contract
    using the official jsonschema Draft7Validator.
    Returns (valid: bool, errors: list[str]).
    """
    if not isinstance(data, dict):
        return False, ["Analysis payload must be a dictionary."]

    validation_errors = sorted(_VALIDATOR.iter_errors(data), key=lambda e: e.path)
    if not validation_errors:
        return True, []

    formatted_errors = []
    for err in validation_errors:
        path = ".".join(str(p) for p in err.path)
        formatted_errors.append(f"{path + ': ' if path else ''}{err.message}")

    return False, formatted_errors
