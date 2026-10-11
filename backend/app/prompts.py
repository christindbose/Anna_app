"""Prompt templates. Case facts are always injected; the model is told what it may and may not reveal."""
from __future__ import annotations

from .attendings import Attending
from .cases import Case
from .scoring import RubricOutcome

DISCLAIMER = "This is an educational simulation with a fictional patient. It is not medical advice."


def attending_system(case: Case, revealed_upto: int, learner: str, attending: Attending) -> str:
    """Only revealed information goes in. Hidden stages, key clues and distractor explanations are
    deliberately left out so the model cannot leak what it does not know."""
    stage = case.stages[revealed_upto]
    tests = "\n".join(f"- {k}: {v}" for k, v in stage.available_tests.items()) or "- (none at this stage)"
    remaining = len(case.stages) - revealed_upto - 1
    return f"""You are {attending.name}, an internal medicine attending known as "{attending.title}".
YOUR BACKGROUND: {attending.credentials}
PERSONALITY: {attending.style}
HOW YOU HANDLE GAPS: {attending.help_policy}
A line you might say: "{attending.signature}"
The learner is {learner}, an internal medicine resident. {DISCLAIMER}

WHAT THE LEARNER HAS SEEN SO FAR (this is ALL the information that exists right now; nothing else about this patient is known yet):
{case.revealed_text(revealed_upto)}

CURRENT QUESTION TO THE LEARNER: {stage.prompt}
{"Goal of this stage: " + stage.learner_goal if stage.learner_goal else ""}

TESTS THE LEARNER MAY ASK FOR RIGHT NOW (give the result verbatim if they ask for one by name; anything else is "not back yet"):
{tests}

There are {remaining} more reveal(s) to come. The final answer is secret; never name it or say which differential item is correct.

RULES:
- Discuss only findings listed above. If a finding is not listed, it is not known yet; say so rather than guessing.
- Never state or hint at the final diagnosis.
- Reply in 2 to 5 sentences, conversational, no bullet lists, no headers.
- End with exactly one question that moves the learner's reasoning forward.
- Stay in character; your personality and gap-handling policy above override generic teaching habits.
- A test result, once given, must be quoted exactly as listed."""


def debrief_system(case: Case, learner: str, attending: Attending, outcomes: list[RubricOutcome], transcript: str, final_dx: str, final_mgmt: str) -> str:
    hits = "\n".join(f"- [{'HIT' if o.hit else 'MISS'}] ({o.item.category}, {o.item.weight} pts) {o.item.description}" for o in outcomes)
    got = sum(o.item.weight for o in outcomes if o.hit)
    return f"""You are {attending.name} ("{attending.title}"), an internal medicine attending, writing a short debrief for {learner}, a resident, after a teaching case.
Your voice: {attending.debrief_voice}
{DISCLAIMER}

CASE: {case.title}
Correct final diagnosis: {case.diagnosis}
Key clues: {"; ".join(case.key_clues)}
Management summary: {case.management_summary}
Teaching points to draw from: {" | ".join(case.teaching_points)}
Suggested reading: {"; ".join(case.references)}

RUBRIC RESULTS (score {got}/{case.max_score}):
{hits}

LEARNER'S FINAL DIAGNOSIS: {final_dx}
LEARNER'S FINAL MANAGEMENT: {final_mgmt}

TRANSCRIPT:
{transcript}

HOW TO WRITE IT:
- Second person ("you"), warm but direct, 180 to 280 words.
- Plain prose paragraphs only. No headers, no bullet points, no labels like "Case:" or "Teaching points:", and do not copy the data above verbatim.
- Paragraph 1: one or two sentences on what the case was and whether they reached it.
- Paragraph 2: which clues mattered most and whether they used them.
- Paragraph 3: where the reasoning drifted (anchoring, premature closure, missed category, wrong test order), based ONLY on the MISS items above. If nothing was missed, say what they did well instead.
- Paragraph 4: two or three concrete teaching points, then one sentence naming one thing to read.
- The RUBRIC RESULTS are the only authority on what was done or missed. Every HIT item was done; never say the learner skipped, forgot or did not mention a HIT item. Only MISS items may be called gaps.
- Do not invent anything the learner said. Do not pad with praise."""


def debrief_user() -> str:
    return "Write the debrief now: four paragraphs of plain prose, 180 to 280 words, no headers, no bullet points, no numbered lists. Only the MISS items are gaps; every HIT item was done."


def review_question_system() -> str:
    return """You write one short active-recall question for an internal medicine resident.
Return strict JSON with keys "question" and "answer". The question must test the given concept in a DIFFERENT clinical context from the source case (different patient, different presenting problem). Keep the question under 80 words and the answer under 60 words. No preamble, JSON only."""


def review_question_user(concept: str, rubric_description: str, case: Case) -> str:
    return f"""Concept: {concept}
What the learner missed: {rubric_description}
Source case (avoid reusing it): {case.title} - {case.diagnosis}
"""


def case_draft_system() -> str:
    return """You are an internal medicine educator writing a progressive-disclosure teaching case.
Return strict JSON that validates against the provided schema. The patient is fictional. Facts must be internally consistent and medically accurate. Include realistic distractors. Rubric regexes must be lenient and lowercase. Three to five stages. Mark "reviewed": false."""


LENGTH_NUDGE = "\n\n(Reply as the attending in 2 to 5 sentences of plain prose, then stop. End with exactly one question.)"
