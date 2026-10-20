---
name: capstone-docs
description: Use when the task touches Smartalyze capstone paperwork or defense prep (documentation fixes, panel comments, diagrams, background/agenda alignment, RRL, feature-vs-document consistency checks). Not for app code changes.
---

# Capstone documentation work

Smartalyze is a DNSC BSIT capstone. Documentation is graded alongside the system, so consistency between the two matters.

## Sources of truth (read before answering)
- `docs/defense-3rd-year-minutes.md`: panel comments, two sets, System + Documentation. All 10 System items are implemented. Documentation items still open: LLM comparison (Groq vs Gemini vs Ollama), statistician validation, revised use case diagram, FR/NFR wording ("decision support" -> "AI insights"), revised DFD/CFD, improved RRL.
- `docs/capstone-issues.md`: tracker of differences between the manuscript (`SMARTALYZE_ AN AI-ASSISTED DATA VISUALIZATION AND ANALYSIS PLATFORM.pdf`) and the system, plus open panel items, with IDs (A = decisions, S = system, D = document). Check its status markers; they may be stale.
- `docs/background-agenda-alignment.md`: DNSC SAILS (I2/ICT4D), CHED A.C.H.I.E.V.E. (I and H enablers), DOST HNRDA (AI and Smart Cities). For Dean sign-off.
- Diagrams in `docs/*.drawio`: UseCase, DFD-Level1, CFD-Level0, ERD, SystemArchitecture, ConceptualFramework (+ `docs/Assignment/` views).
- `features.md` and `README.md` describe shipped features but can lag. Verify claims against code (`backend/app/routes`, `frontend/components/dataset`) before putting them in a document.

## Rules
- Do not edit app code from this skill. Only touch `docs/` (or other paperwork) when asked.
- Never state a feature exists in documentation without confirming it in code. Never invent citations; flag missing ones for the author to fill.
- Terminology: say "AI insights" (not "decision support"); the six workspace tabs are Overview, Prepare, Explore, Detect, Predict, Edit; the AI layer supports Ollama, Groq, Gemini.
- `.drawio` files are XML. Edit them as text only if asked, keep existing cell ids, and tell the author to reopen them in draw.io to check the layout.
- Writing for the panel/Dean: formal, plain, concise. Frame Smartalyze as a tool for non-technical users.
- Finish by listing which documents or diagrams a change affects so the author can update them.
