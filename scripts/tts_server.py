#!/usr/bin/env python
"""Kokoro text-to-speech server. POST /tts {text, voice, speed} -> audio/wav (24 kHz mono).

Kokoro-82M (Apache 2.0) with its American ('a') and British ('b') English pipelines. Indian-English
accent uses Kokoro's Hindi-trained voices (hf_*/hm_*) driven by the English G2P, which gives an
Indian-accented English rather than true en-IN training data.
"""
from __future__ import annotations

import argparse
import io
import re
import threading

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8002)
ap.add_argument("--host", default="127.0.0.1")
args = ap.parse_args()

from kokoro import KPipeline  # noqa: E402  (import after arg parsing so --help is fast)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
PIPES = {code: KPipeline(lang_code=code, device=DEVICE, repo_id="hexgrad/Kokoro-82M") for code in ("a", "b")}
LOCK = threading.Lock()
SR = 24000
print(f"kokoro ready on {DEVICE}", flush=True)

app = FastAPI()


def _lang_for(voice: str) -> str:
    # Kokoro voice ids: first letter is the language the voice was trained on (a/b/h/...).
    # British voices need the 'b' G2P; everything else is rendered with American G2P.
    return "b" if voice.startswith("b") else "a"


def _clean(text: str) -> str:
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


@app.get("/health")
def health():
    return {"ok": True, "device": DEVICE, "engine": "kokoro-82M"}


@app.post("/tts")
def tts(body: dict):
    text = _clean(str(body.get("text", "")))
    voice = str(body.get("voice", "af_heart"))
    speed = float(body.get("speed", 1.0))
    if not text:
        raise HTTPException(422, "empty text")
    if len(text) > 4000:
        raise HTTPException(413, "text too long")
    pipe = PIPES[_lang_for(voice)]
    chunks: list[np.ndarray] = []
    with LOCK, torch.inference_mode():
        for _, _, audio in pipe(text, voice=voice, speed=max(0.5, min(2.0, speed))):
            chunks.append(np.asarray(audio, dtype=np.float32))
    if not chunks:
        raise HTTPException(500, "no audio produced")
    wav = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, wav, SR, format="WAV", subtype="PCM_16")
    return Response(content=buf.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
