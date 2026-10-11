import asyncio

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app import engine as eng
from app.llm import Mock
from app import models  # noqa: F401


@pytest.fixture
def db():
    e = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(e)
    with Session(e) as s:
        yield s


def test_full_session_flow(db):
    llm = Mock()
    sess = eng.start_session(db, "siadh-sclc-01", attending_id="skeptic")
    assert sess.stage_index == 0 and sess.attending_id == "skeptic"

    async def run():
        chunks = [c async for c in eng.respond(db, llm, sess, "SIADH vs hypovolemia. What is her volume status?")]
        assert "".join(chunks)
        assert eng.advance(db, sess)["stage_index"] == 1
        [c async for c in eng.respond(db, llm, sess, "Euvolemic. Urine osm and urine sodium please, plus TSH.")]
        assert eng.advance(db, sess)["stage_index"] == 2
        assert eng.advance(db, sess) == {"done": True}
        return await eng.finish(db, llm, sess, "SIADH from small cell lung cancer", "3% saline bolus, cap at 8 mEq/24h")

    finished = asyncio.run(run())
    assert finished.status == "finished"
    assert finished.score is not None and finished.score > 0
    assert finished.debrief
    results = eng.rubric_results(db, sess.id)
    assert len(results) == 9
    missed = [r for r in results if not r.hit]
    due = eng.due_reviews(db)
    assert len(due) == len([r for r in missed if r.concept])
    if due:
        item = eng.grade_review(db, due[0].id, 4)
        assert item.repetitions == 1 and item.interval_days == 1
    prog = eng.progress(db)
    assert prog["cases_completed"] == 1


def test_finish_twice_rejected(db):
    sess = eng.start_session(db, "siadh-sclc-01")
    asyncio.run(eng.finish(db, Mock(), sess, "x", "y"))
    with pytest.raises(ValueError):
        asyncio.run(eng.finish(db, Mock(), sess, "x", "y"))


def test_unknown_attending_falls_back(db):
    sess = eng.start_session(db, "siadh-sclc-01", attending_id="nobody")
    assert sess.attending_id == "mentor"
