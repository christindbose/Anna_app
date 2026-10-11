# Case file schema

Each case is one JSON file under `cases/<track>/`. Case facts are the ground truth:
the model coaches from them and never invents findings.

```jsonc
{
  "id": "siadh-sclc-01",               // unique, kebab-case, stable
  "title": "Confusion and a sodium of 118",
  "track": "general-im",               // general-im | rheum
  "difficulty": 2,                     // 1 (intern) .. 4 (senior resident)
  "tags": ["electrolytes", "oncology"],
  "reviewed": false,                   // true only after a human has checked it
  "presentation": "62F brought in by her daughter ...",   // what the learner sees first
  "stages": [                          // revealed one at a time, in order
    {
      "id": "history",
      "label": "History",              // shown as the card title
      "text": "She smokes ...",        // the reveal
      "prompt": "What is your differential and what do you want to know next?",
      "learner_goal": "Build a broad differential for hyponatremia with confusion"
    },
    {
      "id": "exam",
      "label": "Exam",
      "text": "...",
      "prompt": "Does this change your differential? Commit to your top two.",
      "available_tests": {             // optional: learner can ask for these by name
        "urine osm": "Urine osmolality 450 mOsm/kg",
        "urine sodium": "Urine sodium 60 mEq/L"
      }
    }
  ],
  "diagnosis": "SIADH secondary to small cell lung cancer",
  "diagnosis_aliases": ["siadh", "inappropriate adh", "inappropriate antidiuretic"],
  "key_clues": ["euvolemic on exam", "urine osm > 100 despite serum hypo-osmolality", "40 pack-year smoker"],
  "distractors": [                     // reasonable alternatives and why they fall away
    {"name": "Thiazide-induced hyponatremia", "why_not": "No thiazide on med list"},
    {"name": "Hypothyroidism", "why_not": "TSH normal"}
  ],
  "rubric": [
    {
      "id": "names-siadh",
      "description": "Names SIADH in the differential",
      "category": "diagnosis",         // diagnosis | workup | reasoning | management
      "weight": 3,
      "match": ["siadh", "inappropriate adh"],   // case-insensitive regex, any match counts
      "source": "any",                 // any | final_diagnosis | final_management
      "by_stage": "labs",              // optional: must appear by the end of this stage
      "concept": "SIADH criteria"      // used to build spaced-repetition follow-ups
    }
  ],
  "management_summary": "Fluid restriction, treat the cause; hypertonic saline only if severe symptoms ...",
  "teaching_points": ["...", "..."],
  "references": ["Harrison's 21e, ch. 53", "Verbalis JG et al. Am J Med 2013"]
}
```

Rules for authors:
- Every finding the attending might cite must be in `presentation`, a stage `text`, or `available_tests`.
- `rubric.match` entries are regexes; keep them lenient (`"urine (osm|osmolality)"`).
- Include at least one rubric item per category.
- Keep the whole case under ~900 words so it fits comfortably in the model context.
