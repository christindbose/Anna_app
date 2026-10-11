"""Session state machine. All state lives in the DB; case facts come from the case file."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from sqlmodel import Session, select

from . import prompts
from .cases import Case, get_case
from .config import settings
from .llm import LLM, extract_json
from .models import CaseSession, ReviewItem, RubricResult, Turn
from .scoring import RubricOutcome, named_diagnosis, score_session, total
from .srs import sm2

log = logging.getLogger("anna.engine")


def start_session(db: Session, case_id: str, mode: str = "standard") -> CaseSession:
    case = get_case(case_id)
    sess = CaseSession(case_id=case.id, mode=mode, stage_index=0, max_score=case.max_score)
    db.add(sess)
    db.add(Turn(session_id=sess.id, stage_index=0, role="reveal", content=case.stages[0].text))
    db.commit()
    db.refresh(sess)
    return sess


def get_session_or_404(db: Session, session_id: str) -> CaseSession:
    sess = db.get(CaseSession, session_id)
    if not sess:
        raise KeyError(session_id)
    return sess


def turns(db: Session, session_id: str) -> list[Turn]:
    return list(db.exec(select(Turn).where(Turn.session_id == session_id).order_by(Turn.id)))


def _history_messages(case: Case, sess: CaseSession, all_turns: list[Turn]) -> list[dict]:
    """Learner/attending turns for the current stage only, so the context stays small.
    Earlier stages are summarised into one user message."""
    msgs: list[dict] = []
    earlier = [t for t in all_turns if t.stage_index < sess.stage_index and t.role == "learner"]
    if earlier:
        summary = "\n".join(f"- (stage {t.stage_index + 1}) {t.content}" for t in earlier)
        msgs.append({"role": "user", "content": f"[Earlier in this case the learner said:]\n{summary}"})
        msgs.append({"role": "assistant", "content": "Understood. Let's continue."})
    for t in all_turns:
        if t.stage_index != sess.stage_index or t.role == "reveal":
            continue
        msgs.append({"role": "user" if t.role == "learner" else "assistant", "content": t.content})
    return msgs


async def respond(db: Session, llm: LLM, sess: CaseSession, learner_text: str) -> AsyncIterator[str]:
    """Store the learner turn, stream the attending's reply, store it when done."""
    if sess.status != "active":
        raise ValueError("session is finished")
    case = get_case(sess.case_id)
    db.add(Turn(session_id=sess.id, stage_index=sess.stage_index, role="learner", content=learner_text))
    db.commit()

    system = prompts.attending_system(case, sess.stage_index, settings.learner_name, sess.mode == "challenge")
    messages = [{"role": "system", "content": system}] + _history_messages(case, sess, turns(db, sess.id))

    buf: list[str] = []
    async for chunk in llm.stream(messages):
        buf.append(chunk)
        yield chunk
    reply = "".join(buf).strip()
    learner_said_it = any(named_diagnosis(case, t.content) for t in turns(db, sess.id) if t.role == "learner")
    if named_diagnosis(case, reply) and not learner_said_it:
        log.warning("attending reply named the diagnosis (session %s, stage %s)", sess.id, sess.stage_index)
    db.add(Turn(session_id=sess.id, stage_index=sess.stage_index, role="attending", content=reply))
    db.commit()


def advance(db: Session, sess: CaseSession) -> dict:
    """Reveal the next stage. Returns the new stage payload, or {'done': True} if none remain."""
    if sess.status != "active":
        raise ValueError("session is finished")
    case = get_case(sess.case_id)
    if sess.stage_index + 1 >= len(case.stages):
        return {"done": True}
    sess.stage_index += 1
    stage = case.stages[sess.stage_index]
    db.add(Turn(session_id=sess.id, stage_index=sess.stage_index, role="reveal", content=stage.text))
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return {"done": False, "stage_index": sess.stage_index, "stage": _public_stage(stage)}


def _public_stage(stage) -> dict:
    return {
        "id": stage.id,
        "label": stage.label,
        "text": stage.text,
        "prompt": stage.prompt,
        "available_tests": list(stage.available_tests.keys()),
    }


def _learner_text_by_stage(all_turns: list[Turn]) -> dict[int, str]:
    out: dict[int, str] = {}
    for t in all_turns:
        if t.role == "learner":
            out[t.stage_index] = out.get(t.stage_index, "") + "\n" + t.content
    return out


async def finish(db: Session, llm: LLM, sess: CaseSession, final_dx: str, final_mgmt: str) -> CaseSession:
    if sess.status != "active":
        raise ValueError("session is finished")
    case = get_case(sess.case_id)
    all_turns = turns(db, sess.id)
    outcomes = score_session(case, _learner_text_by_stage(all_turns), final_dx, final_mgmt)
    got, mx = total(outcomes)

    transcript = "\n".join(
        f"[{t.role.upper()} @ {case.stages[t.stage_index].label}] {t.content}" for t in all_turns if t.role != "reveal"
    )
    debrief = await llm.chat(
        [
            {"role": "system", "content": prompts.debrief_system(case, settings.learner_name, outcomes, transcript, final_dx, final_mgmt)},
            {"role": "user", "content": prompts.debrief_user()},
        ],
        max_tokens=600,
    )

    sess.status = "finished"
    sess.finished_at = datetime.now(timezone.utc)
    sess.final_diagnosis = final_dx
    sess.final_management = final_mgmt
    sess.score, sess.max_score = got, mx
    sess.debrief = debrief
    db.add(sess)
    for o in outcomes:
        db.add(
            RubricResult(
                session_id=sess.id, case_id=case.id, rubric_id=o.item.id, description=o.item.description,
                category=o.item.category, concept=o.item.concept, weight=o.item.weight, hit=o.hit, stage_hit=o.stage_hit,
            )
        )
    db.commit()

    await _create_review_items(db, llm, sess, case, outcomes)
    db.refresh(sess)
    return sess


async def _create_review_items(db: Session, llm: LLM, sess: CaseSession, case: Case, outcomes: list[RubricOutcome]) -> None:
    for o in outcomes:
        if o.hit or not o.item.concept:
            continue
        try:
            raw = await llm.chat(
                [
                    {"role": "system", "content": prompts.review_question_system()},
                    {"role": "user", "content": prompts.review_question_user(o.item.concept, o.item.description, case)},
                ],
                max_tokens=300,
                temperature=0.7,
            )
            qa = extract_json(raw)
            question, answer = str(qa["question"]).strip(), str(qa["answer"]).strip()
        except Exception:
            question = f"Explain: {o.item.concept}. ({o.item.description})"
            answer = f"See teaching points for '{case.title}'."
        db.add(
            ReviewItem(
                source_session_id=sess.id, case_id=case.id, rubric_id=o.item.id,
                concept=o.item.concept, question=question, answer=answer,
            )
        )
    db.commit()


def rubric_results(db: Session, session_id: str) -> list[RubricResult]:
    return list(db.exec(select(RubricResult).where(RubricResult.session_id == session_id)))


def due_reviews(db: Session, limit: int = 20) -> list[ReviewItem]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(ReviewItem)
        .where(ReviewItem.due_at <= now, ReviewItem.retired == False)  # noqa: E712
        .order_by(ReviewItem.due_at)
        .limit(limit)
    )
    return list(db.exec(stmt))


def grade_review(db: Session, item_id: str, grade: int) -> ReviewItem:
    item = db.get(ReviewItem, item_id)
    if not item:
        raise KeyError(item_id)
    item.repetitions, item.interval_days, item.ease, item.due_at = sm2(grade, item.repetitions, item.interval_days, item.ease)
    item.last_grade = grade
    if item.repetitions >= 5 and item.interval_days > 60:
        item.retired = True
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def progress(db: Session) -> dict:
    sessions = list(db.exec(select(CaseSession).where(CaseSession.status == "finished").order_by(CaseSession.finished_at.desc())))
    results = list(db.exec(select(RubricResult)))
    by_category: dict[str, dict[str, int]] = {}
    by_concept: dict[str, dict[str, int]] = {}
    for r in results:
        c = by_category.setdefault(r.category, {"hit": 0, "total": 0})
        c["total"] += r.weight
        c["hit"] += r.weight if r.hit else 0
        if r.concept:
            k = by_concept.setdefault(r.concept, {"hit": 0, "total": 0})
            k["total"] += 1
            k["hit"] += 1 if r.hit else 0
    weak = sorted(
        ({"concept": k, **v, "miss_rate": 1 - v["hit"] / v["total"]} for k, v in by_concept.items() if v["total"] > 0),
        key=lambda x: (-x["miss_rate"], -x["total"]),
    )[:10]
    total_score = sum(s.score or 0 for s in sessions)
    total_max = sum(s.max_score or 0 for s in sessions)
    n_due = len(due_reviews(db, limit=1000))
    return {
        "cases_completed": len(sessions),
        "overall_pct": round(100 * total_score / total_max) if total_max else None,
        "by_category": by_category,
        "weak_concepts": weak,
        "reviews_due": n_due,
        "recent": [
            {"session_id": s.id, "case_id": s.case_id, "score": s.score, "max_score": s.max_score, "finished_at": s.finished_at, "mode": s.mode}
            for s in sessions[:10]
        ],
    }
