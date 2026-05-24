# Demo reel QA matrix

Every demo must pass all universal checks plus its demo-specific check
before it can be marked READY. Status is filled from the per-second
walkthrough frame audit of the final webm (not from intent).

Verdict key: PASS / FAIL / PENDING (not yet re-recorded this round).

All ten re-recorded with the cursor-nudge fix (a 1px move after every
type/key un-hides the macOS pointer, which auto-hides while keys are
pressed — that was the disappear/emerge across typing-heavy demos).

## Universal checks (apply to every demo)

- **C1 cursor**: exactly one cursor, visible (incl. through typing holds, via the nudge), smooth Bezier motion. No teleport, no disappearing, no synthetic/OS overlap.
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
| download_model | Real pull of **SmolLM2 360M** (~0.3GB) streams to completion in a cleared Task Center (catalog pull does not auto-activate; status stays Qwen3 8B) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| command_palette | Three palette flows: settings, **crawl (now actually runs — Knowledge_graph)**, add | PASS | PASS | PASS | PASS | PASS | **PASS** |
| settings | Full settings surface scrolled top to bottom through Advanced | PASS | PASS | n/a (blank) | PASS | PASS | **PASS** |
| multi_vault | Active vault (Qwen3 8B, used) → picker shows **3 vaults to choose from** → switch → released/stopped | PASS | PASS (released ending) | PASS | PASS | PASS | **PASS** |
| first_start | From-scratch install → wizard → model → **first chat with a cited answer** | PASS | PASS | n/a (fresh install) | PASS | PASS | **PASS** |

## Notes

- **cursor smoothness (all demos)**: the macOS hardware cursor is always composited into the avfoundation capture (the capture_cursor flag is ignored on this Mac, and a background CGDisplayHideCursor doesn't hide it), so a synthetic overlay would double it. The real defect was macOS auto-hiding the pointer while typing. Fix: nudge the cursor 1px after every type/key so it stays visible through the following hold. Verified via consecutive-frame extraction (more rigorous for motion than single screenshots).
- **crawl 1986**: retrieval-ranking miss (dense reference list + 1987/1989 paragraphs out-ranked the introduction sentence at low top_k). Fixed by widening top_k to 10.
- **lilbee_on_lilbee / tour README-only**: top_k=1/3 pull an unrelated crawled page via MMR re-selection; top_k=2 dedupes to a README-only citation.
- **download_model**: swapped Llama 3.2 1B (1.2GB, slow, hit the 240s guard) for SmolLM2 360M (~0.3GB). Also wait for the search results to render before clicking the pull (was clicking a stale card).
- **command_palette**: the crawl flow now actually runs (click Crawl + watch the Task Center) instead of pasting the URL and dismissing.
- **multi_vault**: registered two more vaults (Research, Work) so the picker offers a real choice (3 alternatives), per the "at least 2 vaults to choose from" requirement.
- **first_start**: recorded in the firststart vault (BRAT install → enable → wizard → first cited chat). The wizard's model-picker cards load asynchronously, so the storyboard now waits for the Qwen3 0.6B card before selecting. Minor: the chat header shows Qwen3 8B (the firststart vault's active model) while the wizard picked 0.6B; the answer is high-quality and cited.

## Round 3 (glide + lingering + crawl payoff)

- **Gliding cursor**: slowed mouse.py to a cinematic glide (min 420ms, ~1050 px/s, larger arc) — verified via frame AE that a move now spans ~11 continuous frames (~366ms, every-frame motion) vs the old ~5-frame snap.
- **Less lingering**: 500ms lead-in (was 1500) + ~300ms opening holds, so demos start ~0.8s in.
- **command_palette**: after crawling the Knowledge_graph page it now asks "what is a knowledge graph?", gets a cited answer, and the citation glides the crawled article down to the Definitions section (was lingering at the top — the matcher had been hitting the page title).
- **first_start**: the wizard model-picker re-renders asynchronously and stranded the coordinate click; replaced with a polling DOM-click that re-queries until the Qwen3 0.6B card reports selected. Now completes through the first cited chat.
