# Anna's Attending

A phone-first clinical-reasoning coach for an internal medicine resident. A case is revealed
one clue at a time; the learner commits to a differential, gets challenged by an AI attending,
and ends with a rubric-scored debrief. Missed concepts come back as spaced-repetition questions.

Six attending personas (`backend/app/attendings.py`), from a gentle mentor to an adversarial
skeptic, each with a difficulty level that sets how much they help and how hard they push.

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
cp .env.example .env            # set ANNA_APP_PASSWORD and HF_TOKEN
conda activate anna             # python 3.11 env with fastapi (backend); anna-model env serves the model

# 1. model server (GPU 0, port 8001). Needs MedGemma terms accepted on Hugging Face.
scripts/serve_model.sh

# 2. backend (port 8000). Use ANNA_LLM_PROVIDER=mock to run without the model.
scripts/run_api.sh

# 3. frontend (port 3000)
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
