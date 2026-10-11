"""Deterministic rubric scoring. The model never decides the score."""
from __future__ import annotations

import re
from dataclasses import dataclass

from .cases import Case, RubricItem


@dataclass
class RubricOutcome:
    item: RubricItem
    hit: bool
    stage_hit: int | None  # stage index where it was first satisfied (for source=any)


def _matches(patterns: list[str], text: str) -> bool:
    return any(re.search(p, text, flags=re.IGNORECASE) for p in patterns)


def score_session(
    case: Case,
    learner_text_by_stage: dict[int, str],
    final_diagnosis: str,
    final_management: str,
) -> list[RubricOutcome]:
    """
    learner_text_by_stage: stage index -> concatenated learner messages during that stage.
    """
    outcomes: list[RubricOutcome] = []
    for item in case.rubric:
        if item.source == "final_diagnosis":
            outcomes.append(RubricOutcome(item, _matches(item.match, final_diagnosis), None))
            continue
        if item.source == "final_management":
            outcomes.append(RubricOutcome(item, _matches(item.match, final_management), None))
            continue

        deadline = case.stage_index(item.by_stage) if item.by_stage else len(case.stages) - 1
        stage_hit: int | None = None
        for idx in sorted(learner_text_by_stage):
            if idx > deadline:
                break
            if _matches(item.match, learner_text_by_stage[idx]):
                stage_hit = idx
                break
        # the final commitment also counts for "any" items when no deadline was set
        if stage_hit is None and item.by_stage is None:
            if _matches(item.match, final_diagnosis + "\n" + final_management):
                stage_hit = len(case.stages) - 1
        outcomes.append(RubricOutcome(item, stage_hit is not None, stage_hit))
    return outcomes


def total(outcomes: list[RubricOutcome]) -> tuple[int, int]:
    got = sum(o.item.weight for o in outcomes if o.hit)
    mx = sum(o.item.weight for o in outcomes)
    return got, mx


def named_diagnosis(case: Case, text: str) -> bool:
    return _matches([re.escape(case.diagnosis)] + case.diagnosis_aliases, text)
