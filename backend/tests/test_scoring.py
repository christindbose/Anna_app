from app.cases import get_case
from app.scoring import score_session, total


def test_siadh_full_marks():
    case = get_case("siadh-sclc-01")
    text = {
        0: "Differential: SIADH, hypovolemia from vomiting, hypothyroidism, adrenal insufficiency. What is her volume status?",
        1: "She looks euvolemic. Top two: SIADH vs adrenal insufficiency. I want urine osmolality, urine sodium, serum osm, TSH and cortisol.",
        2: "Hilar mass in a smoker with SIADH: small cell lung cancer. Paraneoplastic.",
    }
    outcomes = score_session(case, text, "SIADH from small cell lung cancer", "Hypertonic saline 100 mL bolus, no more than 8 mEq in 24h, then fluid restriction")
    got, mx = total(outcomes)
    assert got == mx, [o.item.id for o in outcomes if not o.hit]


def test_by_stage_deadline():
    case = get_case("siadh-sclc-01")
    # volume status must be mentioned by the history stage; mentioning it at labs is too late
    text = {0: "SIADH vs thiazide.", 2: "Now let me assess volume status."}
    outcomes = {o.item.id: o for o in score_session(case, text, "", "")}
    assert not outcomes["volume-status"].hit
    text = {0: "What is her volume status?"}
    outcomes = {o.item.id: o for o in score_session(case, text, "", "")}
    assert outcomes["volume-status"].hit and outcomes["volume-status"].stage_hit == 0


def test_final_fields_only():
    case = get_case("siadh-sclc-01")
    outcomes = {o.item.id: o for o in score_session(case, {0: "siadh hypertonic saline"}, "hyponatremia", "fluids")}
    assert not outcomes["names-siadh"].hit
    assert not outcomes["mgmt-severity"].hit
