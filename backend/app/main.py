from __future__ import annotations

import random
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from . import engine as eng
from .attendings import ATTENDINGS, get_attending
from .cases import all_cases, get_case, reload_cases
from .config import settings
from .db import get_session, init_db
from .llm import get_llm
from .models import CaseSession, RubricResult


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    all_cases()
    yield


app = FastAPI(title="Anna's Attending", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=True)


def require_auth(x_app_password: Annotated[str | None, Header()] = None) -> None:
    if settings.app_password and x_app_password != settings.app_password:
        raise HTTPException(401, "bad password")


DB = Annotated[Session, Depends(get_session)]
Auth = Annotated[None, Depends(require_auth)]


# ---------- schemas ----------
class StartRequest(BaseModel):
    case_id: str | None = None  # None = pick one not yet completed
    attending_id: str = "mentor"
    track: str | None = None


class RespondRequest(BaseModel):
    text: str


class FinishRequest(BaseModel):
    diagnosis: str
    management: str


class GradeRequest(BaseModel):
    grade: int


# ---------- routes ----------
@app.get("/api/health")
def health():
    return {"ok": True, "llm_provider": settings.llm_provider, "llm_model": settings.llm_model, "learner": settings.learner_name}


@app.post("/api/auth/check")
def auth_check(_: Auth):
    return {"ok": True}


@app.get("/api/attendings")
def list_attendings(_: Auth):
    return [a.model_dump(exclude={"style", "help_policy", "debrief_voice"}) for a in ATTENDINGS]


@app.get("/api/cases")
def list_cases(_: Auth, db: DB):
    done = {s.case_id for s in db.exec(select(CaseSession).where(CaseSession.status == "finished"))}
    return [{**c.summary(), "completed": c.id in done} for c in all_cases().values()]


@app.post("/api/cases/reload")
def reload(_: Auth):
    reload_cases()
    return {"count": len(all_cases())}


@app.post("/api/sessions")
def start(_: Auth, db: DB, body: StartRequest):
    case_id = body.case_id
    if not case_id:
        done = {s.case_id for s in db.exec(select(CaseSession).where(CaseSession.status == "finished"))}
        pool = [c for c in all_cases().values() if c.id not in done and (not body.track or c.track == body.track)]
        if not pool:
            pool = [c for c in all_cases().values() if not body.track or c.track == body.track]
        if not pool:
            raise HTTPException(404, "no cases available")
        case_id = random.choice(pool).id
    try:
        sess = eng.start_session(db, case_id, attending_id=body.attending_id)
    except KeyError:
        raise HTTPException(404, "unknown case")
    return session_view(_, db, sess.id)


@app.get("/api/sessions/{session_id}")
def session_view(_: Auth, db: DB, session_id: str):
    try:
        sess = eng.get_session_or_404(db, session_id)
    except KeyError:
        raise HTTPException(404, "unknown session")
    case = get_case(sess.case_id)
    stages = [eng._public_stage(s) for s in case.stages[: sess.stage_index + 1]]
    out = {
        "id": sess.id,
        "case": {"id": case.id, "title": case.title, "track": case.track, "difficulty": case.difficulty, "presentation": case.presentation, "n_stages": len(case.stages)},
        "attending": get_attending(sess.attending_id).model_dump(exclude={"style", "help_policy", "debrief_voice"}),
        "status": sess.status,
        "stage_index": sess.stage_index,
        "stages": stages,
        "turns": [{"role": t.role, "stage_index": t.stage_index, "content": t.content} for t in eng.turns(db, sess.id) if t.role != "reveal"],
    }
    if sess.status == "finished":
        out["result"] = {
            "score": sess.score,
            "max_score": sess.max_score,
            "final_diagnosis": sess.final_diagnosis,
            "final_management": sess.final_management,
            "debrief": sess.debrief,
            "diagnosis": case.diagnosis,
            "key_clues": case.key_clues,
            "distractors": [d.model_dump() for d in case.distractors],
            "management_summary": case.management_summary,
            "teaching_points": case.teaching_points,
            "references": case.references,
            "rubric": [{"id": r.rubric_id, "description": r.description, "category": r.category, "weight": r.weight, "hit": r.hit} for r in eng.rubric_results(db, sess.id)],
        }
    return out


@app.post("/api/sessions/{session_id}/respond")
async def respond(_: Auth, db: DB, session_id: str, body: RespondRequest):
    try:
        sess = eng.get_session_or_404(db, session_id)
    except KeyError:
        raise HTTPException(404, "unknown session")
    if sess.status != "active":
        raise HTTPException(409, "session finished")
    if not body.text.strip():
        raise HTTPException(422, "empty message")
    llm = get_llm()

    async def gen():
        async for chunk in eng.respond(db, llm, sess, body.text.strip()):
            yield chunk

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8", headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


@app.post("/api/sessions/{session_id}/advance")
def advance(_: Auth, db: DB, session_id: str):
    try:
        sess = eng.get_session_or_404(db, session_id)
        return eng.advance(db, sess)
    except KeyError:
        raise HTTPException(404, "unknown session")
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.post("/api/sessions/{session_id}/finish")
async def finish(_: Auth, db: DB, session_id: str, body: FinishRequest):
    try:
        sess = eng.get_session_or_404(db, session_id)
        await eng.finish(db, get_llm(), sess, body.diagnosis.strip(), body.management.strip())
    except KeyError:
        raise HTTPException(404, "unknown session")
    except ValueError as e:
        raise HTTPException(409, str(e))
    return session_view(_, db, session_id)


@app.get("/api/sessions")
def list_sessions(_: Auth, db: DB):
    rows = db.exec(select(CaseSession).order_by(CaseSession.started_at.desc()).limit(50))
    return [{"id": s.id, "case_id": s.case_id, "title": get_case(s.case_id).title, "status": s.status, "attending_id": s.attending_id, "score": s.score, "max_score": s.max_score, "started_at": s.started_at, "finished_at": s.finished_at} for s in rows]


@app.get("/api/reviews/due")
def reviews_due(_: Auth, db: DB):
    return [{"id": r.id, "concept": r.concept, "question": r.question, "answer": r.answer, "case_title": get_case(r.case_id).title, "due_at": r.due_at, "repetitions": r.repetitions} for r in eng.due_reviews(db)]


@app.post("/api/reviews/{item_id}/grade")
def grade(_: Auth, db: DB, item_id: str, body: GradeRequest):
    try:
        r = eng.grade_review(db, item_id, body.grade)
    except KeyError:
        raise HTTPException(404, "unknown review item")
    return {"id": r.id, "due_at": r.due_at, "interval_days": r.interval_days, "repetitions": r.repetitions}


@app.get("/api/progress")
def progress(_: Auth, db: DB):
    return eng.progress(db)
