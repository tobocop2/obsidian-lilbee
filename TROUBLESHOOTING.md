# Troubleshooting

When something breaks, this page gets you from "it doesn't work" to a bug report with the right logs attached. Start with the diagnostics export; everything after that is for digging deeper yourself.

This covers the plugin side. For the lilbee engine itself (indexing, retrieval, model errors), see the [server troubleshooting guide](https://github.com/tobocop2/lilbee/blob/main/TROUBLESHOOTING.md).

## Start here: Export diagnostics

**One click collects everything a bug report needs.** Three ways to run it:

- **Settings → lilbee → Diagnostics → Export diagnostics**
- Command palette: `Cmd/Ctrl + P` → **lilbee: Export diagnostics**
- The **Export diagnostics** link on a server-crash notice

The export writes a zip to your **Downloads** folder (falling back to the vault's lilbee data folder if Downloads doesn't exist), reveals it in Finder / Explorer, and copies a human-readable summary to your clipboard, ready to paste into a GitHub issue.

Inside the zip:

- `summary.md`, a human-readable overview of versions, settings, and recent errors
- `logs/server.log`, `logs/server-fault.log`, `logs/worker-*.log`, `logs/spawn-crash.log`, `logs/plugin.log` (see [Where the logs live](#where-the-logs-live))
- `config.toml` and your plugin settings, with secrets redacted
- Environment info (OS, plugin and server versions)

> **Review before sharing.** Tokens and API keys are redacted automatically, but file paths and note titles are not. Skim the zip before attaching it anywhere public.

## Reading errors in the developer console

Obsidian ships Chromium's developer tools, and the plugin logs everything there with a `[lilbee]` prefix.

1. Open the console: `Cmd + Opt + I` (macOS) or `Ctrl + Shift + I` (Windows / Linux).
2. Switch to the **Console** tab and type `[lilbee]` into the filter box.

A few snippets worth pasting into the console:

```js
// Last output from the managed server (in-memory buffer)
app.plugins.plugins.lilbee.serverManager?.lastOutput

// Current server state: "stopped", "starting", "ready", or "error"
app.plugins.plugins.lilbee.serverManager?.state

// Where this vault's server data lives
app.plugins.plugins.lilbee.serverManager?.dataDir

// Installed plugin version
app.plugins.plugins.lilbee.manifest.version
```

## Where the logs live

All vaults on a machine share one lilbee install. The shared root is:

| OS | Shared root |
|----|-------------|
| **macOS** | `~/Library/Application Support/lilbee` |
| **Windows** | `%LOCALAPPDATA%\lilbee` |
| **Linux** | `~/.local/share/lilbee` (`XDG_DATA_HOME` respected) |

Each vault keeps its own data under `<shared root>/vaults/<id>/`, and the server binary lives at `<shared root>/bin/lilbee`. The logs are in `vaults/<id>/logs/`:

| File | What's in it |
|------|--------------|
| `server.log` | The lilbee server's main log |
| `server-fault.log` | Native crash tracebacks |
| `worker-*.log` | Model subprocess logs, one per worker |
| `spawn-crash.log` | output the plugin captured when the managed server died, with the exit code or signal |
| `plugin.log` | The plugin's own error journal |

You don't have to guess the `<id>`: **Settings → lilbee** shows the resolved shared root and this vault's data folder in the storage section.

## Running the server by hand

When the managed server won't start and the logs don't say why, run it in a terminal with debug logging and watch the output directly. **Close Obsidian first**, so the two don't fight over the same data dir.

macOS / Linux:

```bash
LILBEE_LOG_LEVEL=DEBUG "<shared root>/bin/lilbee" serve --data-dir "<vault data dir>"
```

Windows (PowerShell):

```powershell
$env:LILBEE_LOG_LEVEL="DEBUG"; & "$env:LOCALAPPDATA\lilbee\bin\lilbee.exe" serve --data-dir "<vault data dir>"
```

Fill in both paths from the settings tab's storage section. If it crashes here too, the terminal output is exactly what a bug report needs.

## Common causes

- **macOS Gatekeeper.** The server binary is unsigned, and the plugin clears the quarantine flag automatically. If macOS still blocks it: System Settings → Privacy & Security → **Allow Anyway**.
- **Antivirus / SmartScreen on Windows.** Some scanners quarantine the freshly downloaded exe. Add an exclusion for `%LOCALAPPDATA%\lilbee\bin` and re-run the download from settings.
- **Outdated NVIDIA drivers.** The CUDA build needs current drivers; update them if the server crashes on startup with a GPU error.
- **Intel Macs aren't supported in managed mode.** Managed mode covers Apple Silicon Macs, Linux x64, and Windows x64. On an Intel Mac, use external mode: `pip install lilbee`, run `lilbee serve` yourself, and point the plugin at it from Settings → Connection.
- **Disk space.** Models run from hundreds of MB to several GB each. A download or index job failing partway through is often just a full disk.
- **RAM / VRAM exhaustion.** Crashes during chat or indexing usually mean the model doesn't fit in memory. Try a smaller model from the catalog, or close other heavy apps.
- **Linux: the OOM killer.** If the server dies with `signal SIGKILL` in `spawn-crash.log` and nothing in its own logs, the kernel likely reclaimed its memory. Check with `journalctl -k | grep -i oom`, then free up RAM or pick smaller models.
- **Linux: SELinux denials.** Fedora and RHEL enforce SELinux. If the server never launches and `spawn-crash.log` shows a permission error, check for denials with `sudo ausearch -m avc -ts recent`.
- **Linux: missing Vulkan loader.** If the server starts fine but every model fails to load, install the Vulkan loader once: `sudo dnf install vulkan-loader` (Fedora / RHEL), `sudo apt-get install libvulkan1` (Debian / Ubuntu), `sudo pacman -S vulkan-icd-loader` (Arch).
- **Linux: a corrupted unpack cache.** The first launch unpacks the server binary into `~/.cache/lilbee/<version>`. A partial unpack (full disk, crash mid-launch) can make every later launch die instantly. Delete that folder and the next launch unpacks fresh.

## Clean reset

If the install seems wrecked and you'd rather start over than debug:

1. Quit Obsidian.
2. Rename the shared lilbee folder (paths in the table above), e.g. to `lilbee.bak`.
3. Restart Obsidian. The plugin downloads a fresh server, models re-download, and the index rebuilds on the next sync.

**Your notes are never touched.** Everything under the shared folder is derived data: the server binary, the model cache, and the index. Once you've confirmed the fresh install works, delete the renamed folder.
