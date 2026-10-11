from app.srs import sm2


def test_sm2_progression():
    reps, interval, ease, _ = sm2(4, 0, 0, 2.5)
    assert (reps, interval) == (1, 1)
    reps, interval, ease, _ = sm2(4, reps, interval, ease)
    assert (reps, interval) == (2, 3)
    reps, interval, ease, _ = sm2(5, reps, interval, ease)
    assert reps == 3 and interval > 3
    reps, interval, ease, _ = sm2(1, reps, interval, ease)
    assert (reps, interval) == (0, 1)
    assert ease >= 1.3
