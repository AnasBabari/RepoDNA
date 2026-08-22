from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from repodna.engine import analyze_repository


class ExpressMountResolutionTests(unittest.TestCase):
    def test_composes_static_router_mount_prefixes(self) -> None:
        result = analyze_repository("tests/fixtures/express-basic")
        routes = sorted(f"{route.method} {route.path}" for route in result.routes)
        self.assertEqual(routes, ["GET /api/users", "POST /api/users"])
        self.assertFalse(any("ROUTE_MOUNT_UNRESOLVED" in item.code for item in result.diagnostics))

    def test_reports_directory_driven_dynamic_mount_expression(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "routes").mkdir()
            (root / "app.js").write_text(
                """
const express = require('express');
const path = require('path');
const app = express();
for (const file of routeFiles) {
  const router = require(path.join(routesDirectory, file));
  app.use(`/api/${file}`, router);
}
""",
                encoding="utf-8",
            )
            (root / "routes" / "users.js").write_text(
                """
const express = require('express');
const router = express.Router();
function listUsers(req, res) { res.json([]); }
router.get('/', listUsers);
module.exports = router;
""",
                encoding="utf-8",
            )

            result = analyze_repository(str(root))

        diagnostic = next(
            item for item in result.diagnostics if item.code == "DYNAMIC_ROUTE_MOUNT_UNRESOLVED"
        )
        self.assertEqual(diagnostic.file, "app.js")
        self.assertIn("`/api/${file}`", diagnostic.message)
        self.assertIn("routes beneath this mount may be missing or have incomplete paths", diagnostic.message)
        path_diagnostic = next(
            item for item in result.diagnostics if item.code == "EXPRESS_ROUTE_PATH_INCOMPLETE"
        )
        self.assertEqual(path_diagnostic.file, "routes/users.js")
        self.assertIn("Full mounted path unresolved for GET /;", path_diagnostic.message)

    def test_keeps_static_prefix_and_marks_only_dynamic_directory_routes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "src" / "routes").mkdir(parents=True)
            (root / "src" / "app.js").write_text(
                """
const express = require('express');
const fs = require('fs');
const path = require('path');
const healthRouter = require('./routes/health');
const app = express();
app.use('/health', healthRouter);
fs.readdirSync(path.join(__dirname, 'routes')).forEach((file) => {
  if (file === 'health.js') return;
  const router = require(`./routes/${file}`);
  app.use(`/api/${file.replace('.js', '')}`, router);
});
""",
                encoding="utf-8",
            )
            for name, route_path in (("health", "/status"), ("users", "/:id"), ("projects", "/:id")):
                (root / "src" / "routes" / f"{name}.js").write_text(
                    f"""
const express = require('express');
const router = express.Router();
router.get('{route_path}', handler);
module.exports = router;
""",
                    encoding="utf-8",
                )

            result = analyze_repository(str(root))

        routes = sorted(f"{route.method} {route.path}" for route in result.routes)
        self.assertEqual(routes, ["GET /:id", "GET /:id", "GET /health/status"])
        incomplete_files = {
            item.file for item in result.diagnostics if item.code == "EXPRESS_ROUTE_PATH_INCOMPLETE"
        }
        self.assertEqual(incomplete_files, {"src/routes/projects.js", "src/routes/users.js"})


if __name__ == "__main__":
    unittest.main()
