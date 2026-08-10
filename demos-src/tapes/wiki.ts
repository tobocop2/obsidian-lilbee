/**
 * wiki demo: the corpus becomes a cited encyclopedia, and refreshing it shows
 * its work.
 *
 * Three beats, in order: browse the pages the corpus produced, open one and read
 * a claim back to the sentence it came from, then refresh the wiki and watch the
 * run report itself source by source in the Task Center.
 *
 * Recorded against a REMOTE server in external mode, which is the point of the
 * last beat. The plugin holds an SSE stream open across an SSH tunnel for the
 * length of a multi-minute GPU job and renders per-source progress from it. Until
 * recently the plugin read that response as a JSON body and the command threw
 * before doing anything (obsidian-lilbee#214), so this reel is also the thing
 * that would have caught that.
 *
 * Measured on the recording rig, so the speedups below are not guesses:
 *   Corpus      10 Wikipedia Solar System articles, ~18KB each
 *   Server      Llama-3.3-70B-Instruct Q4_K_M + Qwen3-Embedding-0.6B,
 *               one A100-80GB, reached over ssh -L 8080:127.0.0.1:<port>
 *   Build       59 subjects indexed, 45 pages published, 35 held as drafts
 *   Refresh     ~70s to finish the first of 10 sources, so a full pass is
 *               ~12 minutes. Far past a reel, hence REFRESH_SPEEDUP.
 *
 * The draft count is not hidden here and should not be: the faithfulness gate
 * held back 35 of 80 generated pages on this quant. That is the feature working.
 * A page only publishes when its claims tie back to the source.
 */
import { beat, clickSelector, command, key, sleep, storyboard, waitForSelector } from "../src/lib.ts";

const WIKI_CMD = "lilbee:wiki";
const REFRESH_CMD = "lilbee:wiki-update";

// One source of ten takes ~70s on this hardware. 24x lands a couple of source
// transitions inside the reel while the per-source line stays readable, which is
// the thing worth seeing: it names the file it is on and counts toward the total.
const REFRESH_SPEEDUP = 24;

// The page opened in beat 2. Chosen because its body cites a single source and
// cross-links two other pages, so one screen shows both halves of what the wiki
// layer produces: a claim tied to a sentence, and a graph between subjects.
const PAGE = ".lilbee-wiki-page-item:nth-of-type(1)";

export default storyboard("wiki", {
  window: [1400, 900],
  layout: "wiki-and-tasks",
  clearTaskCenter: true,
  // The wiki is prebuilt on the server: a build is a multi-minute GPU job and
  // is not something a reel can create on camera. The refresh beat is the live
  // work here.
  skipModelPin: true,
  caption: "A cited encyclopedia, built from your own documents.",
  // The article, not the refresh. The refresh is the proof; the cited page is
  // the thing being sold.
  moneyShotBeatIndex: 3,
  beats: [
    beat("Open the wiki", command(WIKI_CMD), {
      holdMs: 900,
      caption: "Every subject the corpus names, written up and cross-linked.",
    }),
    beat("Let the page list settle", waitForSelector(".lilbee-wiki-page-item"), { holdMs: 1400 }),

    beat("Open a page", clickSelector(PAGE), {
      holdMs: 800,
    }),
    beat("Read the article", waitForSelector(".lilbee-wiki-content"), {
      holdMs: 3800,
      caption: "Every claim carries a citation back to the sentence it came from.",
    }),

    beat("Refresh the wiki", command(REFRESH_CMD), {
      holdMs: 1200,
      caption: "Refreshing runs the chat model over every source.",
    }),
    beat("Follow the run", sleep(150_000), {
      holdMs: 1200,
      speedup: REFRESH_SPEEDUP,
      caption: "It reports each source as it goes, and stops when you ask it to.",
    }),
    beat("Stop it", clickSelector(".lilbee-task-cancel"), { holdMs: 2200 }),
    beat("Settle", key("Escape"), { holdMs: 900 }),
  ],
});
