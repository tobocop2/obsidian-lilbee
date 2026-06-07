/** Minimal Result type (neverthrow-compatible subset), kept local so the bundle stays free of transpiled helpers. */
export type Result<T, E> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
    constructor(readonly value: T) {}

    isOk(): this is Ok<T, E> {
        return true;
    }

    isErr(): this is Err<T, E> {
        return false;
    }

    _unsafeUnwrap(): T {
        return this.value;
    }

    _unsafeUnwrapErr(): E {
        throw new Error("Called _unsafeUnwrapErr on an Ok value");
    }
}

export class Err<T, E> {
    constructor(readonly error: E) {}

    isOk(): this is Ok<T, E> {
        return false;
    }

    isErr(): this is Err<T, E> {
        return true;
    }

    _unsafeUnwrap(): T {
        throw new Error("Called _unsafeUnwrap on an Err value");
    }

    _unsafeUnwrapErr(): E {
        return this.error;
    }
}

export function ok<T, E = never>(value: T): Ok<T, E> {
    return new Ok(value);
}

export function err<T = never, E = unknown>(error: E): Err<T, E> {
    return new Err(error);
}
