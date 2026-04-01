/**
 * Result<T, E> - A type-safe container for either a success value or an error.
 * Eliminates verbose try-catch boilerplate for expected error paths.
 */

export type Result<T, E = Error> = ResultOk<T, E> | ResultErr<T, E>;

export interface ResultOk<T, E> {
  readonly ok: true;
  readonly value: T;
}

export interface ResultErr<T, E> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T, E = Error>(value: T): Result<T, E> {
  return { ok: true, value };
}

export function err<T, E = Error>(error: E): Result<T, E> {
  return { ok: false, error };
}

export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export function tryCatchSync<T>(fn: () => T): Result<T, Error> {
  try {
    const value = fn();
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export function isOk<T, E>(result: Result<T, E>): result is ResultOk<T, E> {
  return result.ok === true;
}

export function isErr<T, E>(result: Result<T, E>): result is ResultErr<T, E> {
  return result.ok === false;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (!result.ok) {
    return err(fn(result.error));
  }
  return result;
}

export function getOrElse<T, E>(result: Result<T, E>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export function ifErr<T, E>(result: Result<T, E>, fn: (error: E) => void): void {
  if (!result.ok) {
    fn(result.error);
  }
}
