# পাঠশালা — Pathshala Exam Engine

A Bangladesh govt-exam (BCS/Bank/NTRCA/Primary) MCQ practice platform.
**Rust core** for speed, a lightweight vanilla-JS frontend, and Python only for
offline data preparation.

## Architecture

```
Rust (Axum + rusqlite)   →  JSON API + static files  →  Vanilla ESM + Tailwind CDN + PWA
        │
        ├── SQLite: pathshala-app/data/pathshala.db (56,397 active questions, FTS5)
        └── SQLite: pathshala-app/data/flagged_mcqs.db (quarantine + flagged snapshots)
```

Design decisions follow `../REA_REPORT.md`:
- **Rust first**: Axum async server, pooled SQLite connections (WAL, 64 MB cache),
  compiled with `lto = true, codegen-units = 1, panic = abort, strip = true`.
- **No jQuery / no framework bloat** — one compiled CSS file + vanilla ESM.
- **Bengali-first** typography (Noto Sans Bengali), system-aware dual theme.
- **Accessible**: skip link, visible focus rings, keyboard exam nav (1–4, ←/→),
  `aria`-friendly structure. No anti-inspect / anti-copy scripts.
- **Offline-first**: service worker caches the shell; exam answers are written
  locally and queued to the API.
- **SM-2 spaced repetition** for review; topic heatmap from the real corpus for
  predictions (no fabricated "leaked" questions).
- Answers are **never** returned by list endpoints; only after login on the
  single-question reveal route, and in exam results after submission.

## Build & run

```bash
# 1. prepare an app-specific copy of the DB (FTS5 + app tables)
python3 ../scripts/prepare_app_db.py

# 2. build release binary
cargo build --release

# 3. run
PORT=8080 ./target/release/pathshala
# open http://localhost:8080/
```

Database files are runtime data and are intentionally excluded from Git. The app
needs a prepared `data/pathshala.db` containing the question corpus and FTS index;
in the full Pathshala workspace, create it with `../scripts/prepare_app_db.py`.
For a standalone deployment, provision that prepared database separately before
starting the server. The app creates and manages `data/flagged_mcqs.db` at runtime.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | health + question count |
| GET | `/api/stats` | corpus stats |
| GET | `/api/subjects` | subjects with counts |
| GET | `/api/topics?subject_id=` | topics |
| GET | `/api/questions?subject_id&topic_id&q&limit&offset` | question bank (no answers) |
| GET | `/api/questions/{id}?token=` | single question **with answer** (login required) |
| GET | `/api/questions/random?subject_id&topic_id&n` | random practice set |
| POST | `/api/auth/login` | phone → token (no password) |
| POST | `/api/exams/start` | create exam, return questions |
| POST | `/api/exams/{id}/answer` | record an answer |
| POST | `/api/exams/{id}/submit` | score, negative marking, explanations |
| GET | `/api/exams/{id}/result` | saved result |
| GET | `/api/exams` | exam history |
| POST | `/api/review/grade` | SM-2 grade (0–5) |
| GET | `/api/review/due` | due review cards |
| GET | `/api/predict` | topic-frequency heatmap |
| GET | `/api/flagged?status=open&limit=40&offset=0&q=` | flagged and quarantined MCQs |
| POST | `/api/flagged` | copy an MCQ into the flagged queue |
| PUT | `/api/flagged/{id}` | save a corrected flagged copy |
| POST | `/api/flagged/{id}/resolve` | mark an item fixed |
| POST | `/api/flagged/{id}/reopen` | return a fixed item to the queue |

Auth: send `Authorization: Bearer <token>` or `?token=<token>`.

## Features
- **`/` is the app** — no separate marketing/landing page
- **Hind Shiliguri** default font (Bengali-first typography), light/dark theme
- **Animated loader** on startup and while generating exams
- **About** section explaining data verification, scoring, SM-2 review and tech stack
- **Topic deep-links**: `/?topic=ID` or `/?subject=ID` opens a quiz on that topic directly
- **Random MCQ** section: 10/20/50 questions, per-subject filter, quick cards
- **BCS Blueprint mock**: 100 questions distributed by the real 10-subject BPSC weights (7.5/7.5/17.5/17.5/15/10/7.5/7.5/5/5 %)
- **Question of the Day** (deterministic per date) on dashboard + challenge page
- **Bookmarks**, **SM-2 review queue**, **per-subject accuracy analytics**
- **Flagged MCQs** queue seeded from quarantine; corrections stay isolated until promoted
- **KaTeX** rendering for `$…$` math in prompts/options
- Guest access everywhere; login optional (kept for cross-device history)

## Exam rules
- Correct = **+1**, wrong = **−negative** (configurable, default 0.5), skip = **0**.
- Modes: `practice` (instant feedback), `model` (result on submit), `section`.
- Timer auto-submits at zero.

## Notes
- This app reads the repaired DB from the parent project; it does not mutate the
  question corpus. App activity writes `app_*` tables (users, sessions, exams,
  answers, reviews, events); flagged MCQ snapshots and edits live in
  `flagged_mcqs.db`.
- The PWA manifest and browser favicon use the Pathshala aubergine logo.
