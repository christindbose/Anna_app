"""SM-2 spaced repetition."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone


def sm2(grade: int, repetitions: int, interval_days: float, ease: float) -> tuple[int, float, float, datetime]:
    """
    grade: 0..5 (0-2 = fail, 3 = hard, 4 = good, 5 = easy)
    returns (repetitions, interval_days, ease, due_at)
    """
    grade = max(0, min(5, grade))
    if grade < 3:
        repetitions = 0
        interval_days = 1
    else:
        if repetitions == 0:
            interval_days = 1
        elif repetitions == 1:
            interval_days = 3
        else:
            interval_days = round(interval_days * ease, 1)
        repetitions += 1
    ease = max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
    due_at = datetime.now(timezone.utc) + timedelta(days=interval_days)
    return repetitions, interval_days, ease, due_at
