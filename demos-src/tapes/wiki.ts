/**
 * wiki demo: ten documents become an encyclopedia that lives in your vault.
 *
 * The arc is index -> browse it natively -> find a gap -> fill it. The middle
 * act is the point: an earlier cut showed only the plugin's own wiki pane, and
 * the honest reaction to it was "I thought these would be real notes I could
 * click through like Wikipedia". They are, so the reel shows that rather than
 * describing it. The plugin pane still opens and closes the story, because the
 * index and the write are things the vault cannot do by itself.
 *
 * Recorded against a REMOTE server in external mode over an SSH tunnel. Three
 * beats depend on that being real rather than staged:
 *   - the wiki notes are the server's pages synced into the vault, so their
 *     [[links]] resolve through Obsidian's own metadata cache
 *   - the "not written yet" beat lists subjects the corpus names that nothing
 *     has written, which the server computes from NER with no model call
 *   - the write beat generates one of them, live, on the GPU
 *
 * Measured on the recording rig, so the timings below are not guesses:
 *   Corpus    10 Wikipedia Solar System articles, ~18KB each
 *   Wiki      served exactly as shipped: 54 pages written, 6 subjects the
 *             corpus names that nothing has written. Nothing is removed or
 *             seeded for the camera; the server reports those 6 from its own
 *             index. Synced to the vault as 4 concept and 50 entity notes,
 *             where 112 links resolve inside the wiki and none leak out of it.
 *   Server    unsloth Llama-3.3-70B-Instruct UD-Q6_K_XL, the quant that wrote
 *             those pages, split across three RTX 3090s (72GB) rather than a
 *             datacentre card. That is the point of the GPU pane: a 70B on
 *             hardware someone actually owns. Two cards would have fit only a
 *             Q4, and mixing quants would have shown one page written to a
 *             different standard than the 54 around it.
 *   Write     one page is one model call, measured at 34s on this rig. Three
 *             3090s split the weights roughly 21.6/21.5/20.8 GB, which is what
 *             the GPU pane shows while it works.
 *
 * PAGE and STUB are both real. Nothing here is seeded for the camera: if the
 * chosen stub has been written since, the tape fails rather than silently
 * recording a different story.
 */
import {
  beat,
  clickSelector,
  command,
  runJs,
  sleep,
  storyboard,
  type_,
  waitForSelector,
  wheelScroll,
} from "../src/lib.ts";

const WIKI_CMD = "lilbee:wiki";

/** A written page that cites its sources and links four other subjects. */
const PAGE = "lilbee-wiki/entities/saturn.md";
/** A subject the corpus names that has no page yet, verified against
 * /api/wiki/stubs before each take.
 *
 * Chosen for its name as much as its content. The index also offers
 * "Saturnian", "Le Verrier's" and "Solar System's": NER picks up adjectival and
 * possessive forms, which are real entries but read badly as page titles. */
const STUB = "amazonis planitia";
/** Where that subject lands once written, as a vault note. */
const STUB_NOTE = "lilbee-wiki/entities/amazonis-planitia.md";

// How long to hold while the page is written. A fixed wait, not a poll: the
// detail pane still shows the previous article until the new one lands, so
// there is no "content appeared" selector to wait on.
//
// Measured, not guessed: one page took 34s on this rig. 60s leaves margin.
const GEN_WAIT_MS = 60_000;
// 60s of waiting becomes about 10s on screen: long enough to read the running
// job and register that real work is happening, short enough not to stall.
const GEN_SPEEDUP = 6;

/** Open a wiki note the way a reader would: reading view, as a tab beside the
 * wiki pane, revealed in the file explorer so its folder is visible too.
 *
 * Deliberately does NOT tear down the layout. An earlier cut detached the
 * plugin panes and rebuilt them afterwards, and the rebuilt wiki pane resolved
 * to a position off the bottom of the window, so the click that opens the write
 * dialog landed nowhere. Opening a sibling tab leaves the layout untouched, and
 * closing the tab is all it takes to get back. */
const openNote = (path: string) => runJs(`
  const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
  if (!file) throw new Error("missing vault note: " + ${JSON.stringify(path)});
  const wiki = app.workspace.getLeavesOfType("lilbee-wiki")[0];
  if (wiki) app.workspace.setActiveLeaf(wiki, { focus: true });
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file, { state: { mode: "preview" } });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
  if (explorer) { app.workspace.revealLeaf(explorer); await explorer.view.revealInFolder?.(file); }
`);

export default storyboard("wiki", {
  window: [1400, 900],
  layout: "wiki-and-placement",
  // Pointed at a remote server, so it must not bind to a managed-mode window
  // that happens to share the CDP endpoint.
  vaultMatch: "fresh-verify",
  // The wiki is prebuilt: a full build is an hours-long GPU job. The single
  // page written near the end is the live work.
  skipModelPin: true,
  caption: "Ten documents in. An encyclopedia out.",
  // The written page arriving in the vault, not the browse. The browse sets it
  // up; this is the payload.
  moneyShotBeatIndex: 21,
  beats: [
    // Act 1 - the index. What the plugin knows, before touching the vault.
    beat("Open the wiki", command(WIKI_CMD), { holdMs: 700 }),
    beat("Let the list settle", waitForSelector(".lilbee-wiki-page-item"), {
      holdMs: 1600,
      caption: "Concepts and entities, grouped. Every subject your documents name.",
    }),
    beat("Scroll the library", wheelScroll(".lilbee-wiki-list", 14), {
      holdMs: 1400,
      speedup: 2,
      caption: "Written up from your own documents, not the web.",
    }),
    beat("Back to the top", wheelScroll(".lilbee-wiki-list", -14), { holdMs: 600, speedup: 2 }),

    // Act 2 - the same wiki, as plain notes. This is the half the earlier cut
    // was missing, and the reason it did not read as a wiki.
    beat("Open the vault copy", openNote(PAGE), {
      holdMs: 1200,
      caption: "Not locked in the plugin. Every page is a note in your vault.",
    }),
    beat("Read it as a note", waitForSelector(".markdown-preview-view"), {
      holdMs: 3400,
      caption: "It records the model that wrote it and the documents behind it.",
    }),
    beat("Follow a link", clickSelector(".markdown-preview-view a.internal-link"), {
      holdMs: 2800,
      caption: "Click through it like any wiki.",
    }),
    beat("And another", clickSelector(".markdown-preview-view a.internal-link"), {
      holdMs: 2600,
    }),
    beat("See how it connects", command("graph:open-local"), {
      holdMs: 3600,
      caption: "Backlinks and graph come free, because they really are just notes.",
    }),
    beat(
      "Close the graph",
      runJs(`app.workspace.getLeavesOfType("localgraph").forEach((l) => l.detach());`),
      { holdMs: 500 },
    ),

    // Act 3 - the gap, and filling it.
    beat(
      "Back to the wiki",
      runJs(`
        app.workspace.detachLeavesOfType("markdown");
        const wiki = app.workspace.getLeavesOfType("lilbee-wiki")[0];
        if (wiki) app.workspace.setActiveLeaf(wiki, { focus: true });
      `),
      { holdMs: 1000 },
    ),
    // Clear and focus rather than click. A second clickSelector on the filter
    // does not re-focus it (the harness resolves it to a zero-origin box), so
    // the next keystrokes land nowhere and the box keeps the previous query.
    beat(
      "Search for a subject",
      runJs(`
        const el = document.querySelector(".lilbee-wiki-search");
        el.focus();
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      `),
      { holdMs: 500 },
    ),
    beat("Type it", type_(STUB), { holdMs: 900 }),
    beat("It knows the subject, dimmed", waitForSelector(".lilbee-wiki-stub"), {
      holdMs: 2600,
      caption: "It knows every subject, including the ones it has not written.",
    }),
    // The Task Centre appears for the job and goes away after. Parking it on
    // screen for the whole reel would show an empty box through every beat that
    // has no running work.
    beat(
      "Bring up the Task Centre",
      runJs(`
        const leaf = app.workspace.createLeafBySplit(
          app.workspace.getLeavesOfType("lilbee-placement")[0], "horizontal", false);
        await leaf.setViewState({ type: "lilbee-tasks", active: false });
      `),
      { holdMs: 700 },
    ),
    beat("Ask for the page", clickSelector(".lilbee-wiki-stub"), { holdMs: 900 }),
    beat("Confirm", clickSelector(".mod-cta"), {
      holdMs: 900,
      caption: "Ask, and it writes one.",
    }),
    beat("Watch it write on the GPU", sleep(GEN_WAIT_MS), {
      holdMs: 1000,
      speedup: GEN_SPEEDUP,
      caption: "One page, one model call, on your own GPU.",
    }),
    beat(
      "Put the Task Centre away",
      runJs(`app.workspace.getLeavesOfType("lilbee-tasks").forEach((l) => l.detach());`),
      { holdMs: 600 },
    ),
    beat("Read the new page", waitForSelector(".lilbee-wiki-content"), {
      holdMs: 3000,
      caption: "Written and cited.",
    }),
    // The close: it is not just in the plugin, it is in the vault with the rest
    // of the wiki, linked like everything around it.
    beat("And it is already a note", openNote(STUB_NOTE), { holdMs: 1000 }),
    beat("Read the new note", waitForSelector(".markdown-preview-view"), {
      holdMs: 4000,
      caption: "And it is part of your vault, linked like the rest.",
    }),
  ],
});
