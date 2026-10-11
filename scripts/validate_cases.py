#!/usr/bin/env python
"""Validate every case file against the schema and check rubric regexes compile.
Run from the anna conda env: python scripts/validate_cases.py"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.cases import load_case_file  # noqa: E402

root = Path(__file__).resolve().parents[1] / "cases"
errors = 0
ids = set()
for path in sorted(root.glob("*/*.json")):
    try:
        case = load_case_file(path)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL {path}: {e}")
        errors += 1
        continue
    problems = []
    if case.id in ids:
        problems.append("duplicate id")
    ids.add(case.id)
    if case.track != path.parent.name:
        problems.append(f"track '{case.track}' does not match folder '{path.parent.name}'")
    cats = {r.category for r in case.rubric}
    missing = {"diagnosis", "workup", "reasoning", "management"} - cats
    if missing:
        problems.append(f"rubric missing categories {sorted(missing)}")
    stage_ids = {s.id for s in case.stages}
    for r in case.rubric:
        if r.by_stage and r.by_stage not in stage_ids:
            problems.append(f"rubric {r.id}: by_stage '{r.by_stage}' not a stage id")
        for p in r.match:
            try:
                re.compile(p)
            except re.error as e:
                problems.append(f"rubric {r.id}: bad regex {p!r}: {e}")
    words = len((case.presentation + " ".join(s.text for s in case.stages)).split())
    if words > 1100:
        problems.append(f"long patient text ({words} words)")
    if not any(re.search(p, case.diagnosis, re.I) for r in case.rubric if r.source == "final_diagnosis" for p in r.match):
        problems.append("no final_diagnosis rubric item matches the case's own diagnosis string")
    status = "ok " if not problems else "WARN"
    print(f"{status} {case.id:32s} {case.track:12s} d{case.difficulty} stages={len(case.stages)} rubric={len(case.rubric)} max={case.max_score} words={words}")
    for p in problems:
        print(f"     - {p}")
        errors += 1
print(f"\n{len(ids)} cases, {errors} problems")
sys.exit(1 if errors else 0)
