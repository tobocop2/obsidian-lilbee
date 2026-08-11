/**
 * claudian demo: write and run real code from Obsidian with a lilbee-served model.
 *
 * Claudian embeds opencode as an agent panel; the managed lilbee server
 * feeds it the on-machine models over the OpenAI-compatible endpoint. On
 * camera: open the model menu (lilbee models as the agent's brain), give the
 * agent a coding task, watch it write a Python script into the vault, run
 * it, and open the note the script generated.
 *
 * Pre-state (drive prep + preflight): Claudian on the opencode provider with
 * Qwen3-14B selected and visible, the plugin-refreshed opencode.json in the
 * vault root, dual pane off, auto titles off, no tools/toc.py and no
 * 'Table of Contents.md' in the vault, warm chat model.
 */
import { beat, runJs, sleep, storyboard } from "../src/lib.ts";

const VIEW = '.workspace-leaf-content[data-type="claudian-view"]';
const SCRIPT_PATH = "tools/toc.py";
const TOC_PATH = "Table of Contents.md";

// The model chip only opens on a real pointer sequence, not a synthetic click.
const toggleModelMenu = `
  const btn = document.querySelector('${VIEW} .claudian-model-btn');
  const r = btn.getBoundingClientRect();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 6, clientY: r.y + 6, view: window }));
  }
`;

// Claudian re-renders its input around session changes, which drops focus
// between beats — OS-level typing then lands nowhere. Drive the textarea
// directly: native value setter per character (visible typing), then a
// synthetic Enter on the same element.
const typeTask = `
  const ta = document.querySelector('${VIEW} textarea');
  ta.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  const text = ${JSON.stringify("Write a Python script tools/toc.py that generates Table of Contents.md: every note in this vault as a wikilink, grouped by folder, skipping the lilbee folder and hidden dot-folders. Then run it.")};
  for (let i = 1; i <= text.length; i++) {
    setter.call(ta, text.slice(0, i));
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 22));
  }
`;

const sendTask = `
  const ta = document.querySelector('${VIEW} textarea');
  ta.focus();
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
`;

// Fail fast if the send never landed, then wait for the agent to start
// writing the script (tool chip or path visible in the transcript).
const waitForCoding = `
  const view = document.querySelector('${VIEW}');
  await new Promise(r => setTimeout(r, 2000));
  if (!view.innerText.includes('toc.py')) {
    for (let i = 0; i < 10; i++) {
      if (view.innerText.includes('Table of Contents')) break;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  if (!/toc\\.py|Table of Contents/.test(view.innerText)) throw new Error('task never reached the agent');
  const deadline = Date.now() + 1020000;
  while (Date.now() < deadline) {
    if (window.app.vault.getAbstractFileByPath('${SCRIPT_PATH}')) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('agent never wrote ${SCRIPT_PATH}');
`;

const waitForTocWritten = `
  const app = window.app;
  const view = document.querySelector('${VIEW}');
  const deadline = Date.now() + 840000;
  let tocSeen = false;
  while (Date.now() < deadline) {
    if (app.vault.getAbstractFileByPath('${TOC_PATH}')) tocSeen = true;
    const busy = /esc to interrupt|Breathing|Thinking \\d/.test(view.innerText);
    if (tocSeen && !busy) return;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('run did not finish with ${TOC_PATH} generated');
`;

// Scroll the Claudian transcript so the expanded Write diff (the script's
// code) is in view. Obsidian has no view for .py files, so the code reveal
// happens in the agent panel, not an editor tab.
const scrollToDiff = `
  const view = document.querySelector('${VIEW}');
  const scroller = view.querySelector('[class*="messages"], [class*="scroll"], [class*="conversation"]') ?? view;
  scroller.scrollTop = scroller.scrollHeight;
`;

const openToc = `
  const app = window.app;
  const file = app.vault.getAbstractFileByPath('${TOC_PATH}');
  if (!file) throw new Error('missing ${TOC_PATH}');
  const leaves = [];
  app.workspace.iterateAllLeaves(l => {
    if (l.view?.getViewType?.() === 'markdown') leaves.push(l);
  });
  const target = leaves[0] ?? app.workspace.getLeaf(true);
  await target.openFile(file, { active: true });
`;

export default storyboard("claudian", {
  window: [1400, 900],
  layout: "explorer-note-claudian",
  vaultMatch: "obsidian-lilbee-demo",
  // Title-substring for the window-scoped capture (PR #217): the CDP page is
  // picked by basePath, but the capture filter matches window titles, and this
  // vault's folder is literally named "vault".
  windowMatch: " - vault - ",
  pinChatModel: "Qwen/Qwen3-14B-GGUF/Qwen3-14B-Q4_K_M.gguf",
  preloadChatModel: true,
  clearTaskCenter: true,
  clearChat: true,
  cursorHome: [700, 450],
  moneyShotBeatIndex: 10,
  beats: [
    beat("Opening hold: note + agent panel", sleep(1400), {
      caption: "Claudian puts a coding agent inside Obsidian. lilbee serves it the models.",
    }),

    beat("Open the model menu", runJs(toggleModelMenu), {
      holdMs: 600,
      caption: "The agent's brain is a local model on this machine, served by lilbee. No vendor account.",
    }),
    beat("Hold on the lilbee model list", sleep(2600)),
    beat("Close the model menu", runJs(toggleModelMenu), { holdMs: 500 }),

    beat("Type the coding task", runJs(typeTask), {
      maxMs: 30000,
      caption: "Ask for real code: a script that builds a table of contents for the vault.",
    }),
    beat("Send", runJs(sendTask), { holdMs: 1000 }),

    beat("Agent writes the script", runJs(waitForCoding), {
      maxMs: 1080000,
      speedup: 6,
      caption: "The agent writes tools/toc.py straight into the vault.",
    }),

    beat("Agent runs it", runJs(waitForTocWritten), {
      maxMs: 900000,
      speedup: 8,
      caption: "Then it runs the script. The vault is the working directory.",
    }),

    beat("Show the code in the panel", runJs(scrollToDiff), {
      holdMs: 2200,
      caption: "Real code, written in place.",
    }),
    beat("Open the generated note", runJs(openToc), { holdMs: 600 }),
    beat("Money shot: the generated table of contents", sleep(3000), {
      caption: "And the note it generated: your vault, indexed by an agent on your own model.",
    }),
  ],
});
