import { node } from "../binary-manager";

/** Append to a log file, first trimming it to its newest `maxBytes` tail. Never throws. */
export function appendCapped(path: string, chunk: string, maxBytes: number): void {
    try {
        const dir = node.dirname(path);
        if (!node.existsSync(dir)) node.mkdirSync(dir, { recursive: true });
        if (node.existsSync(path) && node.statSync(path).size > maxBytes) {
            const content = node.readFileSync(path, "utf-8");
            node.writeFileSync(path, content.slice(-maxBytes));
        }
        node.appendFileSync(path, chunk);
    } catch {
        // capture must never break the caller
    }
}
