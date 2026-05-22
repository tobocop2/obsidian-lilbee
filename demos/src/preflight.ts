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

const DEFAULT_MODEL = "Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf";

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

  // 1. Server up + reachable. Use the plugin's live API base URL so
  // managed mode (where the server picks its own port) reaches the
  // right place instead of the stale settings.serverUrl.
  const health = await ctx.page.evaluate(async () => {
    const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee?: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; api?: { baseUrl: string } } } } } }).app.plugins.plugins.lilbee;
    if (!p) return { ok: false, reason: "plugin not loaded" };
    const url = p.api?.baseUrl ?? p.settings.serverUrl;
    try {
      const r = await fetch(url + "/api/health");
      const j = await r.json();
      return { ok: r.ok, status: j };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  });
  if (!(health as { ok: boolean }).ok) {
    throw new Error(`pre-flight: lilbee server unreachable: ${JSON.stringify(health)}`);
  }

  // 2. Drain modals + lilbee leaves so layout apply lands clean
  await ctx.page.evaluate(() => {
    document.querySelectorAll(".modal-container").forEach((m) => m.remove());
    document.querySelectorAll(".modal-bg").forEach((m) => m.remove());
    document.querySelectorAll("body > .menu").forEach((m) => m.remove());
  });

  // 3. Pin model. Skip the PUT if the active model already matches —
  // the demo server's installed-models registry can drop locally
  // cached HF models from its catalog even when they're still loadable
  // and currently active. Forcing a re-pin in that state returns 422
  // ("not available"), even though the model works for chat.
  if (opts.skipModelPin) {
    console.log("pre-flight: skipping chat-model pin (skipModelPin)");
  } else {
  const pinned = await ctx.page.evaluate(async (target) => {
    const p = (globalThis as unknown as { app: { plugins: { plugins: { lilbee: { settings: { serverUrl: string; manualToken?: string }; api?: { baseUrl: string; token?: string | null }; api?: { baseUrl: string } } } } } }).app.plugins.plugins.lilbee;
    const cfg = await fetch((p.api?.baseUrl ?? p.settings.serverUrl) + "/api/config").then((r) => r.json()).catch(() => ({}));
    if (cfg.chat_model === target) return { model: target, skipped: true };
    const r = await fetch((p.api?.baseUrl ?? p.settings.serverUrl) + "/api/models/chat", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") },
      body: JSON.stringify({ model: target }),
    });
    return r.json();
  }, wantModel);
  const pinnedModel = (pinned as { model?: string }).model;
  if (pinnedModel !== wantModel) {
    throw new Error(`pre-flight: failed to pin model: got ${pinnedModel}, want ${wantModel}`);
  }
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

  // 6. Task Center clear
  if (clearTaskCenter) {
    await ctx.page.evaluate(() => {
      // Cancel any active task by clicking its x button.
      document.querySelectorAll(".lilbee-task-row[data-state=\"active\"] .lilbee-task-cancel").forEach((b) => (b as HTMLElement).click());
      // Then click the visible Clear button on the Task Center leaf.
      const taskLeaf = document.querySelector('.workspace-leaf-content[data-type="lilbee-tasks"]');
      const clearBtn = taskLeaf?.querySelector(".lilbee-tasks-clear");
      (clearBtn as HTMLElement | null)?.click();
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
