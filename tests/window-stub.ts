/** Window stub that inherits live (fake-timer-aware) globals from globalThis. */
export function windowStub(props: Record<string, unknown>): Window {
    return Object.assign(Object.create(globalThis) as object, props) as unknown as Window;
}
