# Demo reel QA matrix

Every demo must pass all universal checks plus its demo-specific check
before it can be marked READY. Status is filled from the per-second
walkthrough frame audit of the final webm (not from intent).

Verdict key: PASS / FAIL / PENDING (not yet re-recorded this round).

## Universal checks (apply to every demo)

- **C1 cursor**: exactly one cursor, always visible, smooth Bezier motion. No teleport, no disappearing, no synthetic/OS overlap.
- **C2 status**: status bar reads as running — single icon, soft green, correct active model. (Exception: multi_vault ends released; first_start starts with no server.)
- **C3 workspace**: supporting demos show an actively-used vault (explorer + chat + tasks). Only first_start is a fresh install.
- **C4 no-errors**: no error frames ("unable to load", "No models installed", broken-logo fixation, empty/garbled answer).
- **C5 money shot**: the demo's payoff frame is present and held.

## Per-demo

| Demo | Specific check | C1 | C2 | C3 | C4 | C5 | Verdict |
|------|----------------|----|----|----|----|----|---------|
| tour | Trimmed superset: explorer, catalog flick + download confirm, add, cited chat, settings | — | — | — | — | — | PENDING |
| lilbee_on_lilbee | README-only cited answer; citation scrolls to the "Offline copies of websites" GIF | — | — | — | — | — | PENDING |
| add | **Task Center cleared before the add**; manual-only ingest; citation opens manual at cited page | — | — | — | — | — | PENDING |
| crawl | **Task Center cleared before the crawl**; **answer includes "1986"**; citation opens the 9C1 section | — | — | — | — | — | PENDING |
| catalog | **Rapid flick through each tab (Chat/Embed/Vision/Rerank)** showing many models / infinite scroll; then search | — | — | — | — | — | PENDING |
| download_model | Real pull of Llama 3.2 1B streams to completion in the Task Center; model becomes active | — | — | — | — | — | PENDING |
| command_palette | Three palette flows: settings, crawl, add (Task Center fills) | — | — | — | — | — | PENDING |
| settings | Full settings surface scrolled top to bottom through Advanced | — | — | — | — | — | PENDING |
| first_start | From-scratch install → wizard downloads models → **first chat with a cited answer** | — | — | — | — | — | PENDING |
| multi_vault | Active vault (Qwen3 8B, used) → switch via picker → released/stopped state | — | — | — | — | — | PENDING |
