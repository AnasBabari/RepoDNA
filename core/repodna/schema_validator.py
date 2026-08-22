from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def validate_analysis_result(data: dict[str, Any]) -> tuple[bool, list[str]]:
    """
    Validates that a serialized dictionary adheres to the canonical RepoDNA schema contract.
    Returns (valid: bool, errors: list[str]).
    """
    errors: list[str] = []

    if not isinstance(data, dict):
        return False, ["Analysis payload must be a dictionary."]

    # 1. Required top-level fields
    required_top = [
        "schemaVersion",
        "repository",
        "technologies",
        "files",
        "symbols",
        "imports",
        "calls",
        "routes",
        "databases",
        "entrypoints",
        "flows",
        "architecture",
        "metrics",
        "diagnostics",
        "metadata",
    ]
    for key in required_top:
        if key not in data:
            errors.append(f"Missing required top-level field: '{key}'.")

    # 2. Schema version
    if not isinstance(data.get("schemaVersion"), str) or not data["schemaVersion"].strip():
        errors.append("Invalid or missing 'schemaVersion'.")

    # 3. Repository
    repo = data.get("repository")
    if not isinstance(repo, dict):
        errors.append("'repository' must be a dictionary.")
    else:
        for req in ["name", "source", "fileCount", "sourceFileCount", "parsedFileCount", "fingerprint"]:
            if req not in repo:
                errors.append(f"Missing repository field: '{req}'.")

    # 4. Core collections
    for collection in ["technologies", "files", "symbols", "imports", "calls", "routes", "databases", "entrypoints", "flows", "diagnostics"]:
        val = data.get(collection)
        if not isinstance(val, list):
            errors.append(f"'{collection}' must be a list.")

    # 5. Architecture
    arch = data.get("architecture")
    if not isinstance(arch, dict):
        errors.append("'architecture' must be a dictionary.")
    else:
        if not isinstance(arch.get("components"), list):
            errors.append("architecture.components must be a list.")
        if not isinstance(arch.get("connections"), list):
            errors.append("architecture.connections must be a list.")

    # 6. Metrics
    metrics = data.get("metrics")
    if not isinstance(metrics, dict):
        errors.append("'metrics' must be a dictionary.")
    else:
        for m in ["complexityScore", "symbols", "routes", "components", "parseSuccessRate"]:
            if m not in metrics:
                errors.append(f"Missing metric field: '{m}'.")

    # 7. Metadata
    meta = data.get("metadata")
    if not isinstance(meta, dict):
        errors.append("'metadata' must be a dictionary.")
    else:
        if "analysisMode" not in meta:
            errors.append("Missing metadata.analysisMode.")
        if "executedRepositoryCode" not in meta:
            errors.append("Missing metadata.executedRepositoryCode.")

    return len(errors) == 0, errors


def load_canonical_schema() -> dict[str, Any]:
    """Loads the canonical JSON schema file from the schema/ directory."""
    schema_path = Path(__file__).resolve().parent.parent.parent / "schema" / "repodna.schema.json"
    if schema_path.exists():
        return json.loads(schema_path.read_text(encoding="utf-8"))
    return {}
