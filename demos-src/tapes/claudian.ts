/**
 * claudian tutorial: pair Claudian with lilbee and put your agent to work on a
 * knowledge base — on your own models.
 *
 * Every real click is driven with the visible cursor (clickSelector /
 * hoverSelector). Only non-mouse work is scripted: the first-use picker that
 * pops on its own, opening views by command, typing, layout, and waits.
 *
 * The payoff: the agent crawls a Wikipedia page into your lilbee library
 * (lilbee's MCP `add`), answers a cited question from it (`search`), takes a
 * grounded follow-up, then writes a summary note back into your vault. A couple
 * of tool calls are revealed on hover so the lilbee calls are clear; the model
 * runs on the GPU box, shown live in the placement view while it works.
 *
 * Pre-state (drive prep): lilbee external mode -> GPU server; agentIntegration
 * reset; Claudian local-only (cloud off, only the lilbee model); no Claudian or
 * placement panel open; the Caprice page absent from the library; the generated
 * note absent; the crawler warm.
 */
import { beat, clickSelector, hoverSelector, runJs, sleep, storyboard } from "../src/lib.ts";

const VIEW = '.workspace-leaf-content[data-type="claudian-view"]';
const MODEL_MATCH = "Coder";
const NOTE_PATH = "Caprice Engines.md";

const showPicker = `
  const lb = app.plugins.plugins["lilbee"];
  lb.settings.agentIntegration = { agent: "none", keepConfigFresh: true, pickerShown: false };
  await lb.saveData(lb.settings);
  void lb.maybeShowAgentPicker();
  for (let i = 0; i < 20; i++) {
    if (document.querySelector(".modal-container .modal")) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("agent picker never appeared");
`;

// After Connect, make sure Claudian has read the fresh config (its notice, if
// shown, is clicked; then its live settings are set so the model is ready).
const wireClaudian = `
  const notice = Array.from(document.querySelectorAll(".notice")).find(n => /Reload Claudian/i.test(n.textContent));
  if (notice) { (notice.querySelector("a, button") ?? notice).click(); }
  let cl = null;
  for (let i = 0; i < 40; i++) {
    cl = app.plugins.plugins["realclaudian"];
    if (cl && typeof cl.mutateSettings === "function") break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1500));
`;

// The "Open Claudian" ribbon opens a panel in the main area; give it a fresh
// session and wait for its input.
const newSession = `
  const fsp = window.require("node:fs/promises");
  try { await fsp.unlink(app.vault.adapter.basePath + "/${NOTE_PATH}"); } catch (e) {}
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (document.querySelector('${VIEW} textarea')) break;
    await new Promise(r => setTimeout(r, 500));
  }
  app.commands.executeCommandById('realclaudian:new-session');
  await new Promise(r => setTimeout(r, 1500));
`;

const waitForModelOption = `
  const view = document.querySelector('${VIEW}');
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const menu = view.querySelector('.claudian-model-dropdown');
    const opt = menu ? Array.from(menu.querySelectorAll('.claudian-model-option')).find(o => /${MODEL_MATCH}/.test(o.textContent)) : null;
    if (opt) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("the remote model never appeared in Claudian's model menu");
`;

// The real cursor click lands on the option but Claudian selects on a full
// pointer sequence, so a bare OS click reads as a hover. Fire the sequence to
// make the pick take, then close the menu so it can never sit over the chat box.
const ensureModelSelected = `
  const view = document.querySelector('${VIEW}');
  const menu = view.querySelector('.claudian-model-dropdown');
  if (menu) {
    const opt = Array.from(menu.querySelectorAll('.claudian-model-option')).find(o => /${MODEL_MATCH}/.test(o.textContent));
    if (opt) {
      const r = opt.getBoundingClientRect();
      for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        opt.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: r.x + 6, clientY: r.y + 6, view: window }));
      }
    }
  }
  await new Promise(r => setTimeout(r, 500));
  if (view.querySelector('.claudian-model-dropdown')) {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  await new Promise(r => setTimeout(r, 300));
`;

const ask = (text) => `
  const ta = document.querySelector('${VIEW} textarea');
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  const text = ${JSON.stringify(text)};
  for (let i = 1; i <= text.length; i++) {
    setter.call(ta, text.slice(0, i));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 13));
  }
  await new Promise(r => setTimeout(r, 350));
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
`;

// Wait for a whole turn: give it a moment to start, wait for streaming to begin
// (busy), then require the busy indicator to stay gone for several seconds so
// the gaps between tool calls never end the wait early. When \`needle\` is given,
// also require it in the finished reply.
const IDLE_SECS = 4;
const waitForReply = (needle) => `
  const view = document.querySelector('${VIEW}');
  const busyRe = /esc to interrupt|Thinking \\d|Generating|Working|Breathing|Stop/;
  const needle = ${JSON.stringify(needle || "")};
  await new Promise(r => setTimeout(r, 2500));
  const startBy = Date.now() + 25000;
  while (Date.now() < startBy && !busyRe.test(view.innerText)) await new Promise(r => setTimeout(r, 400));
  const deadline = Date.now() + 300000;
  let idle = 0;
  while (Date.now() < deadline) {
    if (busyRe.test(view.innerText)) idle = 0;
    else { idle++; if (idle >= ${IDLE_SECS} && (!needle || new RegExp(needle).test(view.innerText))) return; }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('reply did not finish');
`;

// Like waitForReply, but the turn is done only once the note exists AND the run
// has been idle for a few seconds — so the agent's closing message finishes on
// camera instead of being cut off.
const waitForNote = `
  const view = document.querySelector('${VIEW}');
  const busyRe = /esc to interrupt|Thinking \\d|Generating|Working|Breathing|Stop/;
  await new Promise(r => setTimeout(r, 2500));
  const startBy = Date.now() + 25000;
  while (Date.now() < startBy && !busyRe.test(view.innerText)) await new Promise(r => setTimeout(r, 400));
  const deadline = Date.now() + 300000;
  let idle = 0;
  while (Date.now() < deadline) {
    const haveNote = !!app.vault.getAbstractFileByPath('${NOTE_PATH}');
    if (busyRe.test(view.innerText)) idle = 0;
    else { idle++; if (idle >= ${IDLE_SECS} && haveNote) return; }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('agent never finished writing ${NOTE_PATH}');
`;

// Wait for the crawl turn to finish, then verify the page is actually
// searchable in the library. If the model emitted a text-only tool call that
// never executed, the page is not indexed — abort fast so a broken run is never
// filmed (re-record instead of proceeding to ungrounded questions).
const waitForCrawl = `
  const view = document.querySelector('${VIEW}');
  const busyRe = /esc to interrupt|Thinking \\d|Generating|Working|Breathing|Stop/;
  const lb = app.plugins.plugins.lilbee;
  const indexed = async () => {
    try {
      const r = await lb.api.search("Chevrolet Caprice V8 engine", 3);
      return Array.isArray(r) && r.some(x => JSON.stringify(x).toLowerCase().includes("caprice"));
    } catch (e) { return false; }
  };
  await new Promise(r => setTimeout(r, 2500));
  const startBy = Date.now() + 25000;
  while (Date.now() < startBy && !busyRe.test(view.innerText)) await new Promise(r => setTimeout(r, 400));
  const deadline = Date.now() + 300000;
  let idle = 0;
  while (Date.now() < deadline) {
    if (busyRe.test(view.innerText)) { idle = 0; }
    else {
      idle++;
      if (idle >= ${IDLE_SECS}) {
        const graceEnd = Date.now() + 15000;
        while (Date.now() < graceEnd) {
          if (await indexed()) return;
          await new Promise(r => setTimeout(r, 1500));
        }
        throw new Error('crawl turn finished but the page is not in the library (tool call did not execute)');
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('crawl turn did not finish');
`;

// The message list virtualizes: once the view scrolls to the bottom of a long
// turn, off-screen tool-call chips leave the DOM. Scroll the conversation up
// until the named chip renders, then center it, so the cursor can hover it.
const scrollToChip = (prefix) => `
  const view = document.querySelector('${VIEW}');
  const sel = '[aria-label^="${prefix}"]';
  const scroller = view.querySelector('[class*="messages"], [class*="conversation"], [class*="scroll"]') ?? view;
  for (let i = 0; i < 50; i++) {
    const chip = view.querySelector(sel);
    if (chip) {
      chip.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 350));
      if (view.querySelector(sel)) return;
    }
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 320);
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('chip never rendered: ${prefix}');
`;

// Reveal one lilbee tool-call chip (its args/results) by dropping the hidden
// class — no click, so nothing in the content can navigate the webview.
const revealCall = (name) => `
  const view = document.querySelector('${VIEW}');
  const call = Array.from(view.querySelectorAll('.claudian-tool-call')).find(c => {
    const n = c.querySelector('.claudian-tool-name');
    return n && n.textContent.includes(${JSON.stringify(name)});
  });
  if (call) {
    call.scrollIntoView({ block: 'center' });
    const content = call.querySelector('.claudian-tool-content');
    if (content) content.classList.remove('claudian-hidden');
  }
  await new Promise(r => setTimeout(r, 300));
`;

// Robustly reveal the lilbee tool calls that are on screen: scroll the newest
// ones into view and drop their hidden class. Guarded — if the chips have
// virtualized away it is a no-op, so it can never abort the recording.
const revealToolCalls = `
  const view = document.querySelector('${VIEW}');
  const scroller = view.querySelector('.claudian-messages') || view.querySelector('[class*="messages"]') || view;
  scroller.scrollTop = Math.max(0, scroller.scrollTop - 520);
  await new Promise(r => setTimeout(r, 450));
  let last = null;
  for (const call of Array.from(view.querySelectorAll('.claudian-tool-call'))) {
    const n = call.querySelector('.claudian-tool-name');
    if (n && /lilbee_/.test(n.textContent)) {
      const content = call.querySelector('.claudian-tool-content');
      if (content) content.classList.remove('claudian-hidden');
      last = call;
    }
  }
  if (last) last.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 300));
`;

const collapseCalls = `
  const view = document.querySelector('${VIEW}');
  for (const content of Array.from(view.querySelectorAll('.claudian-tool-content'))) {
    content.classList.add('claudian-hidden');
  }
  await new Promise(r => setTimeout(r, 200));
`;

// Open lilbee's GPU placement in a split beside the Claudian panel (by command;
// there is no ribbon for it).
const openPlacement = `
  const claudian = app.workspace.getLeavesOfType('claudian-view')[0];
  if (claudian) {
    const leaf = app.workspace.createLeafBySplit(claudian, 'vertical', false);
    await leaf.setViewState({ type: 'lilbee-placement', active: false });
  } else {
    app.commands.executeCommandById('lilbee:open-placement');
  }
  await new Promise(r => setTimeout(r, 2500));
`;

const scrollChat = `
  const view = document.querySelector('${VIEW}');
  const scroller = view.querySelector('[class*="messages"], [class*="scroll"], [class*="conversation"]') ?? view;
  scroller.scrollTop = scroller.scrollHeight;
`;

// Close the working panels so the vault note can fill the frame when opened.
const closePanels = `
  app.workspace.detachLeavesOfType('lilbee-placement');
  app.workspace.detachLeavesOfType('claudian-view');
  await new Promise(r => setTimeout(r, 400));
`;

// The file explorer only renders visible tree rows, so scroll/expand to the new
// note before the cursor clicks it.
const revealNote = `
  const file = app.vault.getAbstractFileByPath('${NOTE_PATH}');
  if (!file) throw new Error('missing ${NOTE_PATH}');
  const exLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
  if (exLeaf && exLeaf.view && typeof exLeaf.view.revealInFolder === 'function') {
    exLeaf.view.revealInFolder(file);
  }
  await new Promise(r => setTimeout(r, 800));
`;

export default storyboard("claudian", {
  window: [1400, 900],
  layout: "explorer-note",
  vaultMatch: "obsidian-lilbee-demo",
  windowMatch: " - vault - ",
  pinChatModel: "unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf",
  preloadChatModel: false,
  clearTaskCenter: true,
  clearChat: true,
  cursorHome: [700, 450],
  moneyShotBeatIndex: 33,
  beats: [
    beat("Opening hold", sleep(1400), {
      caption: "Obsidian, with lilbee and Claudian installed. lilbee runs on a GPU box.",
    }),
    beat("The agent picker appears", runJs(showPicker), {
      maxMs: 30000, holdMs: 900,
      caption: "lilbee detects the agent CLI on this machine and offers to pair it.",
    }),
    beat("Hold on the picker", sleep(1500)),
    beat("Remember my choice", clickSelector('.modal-container .modal input[type="checkbox"]'), { holdMs: 900 }),
    beat("Connect OpenCode", clickSelector('.modal-container .modal button:has-text("Connect")'), {
      holdMs: 1400,
      caption: "One click pairs Claudian with your lilbee server: models to think with, and a library to search.",
    }),
    beat("Wire Claudian", runJs(wireClaudian), { maxMs: 45000, holdMs: 600 }),

    beat("Open Claudian", clickSelector('.side-dock-ribbon-action[aria-label="Open Claudian"], [aria-label="Open Claudian"]'), {
      holdMs: 900, caption: "Open Claudian. Its agent now runs on your lilbee models.",
    }),
    beat("Fresh session", runJs(newSession), { maxMs: 20000, holdMs: 400 }),

    beat("Open the model menu", clickSelector(`${VIEW} .claudian-model-btn`), { holdMs: 900, caption: "Pick which model is the brain." }),
    beat("Wait for the model", runJs(waitForModelOption), { maxMs: 30000 }),
    beat("Pick Qwen3 Coder 30B", clickSelector(`${VIEW} .claudian-model-dropdown .claudian-model-option:has-text("${MODEL_MATCH}")`), {
      holdMs: 700, caption: "Qwen3 Coder 30B, running on the GPU box. No API key, no account, unlimited tokens — a free model.",
    }),
    beat("Confirm the selection", runJs(ensureModelSelected), { holdMs: 400 }),
    beat("Click the chat box", clickSelector(`${VIEW} textarea`), { holdMs: 400 }),

    // Step 1 — crawl the page into the library. Its own turn: no question is
    // asked until the crawl finishes and the page is actually indexed.
    beat("Ask it to crawl the page", runJs(ask("Crawl the Wikipedia page https://en.wikipedia.org/wiki/Chevrolet_Caprice into my library.")), {
      maxMs: 30000, caption: "Ask the agent to crawl a web page into your lilbee library.",
    }),
    // Open the GPU placement beside Claudian so the RTX 4090 is visible while
    // the agent works. Kept open through every turn until the note is written.
    beat("Show the GPU placement", runJs(openPlacement), {
      maxMs: 20000, holdMs: 1600,
      caption: "The model runs on the RTX 4090 — shown live here while the agent works.",
    }),
    beat("Agent crawls and polls", runJs(waitForCrawl), {
      maxMs: 300000, speedup: 5,
      caption: "lilbee crawls the page; the agent polls the crawl task until it lands in the library.",
    }),

    // Reveal the crawl + status calls on hover so the crawl-then-added flow is
    // clear, then collapse them.
    beat("Show the crawl calls", runJs(revealToolCalls), { holdMs: 3400, caption: "lilbee crawl fetched the page; the status poll confirmed it — added to your library." }),
    beat("Collapse the crawl calls", runJs(collapseCalls), { holdMs: 400 }),

    // Step 2 — now ask a cited question, answered from the crawled page. The GPU
    // placement view is open, so move to the chat box with a hover (a real click
    // while that live pane is open reloads the Obsidian renderer).
    beat("Move to the chat box", hoverSelector(`${VIEW} textarea`), { holdMs: 300 }),
    beat("Ask the first question", runJs(ask("Now, from my library: which V8 engines did the 1994 Caprice offer? Cite the source.")), {
      maxMs: 30000, caption: "Now ask a question — answered from the page it just crawled.",
    }),
    beat("Agent answers, cited", runJs(waitForReply("5\\.7|4\\.3|LT1|L99|Corvette|police")), { maxMs: 300000, speedup: 6 }),
    beat("Show the search call", runJs(revealToolCalls), { holdMs: 2800, caption: "lilbee search: it read the answer back out, with a citation." }),
    beat("Collapse the search call", runJs(collapseCalls), { holdMs: 400 }),

    // Q3 — a grounded follow-up, answered from the same library.
    beat("Move to the chat box again", hoverSelector(`${VIEW} textarea`), { holdMs: 300 }),
    beat("Ask a follow-up", runJs(ask("From my library: when was the 9C1 police package introduced, and what engines did the 1977 to 1990 Caprice offer?")), {
      maxMs: 30000, caption: "A follow-up, answered straight from your library.",
    }),
    beat("Agent answers the follow-up", runJs(waitForReply()), { maxMs: 300000, speedup: 6 }),
    beat("Read the follow-up", runJs(scrollChat), { holdMs: 2200, caption: "No re-crawl — it is already in your knowledge base." }),

    // Q3 — the agent does real work on the vault: writes a summary note.
    beat("Move to the chat box again", hoverSelector(`${VIEW} textarea`), { holdMs: 300 }),
    beat("Ask it to write a note", runJs(ask("Now save a markdown file to my vault called Caprice Engines.md — write it to disk — with a table of the notable engines across every Caprice generation, using my library for the details.")), {
      maxMs: 30000, caption: "Now put it to work: write a summary back into the vault.",
    }),
    beat("Agent writes the note", runJs(waitForNote), {
      maxMs: 300000, speedup: 6,
      caption: "It searches the library and writes the note itself — the vault is its working directory.",
    }),
    beat("Show the finished answer", runJs(scrollChat), {
      holdMs: 2800,
      caption: "The agent's reply, in full — the note is written and ready.",
    }),

    beat("Close the panels", runJs(closePanels), { holdMs: 300 }),
    beat("Reveal the note in the explorer", runJs(revealNote), { maxMs: 15000, holdMs: 500 }),
    beat("Open the generated note", clickSelector(`.nav-file-title[data-path="${NOTE_PATH}"]`), {
      maxMs: 20000, holdMs: 3500,
      caption: "The note it wrote: a tidy engine table, built from a page it crawled minutes ago.",
    }),
    beat("Money shot: hold on the note", sleep(4500), {
      caption: "Your agent, your models, your knowledge base — all on hardware you control.",
    }),
  ],
});
