/**
 * @deprecated Use neverthrow directly: import { Result, ok, err } from "neverthrow";
 * This file re-exports neverthrow for backward compatibility during migration.
 */
import { Result as NTResult, ok as ntOk, err as ntErr, fromThrowable } from "neverthrow";

export type Result<T, E = Error> = NTResult<T, E> & { ok: boolean; value?: T; error?: E };
export const ok = ntOk;
export const err = ntErr;
export { fromThrowable };

// Provide tryCatch for backward compatibility - wraps Result to add .ok, .value, .error
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
    try {
        const value = await fn();
        const result = ok(value);
        // Add compatibility properties
        return Object.assign(result, { ok: true, value });
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        const result = err(error);
        // Add compatibility properties
        return Object.assign(result, { ok: false, error });
    }
}

// Compatibility helpers - neverthrow uses .isOk() and .isErr() methods
export const isOk = <T, E>(r: Result<T, E>): boolean => r.isOk();
export const isErr = <T, E>(r: Result<T, E>): boolean => r.isErr();

export type Ok<T, E> = import("neverthrow").Ok<T, E>;
export type Err<T, E> = import("neverthrow").Err<T, E>;
