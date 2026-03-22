import { Notice } from "obsidian";
import { NOTICE } from "./types";
import type { QueuedPull } from "./types";

export class PullQueue {
    private pulling = false;
    private queue: QueuedPull[] = [];

    get isPulling(): boolean {
        return this.pulling;
    }

    async enqueue(run: () => Promise<void>, modelName: string): Promise<void> {
        if (this.pulling) {
            this.queue.push({ run, modelName });
            new Notice(`${NOTICE.PULL_QUEUED}: ${modelName}`);
            return;
        }
        this.pulling = true;
        try {
            await run();
        } finally {
            this.pulling = false;
            await this.runNext();
        }
    }

    private async runNext(): Promise<void> {
        const next = this.queue.shift();
        if (next) {
            return this.enqueue(next.run, next.modelName);
        }
    }
}
