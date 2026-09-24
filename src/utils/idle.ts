export class StreamIdleError extends Error {
    constructor(timeoutMs: number) {
        super(`stream idle for ${Math.round(timeoutMs / 1000)}s`);
        this.name = "StreamIdleError";
    }
}

export async function* withIdleTimeout<T>(
    gen: AsyncGenerator<T, void>,
    timeoutMs: number,
    abort: () => void,
): AsyncGenerator<T> {
    const iter = gen[Symbol.asyncIterator]();
    while (true) {
        let timer: number | null = null;
        const idle = new Promise<"idle">((resolve) => {
            timer = window.setTimeout(() => resolve("idle"), timeoutMs);
        });
        const race = await Promise.race([iter.next(), idle]);
        // Guard against vitest's fake-timer lifecycle leaving clearTimeout undefined
        // across test-file boundaries; in production both are always defined.
        if (timer !== null && typeof clearTimeout === "function") window.clearTimeout(timer);
        if (race === "idle") {
            abort();
            // Fire-and-forget: iter.return() lets the source generator exit its
            // try/finally blocks, but we don't await it — when the underlying
            // fetch is aborted mid-read, the current iter.next() may hang, and
            // awaiting return() would hang with it. abort() already propagates.
            void iter.return?.(undefined);
            throw new StreamIdleError(timeoutMs);
        }
        const { done, value } = race;
        if (done) return;
        yield value;
    }
}
