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
| tour | Trimmed superset: explorer, catalog flick + download confirm, add, cited chat, settings | PASS | PASS | PASS | PASS | PASS | **PASS** |
| lilbee_on_lilbee | README-only cited answer; citation scrolls to the "Offline copies of websites" GIF | PASS | PASS | PASS | PASS | PASS | **PASS** |
| add | **Task Center cleared before the add**; manual-only ingest; citation opens manual at cited page | PASS | PASS | PASS | PASS | PASS | **PASS** |
| crawl | **Task Center cleared before the crawl**; **answer includes "1986"**; citation opens the 9C1 section | PASS | PASS | PASS | PASS | PASS | **PASS** |
| catalog | **Rapid flick through each tab (Chat/Embed/Vision/Rerank)** showing many models / infinite scroll; then search | PASS | PASS | PASS | PASS | PASS | **PASS** |
| download_model | Real pull of Llama 3.2 1B streams to completion in the Task Center (catalog pull does not auto-activate; status stays Qwen3 8B) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| command_palette | Three palette flows: settings, crawl, add (Task Center fills) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| settings | Full settings surface scrolled top to bottom through Advanced | PASS | PASS | n/a (blank) | PASS | PASS | **PASS** |
| multi_vault | Active vault (Qwen3 8B, used) → switch via picker → released/stopped state | PASS | PASS (released ending) | PASS | PASS | PASS | **PASS** |
| first_start | From-scratch install → wizard downloads models → **first chat with a cited answer** | — | — | — | — | — | PENDING (needs firststart vault open + reset) |

## Notes

- **crawl 1986**: was a retrieval-ranking miss (the dense reference list + 1987/1989 paragraphs outranked the actual introduction sentence at low top_k). Fixed by widening top_k to 10; answer now states "introduced ... for 1986" and quotes the source.
- **lilbee_on_lilbee / tour README-only**: top_k=1 and top_k=3 pull an unrelated crawled page via MMR re-selection; top_k=2 dedupes to a README-only citation. Set both demos to top_k=2.
- **download_model**: first take hit the harness's 240s runJs guard (1.2GB download is slower than that). Added a per-beat `maxMs` override so a legitimately-progressing download isn't aborted.
- **first_start**: still the older recording. Recreating it needs Obsidian switched to the firststart vault AND that vault reset (lilbee uninstalled / models removed / setup cleared) so the install + model-download arc is authentic. Deferred to a supervised run to avoid corrupting that vault unattended.
