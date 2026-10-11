# Anna's Attending

A phone-first clinical-reasoning coach for an internal medicine resident. A case is revealed
one clue at a time; the learner commits to a differential, gets challenged by an AI attending,
and ends with a rubric-scored debrief. Missed concepts come back as spaced-repetition questions.

Six attending personas (`backend/app/attendings.py`), from a gentle mentor to an adversarial
skeptic, each with a difficulty level that sets how much they help and how hard they push, a
caricature, and a neural voice with its own accent (Kokoro-82M, `scripts/tts_server.py`).

Case facts live in reviewed JSON files (`cases/`). The model coaches from them and never invents
the patient. Scoring is deterministic (`backend/app/scoring.py`); the model only writes feedback.

**Educational simulation with fictional patients. Not medical advice.**

## Layout

```
backend/   FastAPI + SQLite (app/main.py is the API contract)
frontend/  Next.js PWA
cases/     case library, one JSON per case (see cases/SCHEMA.md)
scripts/   serve_model.sh, run_api.sh, validate_cases.py, draft_case.py
deploy/    systemd units
```

## Run it

```bash
# 0. one-time
cp .env.example .env            # set ANNA_APP_PASSWORD, HF_TOKEN and (optionally) HF_HOME for the weights cache
scripts/check_medgemma.sh       # verifies the token can download MedGemma (accept terms on HF first)

MedGemma is loaded in fp32 on the V100 (Gemma 3 overflows fp16 to NaN logits); override with
`ANNA_LLM_DTYPE`. Other models default to fp16. `ANNA_LLM_MODEL` swaps the model, e.g. the
Qwen2.5-3B stand-in used during development.
conda activate anna             # python 3.11 env with fastapi (backend); anna-model env serves the model

# 1. model server (GPU 0, port 8001). Needs MedGemma terms accepted on Hugging Face.
scripts/serve_model.sh

# 2. voices: Kokoro TTS server (port 8002). Optional; the UI falls back to browser speech.
scripts/serve_tts.sh

# 3. backend (port 8000). Use ANNA_LLM_PROVIDER=mock to run without the model.
scripts/run_api.sh

# 4. frontend (port 3000)
cd frontend && npm install && npm run dev
```

Open http://localhost:3000 on a phone on the same network (or through Tailscale).

## Develop

```bash
cd backend && pytest                  # engine, scoring, spaced repetition
python scripts/validate_cases.py      # schema + regex check for every case
python scripts/draft_case.py --track general-im "topic"   # model-drafted case, marked unreviewed
```

Cases are marked `"reviewed": false` until a human has checked them. Review before relying on one.

## Live on GitHub Pages

The front end is published automatically by `.github/workflows/pages.yml` on every push to
`main` that touches `frontend/`, at **https://christindbose.github.io/Anna_app/**. GitHub only
hosts the static app; the AI attending (FastAPI + MedGemma + Kokoro) keeps running on the GPU box
and is reached over HTTPS through a tunnel.

To use it:

1. On the GPU box, make sure `ANNA_APP_PASSWORD` is set in `.env` (the API is about to be on the
   internet), then run `scripts/start_all.sh` and, in another shell, `scripts/tunnel.sh`. The
   tunnel prints an address like `https://<words>.trycloudflare.com`.
2. Open the Pages site on the phone. A "Server" sheet asks for that address and the password; both
   are remembered on the phone. The sheet is also under "Server settings" at the bottom of Home.
3. Add to Home Screen as usual.

Quick tunnels get a new address every time they start. For a permanent one, create a named tunnel
in a Cloudflare account (free) and set the repository variable `ANNA_API_BASE` to its URL so the
Pages build defaults to it, or use Tailscale Funnel.

The static build has no `/api` proxy, so the app calls the backend cross-origin; the Pages origin
is in the backend's CORS allow-list (`ANNA_CORS_ORIGINS` to add more). Session links use
`/case?id=...` rather than a dynamic route so the site can be exported statically.
