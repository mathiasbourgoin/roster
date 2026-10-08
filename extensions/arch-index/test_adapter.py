"""Integration checks against a compressed producer-created CMT database."""
import json
import lzma
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
ADAPTER = HERE / "skills" / "arch-index-gate" / "adapter.py"
FIXTURE = HERE / "fixtures" / "arch-index-cmt-1.15.db.xz"


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".arch-index").mkdir()

    def run_adapter(self, *args):
        return subprocess.run(["python3", str(ADAPTER), *args], cwd=self.root,
                              text=True, capture_output=True)

    def install_real_db(self):
        path = self.root / ".arch-index" / "index.db"
        with lzma.open(FIXTURE, "rb") as source, path.open("wb") as target:
            while chunk := source.read(1024 * 1024):
                target.write(chunk)
        return path

    def test_missing_index_degrades(self):
        result = self.run_adapter("orient", "fan-in")
        self.assertEqual(result.returncode, 3)
        self.assertIn("index-missing", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_real_cmt_and_fail_closed_gate(self):
        self.install_real_db()
        result = self.run_adapter("orient", "fan-in")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CMT schema", result.stdout.splitlines()[0])
        self.assertTrue(json.loads(result.stdout.splitlines()[1]))
        result = self.run_adapter("audit")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Fan-in hotspots", result.stdout)
        block = self.root / "checks.jsonl"
        block.write_text('{"type":"reachability","check":{"query":"SELECT 1","expect":"none"}}\n')
        result = self.run_adapter("gate", str(block))
        self.assertEqual(result.returncode, 3)
        self.assertIn("reachability-sql-unsupported", result.stderr)
        self.assertNotIn("PASS", result.stdout)

    def test_provenance_loss_degrades(self):
        path = self.install_real_db()
        with sqlite3.connect(path) as db:
            db.execute("UPDATE producer_runs SET soundness_class='heuristic'")
        result = self.run_adapter("orient", "fan-in")
        self.assertEqual(result.returncode, 3)
        self.assertIn("partial-or-unsupported-producer", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_partial_coverage_degrades(self):
        path = self.install_real_db()
        with sqlite3.connect(path) as db:
            db.execute("INSERT INTO analysis_coverage(language,analysis,status) VALUES ('ocaml','callgraph','partial')")
        result = self.run_adapter("orient", "fan-in")
        self.assertEqual(result.returncode, 3)
        self.assertIn("partial-producer-coverage", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_unknown_schema_version_degrades(self):
        path = self.install_real_db()
        with sqlite3.connect(path) as db:
            db.execute("UPDATE comment_db_meta SET value='2.0' WHERE key='schema_version'")
        result = self.run_adapter("orient", "fan-in")
        self.assertEqual(result.returncode, 3)
        self.assertIn("unsupported-schema-version", result.stderr)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
