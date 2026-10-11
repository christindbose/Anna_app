#!/usr/bin/env python
"""Minimal OpenAI-compatible chat server over Hugging Face transformers.

Why not vLLM: the box has V100s (compute capability 7.0) and current vLLM/PyTorch CUDA 13 wheels
no longer ship Volta kernels. This serves MedGemma (or any chat model) with plain transformers on
PyTorch 2.7 + CUDA 12.6, which still supports sm_70. One request at a time; streams tokens.

Endpoints: POST /v1/chat/completions (stream or not), GET /v1/models, GET /health.
Image parts ({"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}) are
accepted for multimodal models (MedGemma 1.5) and ignored for text-only ones.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import threading
import time
import uuid

import torch
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image
from transformers import AutoConfig, AutoModelForCausalLM, AutoProcessor, AutoTokenizer, TextIteratorStreamer

ap = argparse.ArgumentParser()
ap.add_argument("--model", default="google/medgemma-1.5-4b-it")
ap.add_argument("--port", type=int, default=8001)
ap.add_argument("--host", default="127.0.0.1")
ap.add_argument("--dtype", default="float16")
ap.add_argument("--max-new-tokens", type=int, default=1024)
ap.add_argument("--repetition-penalty", type=float, default=1.0, help="HF repetition_penalty; ~1.1 curbs loops in long JSON drafts")
args = ap.parse_args()

DTYPE = getattr(torch, args.dtype)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"loading {args.model} as {args.dtype} on {DEVICE}", flush=True)

config = AutoConfig.from_pretrained(args.model)
MULTIMODAL = getattr(config, "model_type", "") in {"gemma3", "medgemma"} or hasattr(config, "vision_config")
if MULTIMODAL:
    from transformers import AutoModelForImageTextToText

    processor = AutoProcessor.from_pretrained(args.model)
    tokenizer = processor.tokenizer
    model = AutoModelForImageTextToText.from_pretrained(args.model, torch_dtype=DTYPE, device_map=DEVICE)
else:
    processor = None
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=DTYPE, device_map=DEVICE)
model.eval()
GEN_LOCK = threading.Lock()
# Gemma 3 / MedGemma 1.5 can open a hidden reasoning block with "<unused94>thought". That
# marker is not a special token, so it would be streamed to the user; forbid it at generation.
_THOUGHT_ID = tokenizer.convert_tokens_to_ids("<unused94>")
BAD_WORDS = [[_THOUGHT_ID]] if isinstance(_THOUGHT_ID, int) and _THOUGHT_ID != tokenizer.unk_token_id else None
print("model ready" + (" (thought token blocked)" if BAD_WORDS else ""), flush=True)

app = FastAPI()


def _decode_image(url: str) -> Image.Image:
    if url.startswith("data:"):
        b64 = url.split(",", 1)[1]
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
    raise ValueError("only data: image URLs are supported")


def _normalise(messages: list[dict]) -> tuple[list[dict], list[Image.Image]]:
    """OpenAI message format -> HF chat-template format (+ list of PIL images in order)."""
    out, images = [], []
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, str):
            out.append({"role": m["role"], "content": [{"type": "text", "text": content}] if MULTIMODAL else content})
            continue
        parts = []
        for p in content:
            if p.get("type") == "text":
                parts.append({"type": "text", "text": p["text"]})
            elif p.get("type") == "image_url" and MULTIMODAL:
                images.append(_decode_image(p["image_url"]["url"]))
                parts.append({"type": "image"})
        out.append({"role": m["role"], "content": parts if MULTIMODAL else " ".join(x["text"] for x in parts if x["type"] == "text")})
    return out, images


def _build_inputs(messages: list[dict]):
    msgs, images = _normalise(messages)
    if MULTIMODAL:
        inputs = processor.apply_chat_template(msgs, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt")
        if images:
            # re-run with images attached so pixel values are produced
            text = processor.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
            inputs = processor(text=text, images=images, return_tensors="pt")
    else:
        text = tokenizer.apply_chat_template(msgs, add_generation_prompt=True, tokenize=False)
        inputs = tokenizer(text, return_tensors="pt")
    return {k: v.to(model.device) for k, v in inputs.items()}


def _generate(messages, max_tokens, temperature, streamer=None):
    inputs = _build_inputs(messages)
    kwargs = dict(max_new_tokens=min(max_tokens, args.max_new_tokens), do_sample=temperature > 0, pad_token_id=tokenizer.eos_token_id)
    if BAD_WORDS:
        kwargs["bad_words_ids"] = BAD_WORDS
    if args.repetition_penalty != 1.0:
        kwargs["repetition_penalty"] = args.repetition_penalty
    if temperature > 0:
        kwargs["temperature"] = temperature
        kwargs["top_p"] = 0.95
    if streamer is not None:
        kwargs["streamer"] = streamer
    with GEN_LOCK, torch.inference_mode():
        out = model.generate(**inputs, **kwargs)
    n_prompt = inputs["input_ids"].shape[1]
    return tokenizer.decode(out[0][n_prompt:], skip_special_tokens=True), n_prompt, out.shape[1] - n_prompt


@app.get("/health")
def health():
    return {"ok": True, "model": args.model, "multimodal": MULTIMODAL}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": args.model, "object": "model"}]}


@app.post("/v1/chat/completions")
async def chat(body: dict):
    messages = body["messages"]
    max_tokens = int(body.get("max_tokens") or 512)
    temperature = float(body.get("temperature", 0.7))
    rid = f"chatcmpl-{uuid.uuid4().hex}"
    created = int(time.time())

    if not body.get("stream"):
        text, n_in, n_out = await asyncio.to_thread(_generate, messages, max_tokens, temperature)
        return JSONResponse(
            {
                "id": rid, "object": "chat.completion", "created": created, "model": args.model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": n_in, "completion_tokens": n_out, "total_tokens": n_in + n_out},
            }
        )

    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    worker = threading.Thread(target=_generate, args=(messages, max_tokens, temperature, streamer), daemon=True)
    worker.start()

    async def gen():
        def chunk(delta: dict, finish=None):
            return "data: " + json.dumps({"id": rid, "object": "chat.completion.chunk", "created": created, "model": args.model, "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}) + "\n\n"

        yield chunk({"role": "assistant", "content": ""})
        loop = asyncio.get_running_loop()
        it = iter(streamer)
        while True:
            piece = await loop.run_in_executor(None, next, it, None)
            if piece is None:
                break
            if piece:
                yield chunk({"content": piece})
        yield chunk({}, "stop")
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
