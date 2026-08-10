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
 * Measured on the recording rig, so the numbers below are not guesses:
 *   Corpus      10 Wikipedia Solar System articles, ~18KB each
 *   Wiki        the same one the wiki-lazy terminal reel browses, served as is
 *               rather than regenerated, so the pages on screen are the shipped
 *               ones: 54 published, 30 drafts, 59 subjects indexed
 *   Server      unsloth Llama-3.3-70B-Instruct UD-Q6_K_XL (the quant that wrote
 *               those pages) + Qwen3-Embedding-0.6B, one H100 80GB, reached over
 *               ssh -L 8080:127.0.0.1:<port>. External mode, genuinely remote.
 *   Refresh     Q6 spends minutes on a single source. The recorded take reached
 *               "1 of 10" and was still on it at 3:38, so a full pass runs well
 *               past an hour. Hence REFRESH_SPEEDUP, and hence a caption that
 *               claims only what one source can show.
 *
 * The 30 drafts are not a blemish to hide. A page publishes only when its claims
 * tie back to the source; the rest wait for review. That gate is the product.
 */
import { beat, clickSelector, command, key, sleep, storyboard, type_, waitForSelector } from "../src/lib.ts";

const WIKI_CMD = "lilbee:wiki";
const REFRESH_CMD = "lilbee:wiki-update";

// The refresh beat holds for 150s of real time. At 24x that compresses to a few
// seconds on screen while the per-source line stays readable, which is the thing
// worth seeing: it names the file it is on and counts toward the total.
const REFRESH_SPEEDUP = 24;

// Filtered to rather than picked by position. The first page alphabetically is
// Atmosphere, which is one of 5 pages out of 54 whose body still carries raw
// >[Chunk N] markers from generation. Opening it under a caption about every
// claim being cited would have put the counter-example on screen.
//
// Saturn is one of the 49 clean ones, and it is the better page regardless: it
// cites a source, quotes the supporting sentence, and cross-links four other
// subjects, so one screen shows both halves of the wiki layer.
const PAGE_QUERY = "saturn";

export default storyboard("wiki", {
  window: [1400, 900],
  layout: "wiki-and-tasks",
  clearTaskCenter: true,
  // Recorded in a vault pointed at a remote server, so it must not bind to
  // whichever managed-mode window happens to be open on the same CDP endpoint.
  vaultMatch: "fresh-verify",
  // The wiki is prebuilt on the server: a build is a multi-minute GPU job and
  // is not something a reel can create on camera. The refresh beat is the live
  // work here.
  skipModelPin: true,
  caption: "A cited encyclopedia, built from your own documents.",
  // The article, not the refresh. The refresh is the proof; the cited page is
  // the thing being sold.
  moneyShotBeatIndex: 5,
  beats: [
    beat("Open the wiki", command(WIKI_CMD), {
      holdMs: 900,
      caption: "Every subject the corpus names, written up and cross-linked.",
    }),
    beat("Let the page list settle", waitForSelector(".lilbee-wiki-page-item"), { holdMs: 1400 }),

    beat("Search for a subject", clickSelector(".lilbee-wiki-search"), { holdMs: 500 }),
    beat("Type the subject", type_(PAGE_QUERY), { holdMs: 900 }),
    beat("Open the page", clickSelector(".lilbee-wiki-page-item"), {
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
      // Deliberately not "reports each source as it goes". At Q6 a single
      // source takes minutes, so the clip only ever reaches the first one, and
      // a caption promising a parade of them would be describing footage that
      // is not on screen.
      caption: "It names the source it is on, and stops the moment you ask.",
    }),
    beat("Stop it", clickSelector(".lilbee-task-cancel"), { holdMs: 2200 }),
    beat("Settle", key("Escape"), { holdMs: 900 }),
  ],
});
