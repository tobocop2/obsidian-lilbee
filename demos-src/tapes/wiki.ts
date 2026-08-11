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
 *             those pages, split across three RTX 4090s (72GB) rather than a
 *             datacentre card. That is the point of the GPU pane: a 70B on
 *             hardware someone actually owns. Two cards would have fit only a
 *             Q4, and mixing quants would have shown one page written to a
 *             different standard than the 54 around it.
 *   Write     one page is one model call, measured at 34s on 3090s and about
 *             the same here. Three cards split the weights roughly evenly,
 *             which is what the GPU pane shows while it works.
 *
 * PAGE and STUB are both real. Nothing here is seeded for the camera: if the
 * chosen stub has been written since, the tape fails rather than silently
 * recording a different story.
 */
import {
  beat,
  clickSelector,
  command,
  hoverSelector,
  key,
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

/** Reveal a wiki note in the file explorer so it can be clicked.
 *
 * Only reveals — the click is a separate beat. An earlier cut opened the note
 * from script, so a tab appeared with nothing on screen causing it, which reads
 * as the app doing things by itself rather than someone using it. */
const revealNote = (path: string) => runJs(`
  // Reading view, not Live Preview. A note opened by clicking inherits the
  // vault's default mode, and in source mode [[links]] are plain text: the
  // cross-link beat has nothing to click and no .markdown-preview-view exists.
  app.vault.setConfig("defaultViewMode", "preview");
  app.vault.setConfig("livePreview", false);
  // Close any note already open. Clicking a file that is open in another tab
  // just activates that tab and keeps its mode, so a note left in source view
  // by earlier work reopens in source view and the preview never appears.
  app.workspace.detachLeavesOfType("markdown");
  const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
  if (!file) throw new Error("missing vault note: " + ${JSON.stringify(path)});
  const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
  if (!explorer) throw new Error("no file explorer");
  app.workspace.revealLeaf(explorer);
  await explorer.view.revealInFolder?.(file);
  // Centre the row. revealInFolder happily leaves it flush against the bottom
  // of a long tree, and at the viewport edge the harness's measured point and
  // the live row stop agreeing: the click lands just past it and nothing opens.
  await new Promise((r) => setTimeout(r, 400));
  const row = document.querySelector('.nav-file-title[data-path="' + ${JSON.stringify(path)} + '"]');
  if (!row) throw new Error("no explorer row for " + ${JSON.stringify(path)});
  row.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 500));
`);

/** The explorer row for a note, which is what the cursor actually clicks. */
const noteRow = (path: string) => `.nav-file-title[data-path="${path}"]`;

/** The preview in the tab that is actually on screen. Act 2 leaves earlier
 * notes open, so an unscoped .markdown-preview-view can match a background
 * tab that never becomes visible. */
const ACTIVE_PREVIEW = ".workspace-leaf.mod-active .markdown-preview-view";

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
  moneyShotBeatIndex: 23,
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
    beat("Find it in the vault", revealNote(PAGE), {
      holdMs: 1100,
      caption: "Not locked in the plugin. Every page is a note in your vault.",
    }),
    beat("Open the note", clickSelector(noteRow(PAGE)), { holdMs: 1200 }),
    beat("Read it as a note", waitForSelector(ACTIVE_PREVIEW), {
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
    beat("Back to the wiki", clickSelector('.workspace-tab-header[aria-label*="lilbee Wiki"]'), {
      holdMs: 1000,
    }),
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
    beat("Ask for the page", clickSelector(".lilbee-wiki-stub"), { holdMs: 900 }),
    beat("Confirm", clickSelector(".mod-cta"), {
      holdMs: 900,
      caption: "Ask, and it writes one.",
    }),
    // Opened after the job starts, the way someone actually checks on running
    // work, and closed once it is done. An earlier cut split it into the layout
    // from script, so it appeared with nothing causing it.
    beat("Open the command palette", runJs(`window.app.commands.executeCommandById("command-palette:open");`), {
      holdMs: 700,
      keyHint: "\u2318P",
    }),
    beat("Look for the Task Centre", type_("Task Center"), { holdMs: 1200 }),
    beat("Open it", key("enter"), {
      holdMs: 1100,
      caption: "The write is a job like any other, so it shows up where jobs do.",
    }),
    beat("Watch it write on the GPU", sleep(GEN_WAIT_MS), {
      holdMs: 1000,
      speedup: GEN_SPEEDUP,
      caption: "One page, one model call, on your own GPU.",
    }),
    // Collapse the sidebar rather than closing the tab. A sidebar tab is
    // icon-only and renders no close button at all — it measures 0x0, so the
    // click landed in the corner and the Task Centre stayed open. The toggle
    // in the tab bar is a real target and reads as putting the panel away.
    beat("Put the Task Centre away", clickSelector(".sidebar-toggle-button.mod-right"), {
      holdMs: 900,
    }),
    beat("Read the new page", waitForSelector(".lilbee-wiki-content"), {
      holdMs: 3000,
      caption: "Written and cited.",
    }),
    // The close: it is not just in the plugin, it is in the vault with the rest
    // of the wiki, linked like everything around it.
    beat("Find the new page in the vault", revealNote(STUB_NOTE), { holdMs: 1000 }),
    beat("Open it as a note", clickSelector(noteRow(STUB_NOTE)), { holdMs: 1000 }),
    beat("Read the new note", waitForSelector(ACTIVE_PREVIEW), {
      holdMs: 4000,
      caption: "And it is part of your vault, linked like the rest.",
    }),

    // The graph last, on purpose. It is the part people enjoy, but it is a
    // reward for what came before rather than the reason to install anything.
    beat("Open the graph", command("graph:open"), { holdMs: 900 }),
    // The graph is the thing Obsidian users actually love, and it opened as a
    // 361px sliver with the filters box covering 240px of it. Give it the pane,
    // fold the controls away, and let it breathe.
    beat(
      "Give the graph the room",
      runJs(`
        const side = app.workspace.getLeavesOfType("graph")[0] ?? app.workspace.getLeavesOfType("localgraph")[0];
        if (!side) throw new Error("no local graph leaf");
        const state = side.view?.getState?.() ?? {};
        // graph:open-local drops the graph into a side dock, where the canvas
        // is a ~360px sliver with the filters box covering most of it. Re-open
        // it as a sibling tab of the wiki so it gets the full main pane.
        const wiki = app.workspace.getLeavesOfType("lilbee-wiki")[0];
        if (wiki) app.workspace.setActiveLeaf(wiki, { focus: true });
        const big = app.workspace.getLeaf("tab");
        await big.setViewState({ type: side.view.getViewType(), state, active: true });
        side.detach();
        document.querySelector(".graph-controls")?.classList.add("is-close");
        app.workspace.setActiveLeaf(big, { focus: true });
      `),
      { holdMs: 1400, caption: "Fifty-five pages, written from ten documents." },
    ),
    beat("Zoom into it", wheelScroll(".workspace-leaf-content[data-type='graph'] canvas", 4), {
      holdMs: 1600,
      speedup: 1,
    }),
    beat("Let it settle", sleep(3800), {
      holdMs: 1200,
      caption: "Everything your documents know, in one picture.",
    }),

    // Act 3 - the gap, and filling it.
  ],
});
