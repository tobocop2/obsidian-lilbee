/**
 * claudian tutorial: getting started with Claudian on lilbee's local models.
 *
 * Full setup on camera, no gaps: the two Community plugins, lilbee's
 * first-use agent picker detecting the installed CLIs, Connect OpenCode
 * writing the live config, the Reload Claudian notice wiring the panel,
 * the Agent integration settings section, then the payoff — pick a local
 * model as the agent's brain, ask for real code, watch it written and run
 * in the vault.
 *
 * Pre-state (drive prep + preflight): virgin agent state — lilbee's
 * agentIntegration reset (agent none; pickerShown true so the boot during
 * pre-flight stays quiet and the on-camera beat re-arms it), Claudian's
 * opencode provider unconfigured, no opencode.json in the vault, no
 * tools/toc.py and no 'Table of Contents.md', chat model pinned and warm.
 */
import { beat, runJs, sleep, storyboard } from "../src/lib.ts";

const VIEW = '.workspace-leaf-content[data-type="claudian-view"]';
const SCRIPT_PATH = "tools/toc.py";
const TOC_PATH = "Table of Contents.md";

const openCommunityPlugins = `
  app.setting.open();
  await new Promise(r => setTimeout(r, 700));
  app.setting.openTabById("community-plugins");
  await new Promise(r => setTimeout(r, 700));
`;

const closeSettings = `
  app.setting.close();
  await new Promise(r => setTimeout(r, 400));
`;

// Re-arm and show the first-use picker: the same modal the boot path shows.
const showPicker = `
  const lb = app.plugins.plugins["lilbee"];
  lb.settings.agentIntegration = { agent: "none", keepConfigFresh: true, pickerShown: false };
  await lb.saveData(lb.settings);
  // The picker promise resolves when the user picks; fire it and poll the DOM.
  void lb.maybeShowAgentPicker();
  for (let i = 0; i < 20; i++) {
    if (document.querySelector(".modal-container .modal")) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error("agent picker never appeared");
`;

const checkRemember = `
  const modal = document.querySelector(".modal-container .modal");
  const box = modal.querySelector("input[type=checkbox]");
  if (box && !box.checked) box.click();
`;

const clickConnect = `
  const modal = document.querySelector(".modal-container .modal");
  const btn = Array.from(modal.querySelectorAll("button")).find(b => /Connect/.test(b.textContent));
  btn.click();
`;

// The Claudian bridge just rewrote Claudian's provider config; a notice with
// a reload button appears because Claudian is currently loaded.
const clickReloadNotice = `
  // lilbee shows a "Reload Claudian" notice when it changed Claudian's config
  // and Claudian is loaded. Click it on camera if it appeared. The reload's
  // job is to make Claudian read the freshly-written provider config; do that
  // deterministically by applying it to Claudian's live settings, since a
  // plain disable/enable can persist Claudian's stale in-memory state back
  // over the file.
  const notice = Array.from(document.querySelectorAll(".notice")).find(n => /Reload Claudian/i.test(n.textContent));
  if (notice) { (notice.querySelector("a, button") ?? notice).click(); }
  const fsp = window.require("node:fs/promises");
  const base = app.vault.adapter.basePath;
  let modelKey = "lilbee/Qwen3-14B";
  try {
    const oc = JSON.parse(await fsp.readFile(base + "/opencode.json", "utf8"));
    if (typeof oc.model === "string" && oc.model) modelKey = oc.model;
  } catch (e) {}
  const cl = app.plugins.plugins["realclaudian"];
  await cl.mutateSettings((st) => {
    const oc = st.providerConfigs.opencode ?? {};
    st.providerConfigs.opencode = {
      ...oc,
      enabled: true,
      visibleModels: Array.from(new Set([...(oc.visibleModels ?? []), modelKey])),
    };
  });
  await new Promise(r => setTimeout(r, 2000));
`;

const openLilbeeSettings = `
  app.setting.open();
  await new Promise(r => setTimeout(r, 700));
  app.setting.openTabById("lilbee");
  await new Promise(r => setTimeout(r, 900));
  // Obsidian 1.13 renders Settings as its own OS window; its DOM is not in
  // this document. Reach it through Electron and scroll there.
  try {
    const { BrowserWindow } = window.require("@electron/remote");
    const sw = BrowserWindow.getAllWindows().find(w => /Settings/.test(w.getTitle()));
    if (sw) {
      const scrollScript = [
        "(function () {",
        "  const scroller = document.querySelector('.vertical-tab-content');",
        "  if (!scroller) return 'no scroller';",
        "  const heads = scroller.querySelectorAll('h1, h2, h3, .setting-item-heading, .setting-item-name');",
        "  for (const el of Array.from(heads)) {",
        "    if (/Agent integration/i.test(el.textContent)) { el.scrollIntoView({ block: 'start' }); return 'scrolled'; }",
        "  }",
        "  return 'heading not found';",
        "})()",
      ].join(" ");
      await sw.webContents.executeJavaScript(scrollScript);
    }
  } catch (e) { /* remote unavailable */ }
  await new Promise(r => setTimeout(r, 900));
`;

// Open the Claudian panel as a split beside the note (same workspace shape a
// user ends up with), then wait for its input to exist.
const openClaudianPanel = `
  const notes = [];
  app.workspace.iterateAllLeaves(l => { if (l.view?.getViewType?.() === "markdown") notes.push(l); });
  const note = notes[0] ?? app.workspace.getLeaf(true);
  const claudian = app.workspace.createLeafBySplit(note, "vertical", false);
  await claudian.setViewState({ type: "claudian-view", active: true });
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (document.querySelector('${VIEW} textarea')) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const splits = document.querySelectorAll('.workspace-split.mod-vertical');
  for (const split of Array.from(splits)) {
    const tabs = split.querySelectorAll(':scope > .workspace-tabs');
    if (tabs.length === 2) { tabs[0].style.flex = '45'; tabs[1].style.flex = '55'; break; }
  }
  await new Promise(r => setTimeout(r, 500));
`;

// Open the model menu and wait for discovery to surface the lilbee models.
const openModelMenuWithLilbee = `
  const btn = document.querySelector('${VIEW} .claudian-model-btn');
  const openMenu = () => {
    const r = btn.getBoundingClientRect();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 6, clientY: r.y + 6, view: window }));
    }
  };
  const start = Date.now();
  while (Date.now() - start < 60000) {
    openMenu();
    await new Promise(r => setTimeout(r, 2500));
    const menu = document.querySelector('${VIEW} .claudian-model-dropdown');
    const opt = menu ? Array.from(menu.querySelectorAll(".claudian-model-option")).find(o => /Qwen3.14B/.test(o.textContent)) : null;
    if (opt) return;
    openMenu(); // toggle closed again before the next discovery poll
    await new Promise(r => setTimeout(r, 2500));
  }
  throw new Error("lilbee models never appeared in Claudian's model menu");
`;

const pickQwen14 = `
  const menu = document.querySelector('${VIEW} .claudian-model-dropdown');
  const opt = Array.from(menu.querySelectorAll(".claudian-model-option")).find(o => /Qwen3.14B/.test(o.textContent));
  const r = opt.getBoundingClientRect();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    opt.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5, view: window }));
  }
  await new Promise(r2 => setTimeout(r2, 800));
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

// Belt against a stray process flipping the shared engine's served model:
// re-pin the tape's model through lilbee's REST API just before the agent runs.
const repinModel = `
  const lb = app.plugins.plugins["lilbee"];
  const base = lb.api?.baseUrl ?? lb.settings.serverUrl;
  const token = lb.api?.token ?? lb.settings.manualToken ?? "";
  try {
    await fetch(base + "/api/models/chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ model: "Qwen/Qwen3-14B-GGUF/Qwen3-14B-Q4_K_M.gguf" }),
    });
  } catch (e) {}
  await new Promise(r => setTimeout(r, 1500));
`;

const waitForCoding = `
  const view = document.querySelector('${VIEW}');
  await new Promise(r => setTimeout(r, 2000));
  if (!/toc\\.py|Table of Contents/.test(view.innerText)) throw new Error('task never reached the agent');
  const deadline = Date.now() + 1020000;
  while (Date.now() < deadline) {
    // A mid-run engine model-swap surfaces here; abort in seconds, not 17 min.
    if (/This engine serves the configured chat model/.test(view.innerText)) {
      throw new Error('engine flipped models mid-run: ' + (view.innerText.match(/serves the configured chat model \\(([^)]+)\\)/) || [])[1]);
    }
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
  layout: "explorer-note",
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
  moneyShotBeatIndex: 21,
  beats: [
    beat("Opening hold", sleep(1400), {
      caption: "Obsidian, with the lilbee plugin running a local model server.",
    }),

    beat("Open Community plugins", runJs(openCommunityPlugins), {
      holdMs: 800,
      caption: "Two plugins: lilbee runs local models, Claudian is the coding agent. Install both from Community plugins.",
    }),
    beat("Hold on the plugin list", sleep(2400)),
    beat("Close settings", runJs(closeSettings), { holdMs: 400 }),

    beat("The agent picker appears", runJs(showPicker), {
      maxMs: 30000,
      holdMs: 900,
      caption: "lilbee detects the agent CLIs on this machine and offers to connect one.",
    }),
    beat("Hold on the picker", sleep(2400)),
    beat("Remember my choice", runJs(checkRemember), { holdMs: 900 }),
    beat("Connect OpenCode", runJs(clickConnect), {
      holdMs: 1200,
      caption: "One click. lilbee writes the agent's config with the live server address and token, and rewrites it on every boot.",
    }),

    beat("Reload Claudian notice", runJs(clickReloadNotice), {
      maxMs: 45000,
      holdMs: 1500,
      caption: "lilbee also points Claudian at your models.",
    }),

    beat("Agent integration settings", runJs(openLilbeeSettings), {
      maxMs: 30000,
      holdMs: 2600,
      caption: "Switch agents or models here any time. The config never goes stale.",
    }),
    beat("Close settings again", runJs(closeSettings), { holdMs: 400 }),

    beat("Open the Claudian panel", runJs(openClaudianPanel), {
      maxMs: 45000,
      holdMs: 900,
      caption: "Open Claudian. Its agent now runs on your lilbee models.",
    }),
    beat("Open the model menu", runJs(openModelMenuWithLilbee), {
      maxMs: 70000,
      holdMs: 900,
      caption: "Pick which local model is the brain. No API key, no account.",
    }),
    beat("Pick Qwen3 14B", runJs(pickQwen14), { holdMs: 800 }),

    beat("Type the coding task", runJs(typeTask), {
      maxMs: 30000,
      caption: "Ask for real code: a script that builds a table of contents for the vault.",
    }),
    beat("Re-pin the model", runJs(repinModel), { holdMs: 300 }),
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
      caption: "Your vault, indexed by an agent running entirely on your own models.",
    }),
  ],
});
