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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
  clearTaskCenter?: boolean;
  clearChat?: boolean;
  pinChatModel?: string;
  /** Skip the chat-model pin entirely. For demos that don't exercise chat. */
  skipModelPin?: boolean;
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
  // Snapshot vault files first so any garbage typed during the demo
  // can be cleaned up at the end.
  snapshotVaultFiles();

  // first_start runs in a vault where lilbee isn't installed yet.
  // Skip every lilbee-specific check and just bring Obsidian to a
  // known state (drain modals).
  if (opts.noLilbee) {
    await ctx.page.evaluate(() => {
      document.querySelectorAll(".modal-container").forEach((m) => m.remove());
      document.querySelectorAll(".modal-bg").forEach((m) => m.remove());
      document.querySelectorAll("body > .menu").forEach((m) => m.remove());
    });
    console.log(`pre-flight ok (noLilbee): vault clean`);
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

  // 2. Drain modals + lilbee leaves so layout apply lands clean
  await ctx.page.evaluate(() => {
    document.querySelectorAll(".modal-container").forEach((m) => m.remove());
    document.querySelectorAll(".modal-bg").forEach((m) => m.remove());
    document.querySelectorAll("body > .menu").forEach((m) => m.remove());
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

  // 5. Apply layout
  await applyLayout(ctx.page, layout);
  await ctx.page.waitForTimeout(450);

  // 6. Task Center: always reset to a known baseline (cancel active + Clear),
  // then for an actively-used demo (clearTaskCenter === false) seed a clean,
  // consistent set of completed tasks so the workspace reads as a vault that's
  // been in use rather than fresh. Clearing first keeps the seeded set from
  // accumulating across recordings.
  await ctx.page.evaluate(() => {
    document.querySelectorAll(".lilbee-task-row[data-state=\"active\"] .lilbee-task-cancel").forEach((b) => (b as HTMLElement).click());
    const taskLeaf = document.querySelector('.workspace-leaf-content[data-type="lilbee-tasks"]');
    const clearBtn = taskLeaf?.querySelector(".lilbee-tasks-clear");
    (clearBtn as HTMLElement | null)?.click();
  });
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
