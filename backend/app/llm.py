"""LLM client behind one small interface so the backend (vLLM/MedGemma, Claude, mock) can be swapped."""
from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Protocol

from .config import settings

Message = dict[str, str]


class LLM(Protocol):
    async def chat(self, messages: list[Message], *, max_tokens: int | None = None, temperature: float | None = None) -> str: ...
    def stream(self, messages: list[Message], *, max_tokens: int | None = None, temperature: float | None = None) -> AsyncIterator[str]: ...


class OpenAICompatible:
    def __init__(self) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
        self.model = settings.llm_model

    async def chat(self, messages, *, max_tokens=None, temperature=None) -> str:
        r = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens or settings.llm_max_tokens,
            temperature=settings.llm_temperature if temperature is None else temperature,
        )
        return (r.choices[0].message.content or "").strip()

    async def stream(self, messages, *, max_tokens=None, temperature=None):
        r = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens or settings.llm_max_tokens,
            temperature=settings.llm_temperature if temperature is None else temperature,
            stream=True,
        )
        async for chunk in r:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta


class Mock:
    """Deterministic stand-in so the UI can be developed without a GPU."""

    async def chat(self, messages, *, max_tokens=None, temperature=None) -> str:
        last = messages[-1]["content"]
        if '"question"' in messages[0]["content"]:
            return json.dumps({"question": "A 70-year-old on a new thiazide presents with Na 124. What single urine study best separates the main causes, and what result would you expect?", "answer": "Urine sodium and osmolality; a high urine Na with inappropriately concentrated urine suggests SIADH or diuretic effect."})
        if "Write the debrief now" in last or "HOW TO WRITE IT" in messages[0]["content"]:
            return "You worked through a case of SIADH and reached the diagnosis. The urine studies were the pivotal clue, and you ordered them at the right moment. Where the reasoning drifted was volume status: you committed to a differential before stating whether the patient looked euvolemic, which is the branch point for every hyponatremia algorithm. Teaching points: always state volume status before the differential, urine osmolality above 100 rules out appropriate ADH suppression, and a smoker with new SIADH needs chest imaging. Read the hyponatremia chapter in Harrison's."
        return "Good start. You have listed three possibilities, but you have not told me what this patient's volume status is, and that is the branch point for the whole hyponatremia algorithm. Before we go further, what would you look for at the bedside to decide, and which of your three does each finding support?"

    async def stream(self, messages, *, max_tokens=None, temperature=None):
        text = await self.chat(messages)
        for word in re.split(r"(\s+)", text):
            if word:
                yield word


def get_llm() -> LLM:
    if settings.llm_provider == "mock":
        return Mock()
    return OpenAICompatible()


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model reply, tolerating code fences."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object in model reply")
    # Parse the first complete object and ignore anything the model appended after it.
    try:
        obj, _ = json.JSONDecoder(strict=False).raw_decode(text[start:])  # strict=False: allow raw newlines in strings
        return obj
    except json.JSONDecodeError:
        end = text.rfind("}")
        if end == -1:
            raise
        return json.loads(text[start : end + 1], strict=False)
