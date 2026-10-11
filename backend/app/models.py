from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return uuid.uuid4().hex


class CaseSession(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    case_id: str = Field(index=True)
    mode: str = "standard"  # standard | challenge
    status: str = "active"  # active | finished
    stage_index: int = 0
    started_at: datetime = Field(default_factory=_now)
    finished_at: datetime | None = None
    final_diagnosis: str | None = None
    final_management: str | None = None
    score: int | None = None
    max_score: int | None = None
    debrief: str | None = None


class Turn(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    stage_index: int
    role: str  # learner | attending | reveal
    content: str
    created_at: datetime = Field(default_factory=_now)


class RubricResult(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: str = Field(index=True)
    case_id: str = Field(index=True)
    rubric_id: str
    description: str
    category: str
    concept: str | None = None
    weight: int
    hit: bool
    stage_hit: int | None = None


class ReviewItem(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    source_session_id: str
    case_id: str
    rubric_id: str
    concept: str
    question: str
    answer: str
    created_at: datetime = Field(default_factory=_now)
    due_at: datetime = Field(default_factory=_now, index=True)
    interval_days: float = 0
    ease: float = 2.5
    repetitions: int = 0
    last_grade: int | None = None
    retired: bool = False
