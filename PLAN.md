# Anna's Attending — Project Plan

A clinical-reasoning coach for an internal medicine resident, powered by MedGemma,
built as a personal gift that is also portfolio-grade.

## Assumptions (change these and the plan changes)

| Question | Assumed answer | Why |
| --- | --- | --- |
| Main goal | Personal app for Anna, polished enough to show colleagues | Keeps scope tight and avoids HIPAA/product concerns |
| Focus | General internal medicine, with a rheumatology case track | Matches residency; a specialty track is an easy personal touch |
| Time | 3–4 weeks of evenings/weekends | Enough for a real case library and progress tracking |
| Compute | Self-hosted on this box (4× V100 32GB) | Free, private, no API cost; MedGemma 4B fits in fp16 on one GPU |

## What we're building

**Core: the AI attending.** A case is revealed one clue at a time. Anna commits to a
differential, says what test she wants next and why, and gets challenged like she would
by a senior attending. At the end she gets a debrief: which clues mattered most, where
her reasoning drifted, and what to read.

**Phase 2: weak-spot recall.** Every missed concept becomes a short follow-up question
in a different clinical context, scheduled with spaced repetition. This reuses the same
case engine and model, so it is cheap to add.

**Stretch: radiology detective.** MedGemma 1.5 4B is multimodal, so a chest X-ray
module ("find the findings before the report is revealed") is a natural extension once
the core loop works.

Not building: chart-prep copilot (needs real patient data) and evidence investigator
(needs a literature retrieval system). Both can come later if Anna wants a research
angle.

## Design principles

1. **Case facts are fixed, the model is the tutor.** Each case is a hand-reviewed JSON
   file: staged reveals, the true diagnosis, key discriminating clues, a scoring rubric,
   and references. MedGemma reads the case and coaches; it never invents the patient.
2. **Deterministic scoring, model-written feedback.** Rubric hits (did she name the
   diagnosis, did she order the discriminating test, did she anchor early) are computed
   in code. The model turns that into natural attending-style feedback.
3. **Education only, no real patients.** Hard-coded disclaimer, no PHI anywhere, no
   file uploads of clinical documents in v1.
4. **Phone-first.** She will use it on call or on the train. PWA, big tap targets,
   works one-handed.

## Architecture

```
┌──────────────┐    HTTPS     ┌──────────────┐   HTTP   ┌───────────────────┐
│ Next.js PWA  │ ───────────► │ FastAPI      │ ───────► │ model server (own) │
│ (phone/web)  │ ◄─────────── │ case engine  │ ◄─────── │ MedGemma 1.5 4B-it │
└──────────────┘              │ + SQLite     │          │ transformers, 1×V100│
                              └──────────────┘          └───────────────────┘
                                     │
                              cases/*.json  (reviewed case library)
```

- **Model:** `google/medgemma-1.5-4b-it` served by `scripts/model_server.py`, a small
  OpenAI-compatible server over Hugging Face transformers (PyTorch 2.7 + CUDA 12.6 in the
  `anna-model` conda env). Multimodal, fits comfortably on one V100 in fp16.
  - Why not vLLM: tried it. Current vLLM / PyTorch CUDA 13 wheels dropped Volta (sm_70)
    kernels, so it fails on this box with "no kernel image is available". Revisit if the
    app moves to Ampere or newer GPUs; the backend only needs an OpenAI-style endpoint.
  - V100 caveat: no native bf16, and Gemma 3 activations overflow fp16 (NaN logits, CUDA assert
    in sampling), so Gemma-family models are loaded in fp32 (~17 GB; `serve_model.sh` picks this).
  - MedGemma 1.5 may open a hidden reasoning block with `<unused94>thought`; the server forbids
    that token at generation time.
  - Gated weights: accept the Health AI Developer Foundations terms on Hugging Face.
- **Backend:** Python 3.11 (conda env), FastAPI, SQLite via SQLModel. Owns case state,
  reveal order, rubric scoring, spaced-repetition schedule, and prompt assembly.
- **Frontend:** Next.js + Tailwind, PWA manifest. Three screens: case player,
  debrief, progress dashboard.
- **Access:** app runs on this box; expose with Tailscale or Cloudflare Tunnel so Anna
  can reach it from her phone. Single shared password is enough for v1.
- **Fallback:** keep the LLM client behind one interface so the Claude API can be
  swapped in if MedGemma quality or latency disappoints.

## Case format (sketch)

```json
{
  "id": "hyponatremia-siadh-01",
  "track": "general-im",
  "difficulty": 2,
  "presentation": "62F, confusion x2 days, Na 118 ...",
  "stages": [
    {"reveal": "history", "text": "...", "prompt": "Initial differential?"},
    {"reveal": "exam", "text": "..."},
    {"reveal": "labs", "text": "...", "prompt": "What test distinguishes your top 2?"},
    {"reveal": "result", "text": "Urine osm 450, urine Na 60"}
  ],
  "diagnosis": "SIADH secondary to small cell lung cancer",
  "key_clues": ["euvolemic", "urine osm > 100", "smoking history"],
  "distractors": ["thiazide use", "hypothyroidism"],
  "rubric": [
    {"id": "names-siadh", "weight": 3, "match": ["SIADH", "inappropriate ADH"]},
    {"id": "orders-urine-studies", "weight": 2, "match": ["urine osm", "urine sodium"]}
  ],
  "teaching_points": ["...", "..."],
  "references": ["Harrison's 21e ch. 53"]
}
```

Cases are drafted with MedGemma from a topic list, then reviewed by hand (ideally with
Anna as the silent reviewer for a few, or a resident friend). Target 30 cases at launch:
20 general IM, 10 rheumatology.

## Timeline

### Week 0 (first evening): environment
- [x] Conda envs: `anna` (backend) and `anna-model` (PyTorch 2.7 cu126 + transformers); Node 20 via nvm.
- [x] Accept MedGemma terms on Hugging Face, download `medgemma-1.5-4b-it` (2026-10-11; weights cached under /scratch via HF_HOME in `.env`).
- [x] Serve it with `scripts/serve_model.sh` (fp32 on a V100; fp16 overflows to NaN logits). Text prompts verified end to end; image prompt not yet tried.
- [x] Repo scaffold: `backend/`, `frontend/`, `cases/`, `scripts/`.

### Week 1: one case, end to end
- [x] Case JSON schema + loader, 3 hand-written cases.
- [x] FastAPI: start case, submit answer, next stage, debrief.
- [x] Prompt templates: attending challenge, debrief, "why was this clue important".
- [x] Minimal Next.js case player (chat-style, with reveal cards).
- [x] Rubric scoring in code, feedback written by the model from the rubric result.

### Week 2: library and coaching depth
- [x] Script to draft cases from a topic list, with a review checklist.
- [~] Case library is drafted by MedGemma itself (`scripts/draft_library.py`: draft pass + self-review pass, deterministic schema normalisation). 3 cases live (AKI/obstruction, pericarditis, GCA), all `reviewed: false`; the 10 hand-written cases were retired on 2026-10-11 at the user's request.
- [x] "Senior attending" mode: pushes back on the differential, asks for defense.
- [x] Progress dashboard: cases done, rubric items missed, topic heatmap.
- [x] SQLite persistence, single-user auth.

### Week 3: recall loop and polish
- [x] Weak-spot follow-ups: generate a short question on each missed concept, scheduled
      with SM-2 spaced repetition.
- [x] PWA manifest and mobile layout. Offline shell not done.
- [x] systemd units for model server + API + frontend. Front end on GitHub Pages via Actions (2026-10-11); `scripts/tunnel.sh` exposes the API (user runs it).
- [ ] Personal touches: a welcome screen, her name, a case track for things she has
      mentioned struggling with.

### Week 4 (optional): radiology detective
- [ ] CXR teaching set (public: NIH ChestX-ray14 or MIMIC-CXR demo images).
- [ ] "Spot the findings" flow using MedGemma image understanding.
- [ ] Pattern-miss tracking feeding the same spaced-repetition queue.

## Risks

| Risk | Mitigation |
| --- | --- |
| MedGemma 4B reasoning is too shallow for attending-style pushback | Try 27B on 2 GPUs; or route only the "challenge" step to the Claude API |
| Model contradicts the case facts | Case facts injected as ground truth in every prompt; debrief compares against JSON, not model memory |
| Cases contain medical errors | Human review checklist; references required per case; mark unreviewed cases as drafts |
| V100 latency on long prompts | Keep case context under ~2k tokens; stream responses |
| Box is shared/rebooted | systemd services, model cached on local disk |
| V100s are old (Volta) | Pinned PyTorch 2.7 cu126; no vLLM, no FlashAttention; plain transformers generate |

## Decisions to confirm

1. Goal and audience: personal gift vs. portfolio vs. something bigger.
2. Specialty track: rheumatology assumed as the second track; swap if wrong.
3. Hosting: self-host here (assumed) vs. a cloud GPU vs. API-only.
4. Should Anna know about it during the build (she could review cases) or is it a
   surprise?

## Status log

- 2026-10-10: Weeks 0-2 scope built and verified end to end on this box with a stand-in
  model (Qwen2.5-3B-Instruct) because MedGemma weights are gated and no HF token was
  available. vLLM abandoned for V100 reasons (see Architecture). 13 draft cases, all
  need a medical review pass. Nothing committed to git yet.
- 2026-10-11: MedGemma 1.5 4B live. Token stored in `.env`, weights on /scratch (HF_HOME). Loaded in
  fp32 after fp16 produced NaN logits. First runs showed a leaked `<unused94>thought` block and
  replies running into the token cap, fixed by forbidding the token, capping attending turns at
  260 tokens with sentence-boundary trimming, and restating length rules in the last user message.
  Debrief prompt now treats rubric HITs as authoritative after a debrief claimed a missed test the
  learner had ordered. Pericarditis 19/20, TTP 22/22 on the real model.
- 2026-10-11: Front end made static-exportable (`STATIC_EXPORT=1`, `/case?id=` instead of a dynamic
  route, configurable server address stored on the phone) and deployed to GitHub Pages by
  `.github/workflows/pages.yml` after the repo went public. Backend stays on the GPU box behind a
  Cloudflare quick tunnel started by the user; app password set in `.env`.
- 2026-10-11: Library regenerated from MedGemma on the user's request ("all cases from MedGemma knowledge", "only 3 for now"). Drafting needed: repetition penalty 1.1, compact JSON, 6000-token budget, and a normaliser for schema slips. Known MedGemma errors to review: pericarditis colchicine duration (says 3 days; guideline is 3 months), aspirin dose, an invented reference or two.
- 2026-10-11 (later): Library regenerated as 10 advanced (d3-d4) MedGemma cases, one per subspecialty (cardio, nephro, pulm, gi, heme, onc, id, endo, rheum, neuro) from `cases/TOPICS.json`; app has a subspecialty chip picker; iOS layout hardening. Drafter gained topic/diagnosis fidelity checks after MedGemma substituted related diseases (ANCA for anti-GBM, meningitis for HSV, myeloma for PTHrP). Still unreviewed: known slips include HLH treatment (hydroxychloroquine/HSCT), OHS (intubation then Venturi mask), zoledronic acid 'daily', prednisone 'µg/kg'.
