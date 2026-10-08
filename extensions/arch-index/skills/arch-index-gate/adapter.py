#!/usr/bin/env python3
"""Read-only adapter for the arch-index main-schema OCaml CMT producer.

This adapter is intentionally advisory. The SQL row-count gate cannot turn an
empty result into a reachability proof, even on a sound_with_top call graph.
"""
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone


class Degraded(Exception):
    pass


REQUIRED = {
    "comment_db_meta": {"key", "value"},
    "producer_runs": {"id", "producer", "soundness_class"},
    "modules": {"id", "path"},
    "functions": {"id", "module_id", "name", "exposed", "comment_quality_score", "producer_run_id"},
    "calls": {"id", "caller_id", "callee_id", "callee_name", "kind", "edge_form", "producer_run_id"},
    "analysis_coverage": {"language", "analysis", "status"},
}


def open_index():
    path = os.path.abspath(os.environ.get("ARCH_INDEX_DB_PATH", ".arch-index/index.db"))
    if not os.path.isfile(path):
        raise Degraded("index-missing: .arch-index/index.db (run the CMT producer first)")
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        for table, columns in REQUIRED.items():
            present = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            if not columns <= present:
                raise Degraded(f"schema-mismatch: {table} lacks {sorted(columns - present)}")
        meta = dict(db.execute("SELECT key,value FROM comment_db_meta"))
        version = meta.get("schema_version", "")
        # 1.15 is the earliest verified main schema; newer schemas need an
        # explicit adapter review even if their current columns happen to fit.
        if version not in {f"1.{n}" for n in range(15, 19)}:
            raise Degraded(f"unsupported-schema-version: {version or 'missing'}")
        if meta.get("callgraph_contract") != "v1":
            raise Degraded("callgraph-contract-missing")
        coverage = db.execute("SELECT status FROM analysis_coverage WHERE language='ocaml' AND analysis='callgraph'").fetchall()
        if coverage and (len(coverage) != 1 or coverage[0][0] != "covered"):
            raise Degraded("partial-producer-coverage: OCaml callgraph not covered")
        runs = db.execute("SELECT id,producer,soundness_class FROM producer_runs").fetchall()
        if not runs or any(r["producer"] != "arch_index_cmt" or r["soundness_class"] != "sound_with_top" for r in runs):
            raise Degraded("partial-or-unsupported-producer: CMT sound_with_top required")
        run_ids = {r["id"] for r in runs}
        for table in ("functions", "calls"):
            ids = {r[0] for r in db.execute(f"SELECT DISTINCT producer_run_id FROM {table}")}
            if not ids or not ids <= run_ids:
                raise Degraded(f"partial-provenance: {table}")
        invalid = db.execute("SELECT 1 FROM calls WHERE kind NOT IN ('MUST','MAY_ENUMERATED','MAY_TOP') OR kind IS NULL LIMIT 1").fetchone()
        if invalid:
            raise Degraded("partial-edge-contract: invalid call kind")
        # Bound recursive path exploration even for a densely branching graph.
        budget = [0]
        def progress():
            budget[0] += 1
            return budget[0] > 2000
        db.set_progress_handler(progress, 1000)
        return db, path, version
    except sqlite3.Error as exc:
        raise Degraded(f"invalid-index: {exc}") from exc


def header(path, version):
    try:
        head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        head = "unknown"
    mtime = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"<!-- index-freshness: {mtime} vs HEAD {head}; CMT schema {version}; advisory -->")


def rows(db, sql, params=()):
    return [dict(row) for row in db.execute(sql, params).fetchall()]


def orient(db, mode, args):
    if mode == "fan-in" and not args:
        result = rows(db, """SELECT target.name AS callee, COUNT(DISTINCT c.caller_id) AS fan_in
          FROM calls c JOIN functions target ON target.id=c.callee_id
          WHERE COALESCE(c.edge_form,'') <> 'value_alias'
          GROUP BY target.id ORDER BY fan_in DESC, target.name LIMIT 10""")
    elif mode in {"callers", "callees", "definition"} and len(args) == 1:
        name = args[0]
        if mode == "definition":
            result = rows(db, """SELECT f.id, f.name, m.path, f.exposed, f.comment_quality_score
              FROM functions f JOIN modules m ON m.id=f.module_id WHERE f.name=? ORDER BY m.path LIMIT 10""", (name,))
        elif mode == "callees":
            result = rows(db, """SELECT DISTINCT target.name AS callee, target.id, m.path, c.kind
              FROM functions source JOIN calls c ON c.caller_id=source.id
              JOIN functions target ON target.id=c.callee_id JOIN modules m ON m.id=target.module_id
              WHERE source.name=? AND COALESCE(c.edge_form,'') <> 'value_alias'
              ORDER BY target.name,m.path LIMIT 10""", (name,))
        else:
            result = rows(db, """SELECT DISTINCT source.name AS caller, source.id, m.path, c.kind
              FROM functions target JOIN calls c ON c.callee_id=target.id
              JOIN functions source ON source.id=c.caller_id JOIN modules m ON m.id=source.module_id
              WHERE target.name=? AND COALESCE(c.edge_form,'') <> 'value_alias'
              ORDER BY source.name,m.path LIMIT 10""", (name,))
    elif mode == "path" and len(args) == 2:
        # Name collisions and TOP edges make a negative path answer ambiguous.
        # Return positive observed paths only; empty means no observed path.
        result = rows(db, """WITH RECURSIVE walk(id,path,visited,depth) AS (
          SELECT id,name,printf(',%d,',id),0 FROM functions WHERE name=?
          UNION ALL
          SELECT target.id,walk.path||' -> '||target.name,walk.visited||target.id||',',walk.depth+1
          FROM walk JOIN calls c ON c.caller_id=walk.id
          JOIN functions target ON target.id=c.callee_id
          WHERE walk.depth<20 AND instr(walk.visited,printf(',%d,',target.id))=0)
          SELECT path,depth AS level FROM walk JOIN functions f ON f.id=walk.id
          WHERE f.name=? ORDER BY depth LIMIT 1""", tuple(args))
    else:
        raise Degraded("usage: orient.sh <callers|callees|fan-in|definition|path> [symbols]")
    print(json.dumps(result, ensure_ascii=False))


def audit(db):
    print("\n## arch-index CMT audit section")
    sections = [
        ("Fan-in hotspots", """SELECT target.name AS callee, COUNT(DISTINCT c.caller_id) AS fan_in
          FROM calls c JOIN functions target ON target.id=c.callee_id
          WHERE COALESCE(c.edge_form,'') <> 'value_alias'
          GROUP BY target.id ORDER BY fan_in DESC LIMIT 10"""),
        ("Exposed and underdocumented", """SELECT f.name,m.path,f.comment_quality_score
          FROM functions f JOIN modules m ON m.id=f.module_id
          WHERE f.exposed=1 AND f.comment_quality_score IS NOT NULL AND f.comment_quality_score<40
          ORDER BY f.comment_quality_score LIMIT 10"""),
        ("Exit/panic call sites", """SELECT source.name AS caller,c.callee_name,c.kind
          FROM calls c JOIN functions source ON source.id=c.caller_id
          WHERE c.callee_name IN ('exit','panic','abort','Stdlib.exit')
          AND COALESCE(c.edge_form,'') <> 'value_alias' ORDER BY source.name LIMIT 10"""),
    ]
    for title, sql in sections:
        found = rows(db, sql)
        if found:
            print(f"\n### {title}\n\n```json\n{json.dumps(found, ensure_ascii=False, indent=2)}\n```")


def main():
    try:
        if len(sys.argv) < 2:
            raise Degraded("usage: adapter.py <gate|orient|audit>")
        command = sys.argv[1]
        if command == "gate":
            if len(sys.argv) != 3 or not os.path.isfile(sys.argv[2]):
                print("MALFORMED: gate requires an existing JSONL block", file=sys.stderr)
                return 2
            with open(sys.argv[2], encoding="utf-8") as block:
                declarations = [json.loads(line) for line in block if line.strip()]
            for declaration in declarations:
                if not isinstance(declaration, dict) or declaration.get("type") != "reachability" or not isinstance(declaration.get("check"), dict):
                    print("MALFORMED: unsupported declaration", file=sys.stderr)
                    return 2
                check = declaration["check"]
                valid_limit = check.get("expect") == "none" or (type(check.get("max")) is int and check["max"] >= 0)
                if not isinstance(check.get("query"), str) or not check["query"].strip() or not valid_limit:
                    print("MALFORMED: reachability needs query and expect:none or nonnegative max", file=sys.stderr)
                    return 2
            if not declarations:
                print("PASS: 0 invariants declared")
                return 0
            open_index()  # State the concrete schema/provenance failure first.
            raise Degraded("reachability-sql-unsupported: row counts cannot prove negative reachability; use a typed sound graph query")
        db, path, version = open_index()
        if command == "inspect":
            print(f"CMT schema {version}; arch_index_cmt sound_with_top")
            return 0
        if command not in {"orient", "audit"}:
            raise Degraded(f"unsupported-command: {command}")
        header(path, version)
        if command == "orient":
            orient(db, sys.argv[2] if len(sys.argv) > 2 else "", sys.argv[3:])
        else:
            audit(db)
        return 0
    except (Degraded, sqlite3.Error, OSError) as exc:
        print(f"DEGRADED: {exc}", file=sys.stderr)
        return 3
    except json.JSONDecodeError as exc:
        print(f"MALFORMED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
