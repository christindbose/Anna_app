#!/usr/bin/env python
"""Re-draft the whole case library with the model (MedGemma), one case per existing case id.

Each existing case contributes only its id, track, difficulty and the diagnosis used as the topic;
the patient, stages, rubric and teaching content are written by the model. Output goes to a
staging directory (default cases_medgemma/) so the live library is untouched until you copy.
Resumable: cases that already exist and validate in the staging dir are skipped.

Usage (anna env, model server running):
  python scripts/draft_library.py [--out cases_medgemma] [--only <case-id>] [--attempts 4]
"""
import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import prompts  # noqa: E402
from app.cases import Case, load_case_file  # noqa: E402
from app.config import settings  # noqa: E402
from app.llm import extract_json, get_llm  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_CATS = {"diagnosis", "workup", "reasoning", "management"}


def repair_json(text: str) -> str:
    """Small fixes for common model slips: trailing commas, smart quotes."""
    # Curly quotes appear inside prose; straight double quotes there would break the JSON,
    # so turn them into apostrophes.
    text = text.replace("“", "'").replace("”", "'").replace("‘", "'").replace("’", "'")
    text = re.sub(r",\s*([}\]])", r"\1", text)
    return text


CATEGORY_ALIASES = {"work-up": "workup", "work up": "workup", "investigation": "workup", "investigations": "workup",
                    "dx": "diagnosis", "differential": "diagnosis", "treatment": "management", "mgmt": "management",
                    "plan": "management", "clinical reasoning": "reasoning", "exam": "workup", "examination": "workup",
                    "history": "workup", "labs": "workup", "laboratory": "workup", "imaging": "workup", "tests": "workup",
                    "testing": "workup", "evaluation": "workup", "assessment": "reasoning", "interpretation": "reasoning"}


def _safe_search(pattern: str, text: str) -> bool:
    try:
        return re.search(pattern, text, re.I) is not None
    except re.error:
        return False


def normalise(data: dict) -> dict:
    """Forgive the small schema slips a 4B model makes, so retries are spent on substance."""
    for r in data.get("rubric", []):
        src = str(r.get("source", "any")).lower()
        if src not in ("any", "final_diagnosis", "final_management"):
            r["source"] = "final_diagnosis" if "diagnos" in src else "final_management" if "manag" in src else "any"
        cat = str(r.get("category", "")).lower().strip()
        r["category"] = CATEGORY_ALIASES.get(cat, cat)
        r["match"] = [str(m).lower() for m in r.get("match", []) if str(m).strip()]
        try:
            r["weight"] = max(1, min(3, int(r.get("weight", 1))))
        except (TypeError, ValueError):
            r["weight"] = 1
        if r.get("by_stage") in ("", None, "null"):
            r.pop("by_stage", None)
    for st in data.get("stages", []):
        st.setdefault("id", str(st.get("label", "stage")).lower().replace(" ", "-"))
        st.setdefault("label", str(st["id"]).replace("-", " ").title())
        st.setdefault("prompt", "What is your differential now, and what do you want next?")
        if not isinstance(st.get("available_tests"), dict):
            st["available_tests"] = {}
        else:
            st["available_tests"] = {str(k): str(v) for k, v in st["available_tests"].items()}
    for key in ("tags", "diagnosis_aliases", "key_clues", "teaching_points", "references"):
        v = data.get(key)
        if isinstance(v, str):
            data[key] = [v]
    data["distractors"] = [d for d in data.get("distractors", []) if isinstance(d, dict) and "name" in d and "why_not" in d]

    rubric = data.get("rubric", [])
    stage_ids = {str(st.get("id")) for st in data.get("stages", [])}
    for r in rubric:
        if r.get("by_stage") and r["by_stage"] not in stage_ids:
            r.pop("by_stage", None)
    # Guarantee a final_diagnosis item: build it from the diagnosis string and its aliases.
    if not any(r.get("source") == "final_diagnosis" for r in rubric):
        dx = str(data.get("diagnosis", "")).lower()
        aliases = [str(a).lower() for a in data.get("diagnosis_aliases", []) if str(a).strip()]
        words = [w for w in re.findall(r"[a-z][a-z-]{3,}", dx) if w not in ("with", "from", "secondary", "acute", "chronic", "presumed", "likely")]
        pats = [re.escape(a) for a in aliases] + ([" ".join(map(re.escape, words[:2]))] if words else [])
        rubric.append({"id": "final-diagnosis", "description": "Names the final diagnosis", "category": "diagnosis",
                       "weight": 3, "match": [p for p in pats if p], "source": "final_diagnosis", "concept": data.get("diagnosis", "")})
    # If the final_diagnosis item exists but its regexes miss the diagnosis string, add alias patterns.
    dx = str(data.get("diagnosis", "")).lower()
    for r in rubric:
        if r.get("source") == "final_diagnosis" and not any(_safe_search(p, dx) for p in r.get("match", [])):
            aliases = [str(a).lower() for a in data.get("diagnosis_aliases", []) if str(a).strip() and str(a).lower() in dx]
            words = [w for w in re.findall(r"[a-z][a-z-]{3,}", dx) if w not in ("with", "from", "secondary", "acute", "chronic", "presumed", "likely")]
            extra = [re.escape(a) for a in aliases] + ([re.escape(words[0])] if words else [])
            r["match"] = list(dict.fromkeys(r.get("match", []) + extra))
    # Guarantee a workup item: relabel the items that are clearly about ordering or reading tests.
    if not any(r.get("category") == "workup" for r in rubric):
        kw = re.compile(r"order|test|lab|ecg|ekg|troponin|imaging|x-ray|cxr|ct\b|mri|echo|culture|biopsy|urine|smear|esr|crp|"
                        r"level|panel|measure|check|send|obtain", re.I)
        for r in rubric:
            if r.get("category") != "diagnosis" and kw.search(r.get("id", "") + " " + r.get("description", "")):
                r["category"] = "workup"
                break
    # Guarantee every category: relabel the best-fitting item from the most populous category.
    hints = {"reasoning": re.compile(r"differential|consider|recogni|interpret|distinguish|rule out|anchor|priorit|risk|weigh|compare|mimic", re.I),
             "management": re.compile(r"treat|manage|start|give|admit|discharge|dose|therapy|refer|consult|monitor|avoid|stop|hold", re.I),
             "workup": re.compile(r"order|test|lab|ecg|imaging|x-ray|echo|culture|biopsy|urine|smear|level|panel|check|send|obtain", re.I),
             "diagnosis": re.compile(r"diagnos|names|identif", re.I)}
    for cat in ("diagnosis", "workup", "reasoning", "management"):
        if any(r.get("category") == cat for r in rubric):
            continue
        counts = {}
        for r in rubric:
            counts[r.get("category")] = counts.get(r.get("category"), 0) + 1
        donors = [r for r in rubric if counts.get(r.get("category"), 0) >= 2 and r.get("source") != "final_diagnosis"]
        if not donors:
            continue
        pick = next((r for r in donors if hints[cat].search(r.get("id", "") + " " + r.get("description", ""))), None)
        if pick is None:
            pick = min(donors, key=lambda r: (r.get("weight", 1), -counts.get(r.get("category"), 0)))
        pick["category"] = cat
    if not any(r.get("source") == "final_management" for r in rubric):
        for r in rubric:
            if r.get("category") == "management":
                r["source"] = "final_management"
                break
    data["rubric"] = rubric
    return data


STOP = {"with", "from", "secondary", "acute", "chronic", "presumed", "likely", "patient", "presenting", "presents", "disease",
        "syndrome", "initially", "distinguishing", "deciding", "recognising", "starting", "giving", "before", "after", "young",
        "adult", "older", "woman", "man", "complicated", "complaint", "subtle", "department", "emergency", "mistaken", "applying"}


def topic_keywords(topic: str) -> list[str]:
    head = re.split(r"[;:]", topic, 1)[0].lower()
    return [w for w in re.findall(r"[a-z][a-z-]{4,}", head) if w not in STOP]


def check(case: Case, expect_id: str, expect_track: str, topic: str | None = None, dx_keywords: list[str] | None = None,
          mgmt_keywords: list[str] | None = None) -> list[str]:
    problems = []
    if mgmt_keywords:
        mg = (case.management_summary + " " + " ".join(p for r in case.rubric if r.source == "final_management" for p in r.match)).lower()
        if not any(k.lower() in mg for k in mgmt_keywords):
            problems.append(f"management_summary does not describe the guideline treatment for this diagnosis (expected to mention one of {mgmt_keywords}); do not copy the example case's management")
    if len(case.diagnosis) < 12:
        problems.append("diagnosis must be the full name of the condition, not an abbreviation")
    if dx_keywords:
        dx = (case.diagnosis + " " + " ".join(case.diagnosis_aliases)).lower()
        if not any(k.lower() in dx for k in dx_keywords):
            problems.append(f"the final diagnosis must be the requested one (expected it to mention one of {dx_keywords}); got {case.diagnosis!r}")
    if topic:
        kws = topic_keywords(topic)
        hay = (case.title + " " + case.diagnosis + " " + " ".join(case.diagnosis_aliases) + " " + case.presentation).lower()
        hits = [k for k in kws if k[:6] in hay]
        if kws and len(hits) < min(2, len(kws)):
            problems.append(f"case is not about the requested topic (expected words like {kws[:6]}; got title {case.title!r})")
    if case.track != expect_track:
        problems.append(f"track {case.track!r} != {expect_track!r}")
    if len(case.stages) < 3:
        problems.append("fewer than 3 stages")
    missing = REQUIRED_CATS - {r.category for r in case.rubric}
    if missing:
        problems.append(f"rubric missing categories {sorted(missing)}")
    if len(case.rubric) < 5:
        problems.append("fewer than 5 rubric items")
    stage_ids = {s.id for s in case.stages}
    for r in case.rubric:
        if r.by_stage and r.by_stage not in stage_ids:
            problems.append(f"rubric {r.id}: by_stage {r.by_stage!r} is not a stage id")
        for p in r.match:
            try:
                re.compile(p)
            except re.error as e:
                problems.append(f"rubric {r.id}: bad regex {p!r}: {e}")
    fd = [p for r in case.rubric if r.source == "final_diagnosis" for p in r.match]
    if not fd:
        problems.append("no rubric item with source final_diagnosis")
    elif not any(re.search(p, case.diagnosis, re.I) for p in fd):
        problems.append("no final_diagnosis rubric regex matches the case's own diagnosis string")
    words = len((case.presentation + " ".join(s.text for s in case.stages)).split())
    if words > 1100:
        problems.append(f"patient text too long ({words} words)")
    if words < 180:
        problems.append(f"patient text too short ({words} words; write 400-900 words with full vitals and labs in the stage texts)")
    return problems


def valid_existing(path: Path, expect_id: str, expect_track: str, topic: str | None = None, dx_keywords: list[str] | None = None,
                   mgmt_keywords: list[str] | None = None) -> bool:
    try:
        c = load_case_file(path)
        return c.id == expect_id and not check(c, expect_id, expect_track, topic, dx_keywords, mgmt_keywords)
    except Exception:  # noqa: BLE001
        return False


async def draft_one(llm, spec: dict, schema: str, example: str, attempts: int) -> Case | None:
    user = (
        f"Topic: {spec['topic']}\nTrack: {spec['track']}\nDifficulty: {spec['difficulty']} (1 intern .. 4 senior resident)\n"
        f"Use exactly this id: \"{spec['id']}\"\n"
        + (f"The final diagnosis MUST be this condition, written out in full (do not substitute a related disease): {spec['dx_name']}\n" if spec.get("dx_name") else "")
        + "\n"
        f"SCHEMA:\n{schema}\n\nEXAMPLE CASE (match its depth, structure and style; invent a different patient and do not copy its content):\n{example}\n\n"
        "Write a complete, medically accurate, internally consistent case on the topic, as a senior internist would for residents.\n"
        + ("This is an ADVANCED case for a senior internal medicine resident: atypical or subtle presentation, at least two interacting "
           "problems (comorbidity, drug effect or complication), one plausible red herring, and a decision with real risk (treat before "
           "confirmation, or escalate). Make the learner earn the diagnosis across 4 to 5 stages.\n" if spec["difficulty"] >= 3 else "")
        + 
        "Requirements:\n"
        "- presentation: 60-120 words with age, sex, chief complaint, triage vitals.\n"
        "- 3 to 5 stages in order (history, exam, then results, with a later twist for advanced cases); each stage text 120-250 words of concrete findings. Vitals and every "
        "lab or imaging result that matters must be written out IN THE STAGE TEXT with exact numbers and units (available_tests may "
        "repeat them). Total patient text 450-900 words.\n"
        "- Build in the discriminating findings that separate the diagnosis from its two closest mimics, and at least one red herring.\n"
        "- management_summary: current guideline first-line treatment with drug names, typical doses and duration, plus disposition.\n"
        "- rubric: 8 to 10 items covering diagnosis, workup, reasoning and management; weights 1-3; match patterns are lowercase, "
        "lenient regexes (synonyms with |), AT MOST 4 short patterns per item, each a word or phrase a learner would type (never bare numbers); exactly one item has source \"final_diagnosis\" and its regex must match the diagnosis "
        "string; at least two have source \"final_management\".\n"
        "- teaching_points: 4-6 specific, testable statements. references: 2-4 real guidelines or landmark papers (society, year).\n"
        "Output rules: compact JSON on a single line with no indentation or line breaks, no markdown fences, no text before or after it; inside string values never use double quotes "
        "(write 'gone' not \"gone\") and avoid line breaks.\n"
        "Return only the JSON for the new case."
    )
    last_err = ""
    for attempt in range(1, attempts + 1):
        t0 = time.time()
        raw = await llm.chat(
            [{"role": "system", "content": prompts.case_draft_system()},
             {"role": "user", "content": user + (f"\n\nYour previous attempt failed validation: {last_err}\nFix that and return the full JSON again." if last_err else "")}],
            max_tokens=6000,
            temperature=0.7,
        )
        dt = time.time() - t0
        try:
            data = normalise(extract_json(repair_json(raw)))
            data["id"] = spec["id"]
            data["track"] = spec["track"]
            data["difficulty"] = spec["difficulty"]
            data["reviewed"] = False
            data["source"] = settings.llm_model
            case = Case.model_validate(data)
            problems = check(case, spec["id"], spec["track"], spec["topic"], spec.get("dx_keywords"), spec.get("mgmt_keywords"))
            if problems:
                raise ValueError("; ".join(problems))
        except Exception as e:  # noqa: BLE001
            last_err = str(e)[:600]
            if "no JSON object" in last_err:
                # The model sometimes answers in prose or declines; restate the context plainly.
                last_err = ("you replied in prose instead of JSON. This is a fictional, educational teaching case for internal "
                            "medicine resident training with an invented patient; it is standard medical education content, "
                            "the kind found in any textbook. Write the case and return only the JSON")
            print(f"  attempt {attempt} invalid after {dt:.0f}s: {last_err[:200]}", flush=True)
            dump = ROOT / "logs" / f"draft-raw-{spec['id']}-{attempt}.txt"
            dump.parent.mkdir(exist_ok=True)
            dump.write_text(raw)
            continue
        print(f"  draft ok after {dt:.0f}s: {case.title!r}, {len(case.stages)} stages, {len(case.rubric)} rubric items", flush=True)
        case = await review_pass(llm, case, spec)
        return await ensure_short_title(llm, case)


async def ensure_short_title(llm, case: Case) -> Case:
    """Models often paste the topic as the title; ask for a chart-style one-liner instead."""
    if len(case.title) <= 80:
        return case
    try:
        raw = await llm.chat(
            [{"role": "system", "content": "You title teaching cases for internal medicine residents. Reply with the title only: no label, no quotes, no tags."},
             {"role": "user", "content": f"Presentation: {case.presentation}\nDiagnosis: {case.diagnosis}\n\nWrite a short, intriguing clinical title under 60 characters that hints at the presentation without naming the diagnosis, like a chart one-liner (e.g. 'Confusion and a sodium of 118'). Title only."}],
            max_tokens=40, temperature=0.4)
        title = re.sub(r"<[^>]+>", "", raw).strip().split("\n")[0]
        title = re.sub(r"^\W*title\W*", "", title, flags=re.I).strip(" *:\"'")
        if 8 <= len(title) <= 80:
            case = case.model_copy(update={"title": title})
            print(f"  title shortened to {title!r}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"  title pass failed ({str(e)[:80]}); keeping long title", flush=True)
    return case
    return None


REVIEW_SYSTEM = """You are a senior academic internist reviewing a progressive-disclosure teaching case written for internal medicine residents.
Check it against current guidelines and standard references. Fix, in place: factual or guideline errors (especially first-line
management, drug choices, doses, thresholds); findings inconsistent with the diagnosis; distractors whose why_not is wrong; stage text
that omits a result the rubric or attending would need; vague teaching points. Keep the same JSON schema, the same id, track,
difficulty and diagnosis, and the same rubric ids. Do not shorten the case. Return only the corrected full JSON."""


async def review_pass(llm, case: Case, spec: dict) -> Case:
    """Second pass: the model reviews and corrects its own draft. Falls back to the draft if the revision is invalid."""
    t0 = time.time()
    try:
        raw = await llm.chat(
            [{"role": "system", "content": REVIEW_SYSTEM},
             {"role": "user", "content": "CASE JSON:\n" + json.dumps(case.model_dump(), ensure_ascii=False) + "\n\nReturn the corrected full JSON, compact, on a single line."}],
            max_tokens=6000,
            temperature=0.3,
        )
        data = normalise(extract_json(repair_json(raw)))
        for k in ("id", "track", "difficulty", "diagnosis", "source"):
            data[k] = getattr(case, k)
        data["reviewed"] = False
        revised = Case.model_validate(data)
        problems = check(revised, spec["id"], spec["track"], spec["topic"], spec.get("dx_keywords"), spec.get("mgmt_keywords"))
        if problems:
            raise ValueError("; ".join(problems))
        if {r.id for r in revised.rubric} != {r.id for r in case.rubric}:
            raise ValueError("rubric ids changed")
    except Exception as e:  # noqa: BLE001
        print(f"  review pass discarded after {time.time() - t0:.0f}s ({str(e)[:120]}); keeping draft", flush=True)
        return case
    print(f"  review pass applied after {time.time() - t0:.0f}s", flush=True)
    return revised


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="cases_medgemma")
    ap.add_argument("--only", action="append", default=[])
    ap.add_argument("--attempts", type=int, default=4)
    ap.add_argument("--topics", help="JSON list of {id, track, difficulty, topic}; default: derive from the live library")
    args = ap.parse_args()
    out_root = ROOT / args.out
    schema = (ROOT / "cases" / "SCHEMA.md").read_text()
    # Style example lives with the test fixtures so the live library can change freely.
    example = (ROOT / "backend" / "tests" / "fixtures" / "general-im" / "siadh-sclc-01.json").read_text()

    specs = []
    if args.topics:
        for t in json.loads(Path(args.topics).read_text()):
            if not args.only or t["id"] in args.only:
                specs.append({"id": t["id"], "track": t["track"], "difficulty": int(t.get("difficulty", 3)), "topic": t["topic"],
                              "dx_keywords": t.get("diagnosis_keywords"), "dx_name": t.get("diagnosis_name"),
                              "mgmt_keywords": t.get("management_keywords")})
    else:
        for path in sorted((ROOT / "cases").glob("*/*.json")):
            c = load_case_file(path)
            if args.only and c.id not in args.only:
                continue
            specs.append({"id": c.id, "track": c.track, "difficulty": c.difficulty, "topic": c.diagnosis})
    print(f"model: {settings.llm_model}; {len(specs)} case(s) -> {out_root}", flush=True)

    llm = get_llm()
    failed = []
    for i, spec in enumerate(specs, 1):
        out = out_root / spec["track"] / f"{spec['id']}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        print(f"[{i}/{len(specs)}] {spec['id']}  ({spec['topic'][:70]})", flush=True)
        if out.exists() and valid_existing(out, spec["id"], spec["track"], spec["topic"], spec.get("dx_keywords"), spec.get("mgmt_keywords")):
            print("  already drafted, skipping", flush=True)
            continue
        case = await draft_one(llm, spec, schema, example, args.attempts)
        if case is None:
            failed.append(spec["id"])
            print("  FAILED", flush=True)
            continue
        out.write_text(json.dumps(case.model_dump(), indent=2, ensure_ascii=False) + "\n")
    print(f"\ndone: {len(specs) - len(failed)} drafted, {len(failed)} failed {failed}", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
