"""Case schema and loader. Case files are the ground truth for every session."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .config import settings

Category = Literal["diagnosis", "workup", "reasoning", "management"]


class Stage(BaseModel):
    id: str
    label: str
    text: str
    prompt: str
    learner_goal: str | None = None
    available_tests: dict[str, str] = Field(default_factory=dict)


class Distractor(BaseModel):
    name: str
    why_not: str


class RubricItem(BaseModel):
    id: str
    description: str
    category: Category
    weight: int = 1
    match: list[str]
    source: Literal["any", "final_diagnosis", "final_management"] = "any"
    by_stage: str | None = None
    concept: str | None = None


class Case(BaseModel):
    id: str
    title: str
    track: str
    difficulty: int = 2
    tags: list[str] = Field(default_factory=list)
    reviewed: bool = False
    presentation: str
    stages: list[Stage]
    diagnosis: str
    diagnosis_aliases: list[str] = Field(default_factory=list)
    key_clues: list[str] = Field(default_factory=list)
    distractors: list[Distractor] = Field(default_factory=list)
    rubric: list[RubricItem]
    management_summary: str = ""
    teaching_points: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)

    @field_validator("stages")
    @classmethod
    def _at_least_one_stage(cls, v: list[Stage]) -> list[Stage]:
        if not v:
            raise ValueError("case needs at least one stage")
        return v

    @property
    def max_score(self) -> int:
        return sum(r.weight for r in self.rubric)

    def stage_index(self, stage_id: str) -> int:
        for i, s in enumerate(self.stages):
            if s.id == stage_id:
                return i
        raise KeyError(stage_id)

    def revealed_text(self, upto_stage: int) -> str:
        """Everything the learner has seen through stage index `upto_stage` (inclusive)."""
        parts = [f"Presentation: {self.presentation}"]
        for s in self.stages[: upto_stage + 1]:
            parts.append(f"{s.label}: {s.text}")
        return "\n\n".join(parts)

    def summary(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "track": self.track,
            "difficulty": self.difficulty,
            "tags": self.tags,
            "reviewed": self.reviewed,
            "n_stages": len(self.stages),
        }


def load_case_file(path: Path) -> Case:
    with open(path) as f:
        data = json.load(f)
    return Case.model_validate(data)


@lru_cache(maxsize=1)
def _load_all(cases_dir: str) -> dict[str, Case]:
    cases: dict[str, Case] = {}
    for path in sorted(Path(cases_dir).glob("*/*.json")):
        case = load_case_file(path)
        if case.id in cases:
            raise ValueError(f"duplicate case id {case.id} in {path}")
        cases[case.id] = case
    return cases


def all_cases() -> dict[str, Case]:
    return _load_all(str(settings.cases_dir))


def get_case(case_id: str) -> Case:
    try:
        return all_cases()[case_id]
    except KeyError:
        raise KeyError(f"unknown case {case_id}") from None


def reload_cases() -> None:
    _load_all.cache_clear()
