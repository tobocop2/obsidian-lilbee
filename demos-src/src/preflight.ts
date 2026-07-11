/**
 * Pre-flight state contract.
 *
 * Every demo starts from a deterministic Obsidian state:
 *  - Server reachable, active chat model pinned.
 *  - Source corpus reflects `freshIngest` intent.
 *  - Task Center is empty (no active, no completed clutter).
 *  - Chat history cleared if asked.
 *  - Layout matches the demo's declaration.
 *
 * Fails loud with a specific message if any assertion fails — no
 * silently driving against a wrong state.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ObsidianContext } from "./obsidian.ts";
import { applyLayout } from "./layouts.ts";
import type { LayoutName } from "./layouts.ts";

// Path inside the demo vault where the README lives. Snapshot it
// every preflight; restore at end of recording so failed typing
// never persists garbage into the file on disk.
const VAULT_FILES_TO_SNAPSHOT = [
  "Library/Application Support/obsidian-lilbee-demo/vault/Code/lilbee-README.md",
];

const snapshots = new Map<string, string>();

export function snapshotVaultFiles(): void {
  for (const rel of VAULT_FILES_TO_SNAPSHOT) {
    const abs = join(homedir(), rel);
    if (existsSync(abs)) {
      snapshots.set(abs, readFileSync(abs, "utf8"));
    }
  }
}

export function restoreVaultFiles(): void {
  for (const [abs, content] of snapshots) {
    try {
      writeFileSync(abs, content, "utf8");
    } catch {
      // ignore restore failures; leave file as-is
    }
  }
}

export type PreflightOptions = {
  ctx: ObsidianContext;
  layout: LayoutName;
  freshIngest?: string[];
  /** Remove EVERY indexed document so ingest sections animate from empty.
   * Stronger than freshIngest (which removes only named files) — killed takes
   * leave stray docs that flatten the next take's embed section. */
  clearIndex?: boolean;
  /** Reset GPU placement to auto and wait for the fleet (chat + embedder) to
   * come back ready. For tapes that apply manual placement: a prior take's
   * layout otherwise leaks into this one. */
  resetPlacement?: boolean;
  /** HF repo to uninstall before recording so a download demo pulls fresh. */
  freshModel?: string;
  clearTaskCenter?: boolean;
  clearChat?: boolean;
  pinChatModel?: string;
  /** Skip the chat-model pin entirely. For demos that don't exercise chat. */
  skipModelPin?: boolean;
  /** Skip the server-ready health gate + model preload. For a vault that has
   * no server of its own (multi_vault is "serving" another vault). */
  skipServerCheck?: boolean;
  /** Fire a cheap throwaway chat to warm up the model. Defaults to true for chat demos. */
  preloadChatModel?: boolean;
  /** This demo runs in a vault where the lilbee plugin isn't installed yet
   * (first_start). Skip every lilbee-specific preflight step. */
  noLilbee?: boolean;
};

// Qwen3 8B is the installed strong-general-purpose chat model in the
// shared registry. Qwen3 4B is NOT installed there — pinning it left a
// stale config ref that failed chat inference with "not found in
// registry" (surfaced to the user as the now-fixed model_not_installed).
export const DEFAULT_MODEL = "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf";

export async function preflight(opts: PreflightOptions): Promise<void> {
  const { ctx, layout } = opts;
  // A busy Mac drops capture frames and shifts animation-frame timing (a
  // pytest run alongside a take once exposed a repaint race on camera).
  {
    const os = await import("node:os");
    const load = os.loadavg()[0];
    const cores = os.cpus().length;
    if (load > cores * 0.5) {
      console.warn(
        `pre-flight WARNING: load average ${load.toFixed(1)} on ${cores} cores — close heavy work before recording`,
      );
    }
  }
  // Snapshot vault files first so any garbage typed during the demo
  // can be cleaned up at the end.
  snapshotVaultFiles();

  // first_start records a genuine from-scratch install, so it must start
  // with no trace of lilbee OR BRAT — the demo installs BRAT from the
  // community store and then adds lilbee through it. Disable + delete both
  // plugin folders + enabled-list entries, but ONLY in the firststart vault,
  // never the demo vault (a prior vault mix-up nuked the demo server).
  if (opts.noLilbee) {
    const wiped = await ctx.page.evaluate(async () => {
      const PLUGINS_TO_WIPE = ["lilbee", "obsidian42-brat"];
      const app = (globalThis as unknown as {
        app: {
          vault: { adapter: { basePath: string } };
          plugins: {
            enabledPlugins: Set<string>;
            plugins: Record<string, unknown>;
            disablePluginAndSave: (id: string) => Promise<void>;
          };
        };
      }).app;
      const vaultPath = app.vault.adapter.basePath;
      if (!vaultPath.includes("firststart")) {
        return { wiped: false, reason: "not the firststart vault", vaultPath };
      }
      const fs = require("node:fs");
      const path = require("node:path");
      for (const id of PLUGINS_TO_WIPE) {
        if (app.plugins.enabledPlugins.has(id) || app.plugins.plugins[id]) {
          await app.plugins.disablePluginAndSave(id);
        }
        fs.rmSync(path.join(vaultPath, ".obsidian/plugins/" + id), { recursive: true, force: true });
      }
      const cpFile = path.join(vaultPath, ".obsidian/community-plugins.json");
      try {
        const list = JSON.parse(fs.readFileSync(cpFile, "utf8")) as string[];
        fs.writeFileSync(cpFile, JSON.stringify(list.filter((id) => !PLUGINS_TO_WIPE.includes(id)), null, 2));
      } catch {
        // No community-plugins.json yet — nothing to prune.
      }
      return { wiped: true, vaultPath };
    });
    await ctx.page.evaluate(() => {
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      document.querySelectorAll(".modal-bg").forEach((m) => m.remove());
      document.querySelectorAll("body > .menu").forEach((m) => m.remove());
      // Toasts too (e.g. the external-server-outdated notice fires on plugin
      // launch and NOTICE_PERMANENT ones linger into the recording).
      document.querySelectorAll(".notice").forEach((n) => n.remove());
      // Close any open document tabs so the fresh-install demo opens on a
      // bare workspace, not a note left over from a prior session.
      const app = (globalThis as unknown as { app: { workspace: { detachLeavesOfType: (t: string) => void } } }).app;
      for (const t of ["markdown", "pdf", "lilbee-chat", "lilbee-tasks", "lilbee-wiki"]) app.workspace.detachLeavesOfType(t);
    });
    console.log(`pre-flight (noLilbee): ${JSON.stringify(wiped)}`);
    return;
  }

  const wantModel = opts.pinChatModel ?? DEFAULT_MODEL;
  const clearTaskCenter = opts.clearTaskCenter ?? true;
  const clearChat = opts.clearChat ?? true;
  const freshIngest = opts.freshIngest ?? [];

  // 1. Server genuinely READY. Poll until the plugin's OWN api.baseUrl
  // (set by the server-ready handler) is non-empty AND health is 200.
  // Falling back to settings.serverUrl masked a race: on a fresh Obsidian
  // launch the managed server's READY event wires api.baseUrl late, so a
  // demo that pinned the fallback URL would pass preflight while the
  // chat-view's empty-baseUrl client failed with "Server is still
  // starting up". Requiring api.baseUrl removes that race.
  //
  // multi_vault has no server of its own (it is "serving" another vault),
  // so skipServerCheck bypasses this gate; the model pin (3) and preload
  // (9) are also off for that demo via skipModelPin/preloadChatModel.
  if (!opts.skipServerCheck) {
  const health = await ctx.page.evaluate(async () => {
    const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee?: { settings: { serverUrl: string; manualToken?: string }; serverManager?: { serverUrl?: string }; configureApi?: (u: string) => void; api?: { baseUrl: string; token?: string | null } } } } } }).app.plugins.plugins.lilbee;
    if (!p) return { ok: false, reason: "plugin not loaded" };
    // Give a fresh launch up to 120s for the managed server to come up.
    for (let i = 0; i < 240; i++) {
      // If the server manager has a URL but the api hasn't been wired yet
      // (late READY event), wire it now.
      const smUrl = p.serverManager?.serverUrl;
      if (smUrl && !p.api?.baseUrl && typeof p.configureApi === "function") {
        p.configureApi(smUrl);
      }
      const url = p.api?.baseUrl;
      if (url) {
        try {
          const r = await fetch(url + "/api/health");
          if (r.ok) {
            const j = await r.json();
            return { ok: true, status: j, url };
          }
        } catch {}
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    return { ok: false, reason: "managed server never reported ready (api.baseUrl stayed empty)" };
  });
  if (!(health as { ok: boolean }).ok) {
    throw new Error(`pre-flight: lilbee server not ready: ${JSON.stringify(health)}`);
  }
  }

  // 2. Drain modals + lilbee leaves so layout apply lands clean
  await ctx.page.evaluate(() => {
    document.querySelectorAll(".modal-container").forEach((m) => m.remove());
    document.querySelectorAll(".modal-bg").forEach((m) => m.remove());
    document.querySelectorAll("body > .menu").forEach((m) => m.remove());
    // Toasts too (the external-server-outdated notice is NOTICE_PERMANENT).
    document.querySelectorAll(".notice").forEach((n) => n.remove());
  });

  // 3. Pin model. ALWAYS issue the PUT (don't trust a config-string match):
  // the config can hold a chat_model that's no longer in the installed
  // registry, and PUT /api/models/chat is what actually validates
  // installation. Also assert the target is in the installed-chat list
  // up front so we fail loudly with an actionable message instead of
  // recording a chat that errors with "Internal error" at inference time.
  if (opts.skipModelPin) {
    console.log("pre-flight: skipping chat-model pin (skipModelPin)");
  } else {
  const pinned = await ctx.page.evaluate(async (target) => {
    const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; api?: { baseUrl: string } } } } } }).app.plugins.plugins.lilbee;
    const base = p.api?.baseUrl ?? p.settings.serverUrl;
    const auth = { Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
    // Confirm the target is actually installed for the chat task.
    const inst = await fetch(base + "/api/models/installed?task=chat", { headers: auth }).then((r) => r.json()).catch(() => ({ models: [] }));
    const installed = Array.isArray(inst.models) ? inst.models.map((m: { name?: string }) => m.name) : [];
    if (!installed.includes(target)) {
      return { error: `target not installed`, installed };
    }
    const r = await fetch(base + "/api/models/chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ model: target }),
    });
    return r.json();
  }, wantModel);
  const pinErr = (pinned as { error?: string; installed?: string[] }).error;
  if (pinErr) {
    throw new Error(`pre-flight: ${pinErr}: want ${wantModel}; installed chat models: ${JSON.stringify((pinned as { installed?: string[] }).installed)}`);
  }
  const pinnedModel = (pinned as { model?: string }).model;
  if (pinnedModel !== wantModel) {
    throw new Error(`pre-flight: failed to pin model: got ${pinnedModel}, want ${wantModel}`);
  }
  // Tell the plugin to re-read the active model from the server. Without
  // this the status bar keeps showing whatever model the plugin thought
  // was active before the pin, while the chat header reflects the pin.
  await ctx.page.evaluate(async () => {
    const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { fetchActiveModel?: () => Promise<void> } } } } }).app.plugins.plugins.lilbee;
    if (typeof p.fetchActiveModel === "function") {
      await p.fetchActiveModel();
    }
  });
  }

  // 4. Fresh ingest cleanup
  for (const name of freshIngest) {
    await ctx.page.evaluate(
      async ([n]) => {
        const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; api?: { baseUrl: string } } } } } }).app.plugins.plugins.lilbee;
        await fetch((p.api?.baseUrl ?? p.settings.serverUrl) + "/api/documents/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") },
          body: JSON.stringify({ names: [n], delete_files: false }),
        });
      },
      [name] as const,
    );
  }

  // 4a. Full index clear: killed takes leave stray documents behind, which
  // flattens the next take's ingest section ("unchanged") or shows a
  // pre-filled corpus on camera.
  if (opts.clearIndex) {
    const cleared = await ctx.page.evaluate(async () => {
      const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null } } } } } }).app.plugins.plugins.lilbee;
      const base = p.api?.baseUrl ?? p.settings.serverUrl;
      const auth = { Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
      const docs = await fetch(base + "/api/documents?limit=1000", { headers: auth }).then((r) => r.json());
      const names = (docs.documents ?? []).map((d: { filename: string }) => d.filename);
      if (names.length === 0) return 0;
      await fetch(base + "/api/documents/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ names, delete_files: false }),
      });
      return names.length;
    });
    console.log(`pre-flight: clearIndex removed ${cleared} documents`);
  }

  // 4c. Placement back to auto + fleet genuinely ready. Applying placement in
  // a prior take leaves a manual layout AND a possibly-warming fleet; record
  // only once chat answers AND the embedder serves (a search proves the
  // embed replicas are healthy, not just the proxy).
  if (opts.resetPlacement) {
    const settled = await ctx.page.evaluate(async () => {
      const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; chatWarming?: boolean } } } } }).app.plugins.plugins.lilbee;
      const base = p.api?.baseUrl ?? p.settings.serverUrl;
      const auth = { Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
      const cur = await fetch(base + "/api/placement", { headers: auth }).then((r) => r.json()).catch(() => null);
      if (cur?.manual) {
        await fetch(base + "/api/placement", { method: "DELETE", headers: auth });
      }
      for (let i = 0; i < 400; i++) {
        try {
          const h = await fetch(base + "/api/health", { headers: auth }).then((r) => r.json());
          if (h.chat_ready === true) {
            const s = await fetch(base + "/api/search?q=ready", { headers: auth });
            if (s.ok) {
              p.chatWarming = false;
              return { ok: true, wasManual: !!cur?.manual, polls: i };
            }
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }
      return { ok: false, wasManual: !!cur?.manual };
    });
    if (!(settled as { ok: boolean }).ok) {
      throw new Error(`pre-flight: fleet never settled after placement reset: ${JSON.stringify(settled)}`);
    }
    console.log(`pre-flight: resetPlacement ${JSON.stringify(settled)}`);
  }

  // 4b. Fresh-model cleanup: uninstall the named model so a download demo
  // triggers a real pull every take (models_dir is global, so an install
  // from a prior take would otherwise short-circuit the download).
  //
  // The HTTP DELETE route is {model:str}, so it can't match a slashed repo
  // name (bartowski/SmolLM2-360M-Instruct-GGUF) — both repo and full-name
  // deletes 404. Remove the model's files from the global models dir
  // directly instead; the server reads the manifests dir to decide what's
  // installed, so dropping the manifest + snapshot flips it to not-installed
  // on the next catalog read.
  if (opts.freshModel) {
    const modelsDir = process.env.LILBEE_MODELS_DIR ?? join(homedir(), "Library/Application Support/lilbee/models");
    const slug = opts.freshModel.replace(/\//g, "--");
    for (const sub of [`manifests/${slug}`, `models--${slug}`, `.locks/models--${slug}`]) {
      rmSync(join(modelsDir, sub), { recursive: true, force: true });
    }
    console.log(`pre-flight: freshModel removed files for ${opts.freshModel}`);
  }

  // 5. Apply layout
  await applyLayout(ctx.page, layout);
  await ctx.page.waitForTimeout(450);

  // 6. Task Center: always reset to a known baseline (cancel active + clear
  // history), then for an actively-used demo (clearTaskCenter === false) seed a
  // clean, consistent set of completed tasks so the workspace reads as a vault
  // that's been in use rather than fresh. Clearing first keeps the seeded set
  // from accumulating across recordings.
  //
  // Clear through the taskQueue API, not the view's Clear button: a layout
  // without a tasks leaf has no button, and the stale history then surfaces
  // the moment the demo opens the Task Center mid-take ("failed …", "1h ago").
  const taskState = await ctx.page.evaluate(() => {
    document.querySelectorAll(".lilbee-task-row[data-state=\"active\"] .lilbee-task-cancel").forEach((b) => (b as HTMLElement).click());
    const tq = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { taskQueue?: { cancel?: (id: string) => void; activeIds?: Set<string>; clearHistory?: () => void; history?: unknown[]; notify?: () => void } } } } } }).app.plugins.plugins.lilbee.taskQueue;
    if (!tq) return { cleared: false };
    for (const id of Array.from(tq.activeIds ?? [])) tq.cancel?.(id);
    const before = tq.history?.length ?? 0;
    tq.clearHistory?.();
    tq.notify?.();
    return { cleared: true, historyBefore: before, historyAfter: tq.history?.length ?? 0 };
  });
  console.log(`pre-flight: task center ${JSON.stringify(taskState)}`);
  await ctx.page.waitForTimeout(250);
  if (!clearTaskCenter) {
    await ctx.page.evaluate(() => {
      const tq = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { taskQueue: { enqueue: (n: string, t: string) => string | null; update: (id: string, p: number, d?: string) => void; complete: (id: string) => void } } } } } }).app.plugins.plugins.lilbee.taskQueue;
      const seeds: [string, string, string][] = [
        ["Crawl Chevrolet_Caprice", "crawl", "1 page"],
        ["Adding files", "add", "ingested 1/1 Crown Victoria Owner's Manual.pdf"],
        ["Sync vault", "sync", "synced 4 files"],
      ];
      for (const [name, type, detail] of seeds) {
        const id = tq.enqueue(name, type);
        if (id) {
          tq.update(id, 100, detail);
          tq.complete(id);
        }
      }
    });
    await ctx.page.waitForTimeout(250);
  }

  // 7. Chat clear
  if (clearChat) {
    await ctx.page.evaluate(() => {
      document.querySelectorAll(".lilbee-chat-clear").forEach((b) => (b as HTMLElement).click());
    });
    await ctx.page.waitForTimeout(250);
  }

  // 8. Verify chat header shows the pinned model
  const chatHeader = await ctx.page.evaluate(() => {
    const pill = document.querySelector(".lilbee-chat-model-pill, .lilbee-chat-mode-btn, .workspace-leaf-content[data-type=\"lilbee-chat\"] .lilbee-chat-header")?.textContent;
    return pill?.trim();
  });
  // We don't fail on this — the chat header sometimes lags. But log a warning.
  if (chatHeader && !/8B|Qwen3/i.test(chatHeader)) {
    console.warn(`pre-flight: chat header shows '${chatHeader}', expected Qwen3 8B (may catch up shortly)`);
  }

  // 9. Preload the chat model so the first on-camera prompt streams
  // immediately instead of paying first-token latency live. The
  // request itself returns once the model is loaded.
  if (opts.preloadChatModel ?? true) {
    const t0 = Date.now();
    const ok = await ctx.page.evaluate(async () => {
      const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; api?: { baseUrl: string } } } } } }).app.plugins.plugins.lilbee;
      try {
        const r = await fetch((p.api?.baseUrl ?? p.settings.serverUrl) + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") },
          body: JSON.stringify({ question: "OK", history: [], top_k: 0 }),
        });
        return r.ok;
      } catch {
        return false;
      }
    });
    const ms = Date.now() - t0;
    console.log(`pre-flight: chat model preload ${ok ? "ok" : "failed"} in ${ms} ms`);
  }

  console.log(`pre-flight ok: layout=${layout}, model pinned, ${freshIngest.length} freshIngest removed`);
}
