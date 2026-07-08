// Minimal CDP driver: connect to Obsidian's --remote-debugging-port, eval the
// JS in the file passed as argv[2], print the returned value as JSON. Node 22+
// (uses the global WebSocket). No Origin header is sent, so Electron accepts it.
import { readFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || "9222";

async function pageWsUrl() {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`);
    const targets = await res.json();
    const page = targets.find((t) => t.type === "page" && String(t.url).includes("obsidian.md"));
    if (!page) throw new Error("no obsidian page target: " + JSON.stringify(targets.map((t) => t.url)));
    return page.webSocketDebuggerUrl;
}

const expression = readFileSync(process.argv[2], "utf8");

const url = await pageWsUrl();
const ws = new WebSocket(url);
const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP eval timeout")), 60000);
    ws.addEventListener("open", () => {
        ws.send(
            JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: { expression, returnByValue: true, awaitPromise: true },
            }),
        );
    });
    ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id !== 1) return;
        clearTimeout(timer);
        const r = msg.result || {};
        if (r.exceptionDetails) {
            reject(new Error("eval threw: " + JSON.stringify(r.exceptionDetails)));
        } else {
            resolve(r.result?.value);
        }
        ws.close();
    });
    ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e.message || e))));
});

console.log("RESULT_JSON:" + JSON.stringify(result));
