#!/usr/bin/env python
"""Draft a new case from a topic using the model, validate it, and write it as an unreviewed draft.

Usage (anna env, model server running):
  python scripts/draft_case.py --track general-im --difficulty 2 "Addison's disease presenting as hyponatremia and hyperkalemia"
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import prompts  # noqa: E402
from app.cases import Case  # noqa: E402
from app.llm import extract_json, get_llm  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("topic")
    ap.add_argument("--track", default="general-im")
    ap.add_argument("--difficulty", type=int, default=2)
    ap.add_argument("--attempts", type=int, default=3)
    args = ap.parse_args()

    schema = (ROOT / "cases" / "SCHEMA.md").read_text()
    example = (ROOT / "cases" / "general-im" / "siadh-sclc-01.json").read_text()
    user = (
        f"Topic: {args.topic}\nTrack: {args.track}\nDifficulty: {args.difficulty}\n\n"
        f"SCHEMA:\n{schema}\n\nEXAMPLE CASE (match its depth and style, do not copy its content):\n{example}\n\n"
        "Return only the JSON for the new case."
    )
    llm = get_llm()
    last_err = ""
    for attempt in range(1, args.attempts + 1):
        raw = await llm.chat(
            [{"role": "system", "content": prompts.case_draft_system()}, {"role": "user", "content": user + (f"\n\nPrevious attempt failed validation: {last_err}" if last_err else "")}],
            max_tokens=4000,
            temperature=0.8,
        )
        try:
            data = extract_json(raw)
            data["track"] = args.track
            data["reviewed"] = False
            case = Case.model_validate(data)
            for r in case.rubric:
                for p in r.match:
                    re.compile(p)
        except Exception as e:  # noqa: BLE001
            last_err = str(e)[:500]
            print(f"attempt {attempt} invalid: {last_err}", file=sys.stderr)
            continue
        out = ROOT / "cases" / args.track / f"{case.id}.json"
        if out.exists():
            out = out.with_name(f"{case.id}-draft{attempt}.json")
        out.write_text(json.dumps(case.model_dump(), indent=2))
        print(f"wrote {out}  (reviewed: false — read it before using)")
        return 0
    print("gave up", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
