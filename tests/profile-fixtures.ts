/**
 * Example `/api/profiles` answers. `profile-examples.test.ts` checks each body against the
 * route's response schema in `openapi.json`, so a server change to a shape fails there.
 */
import examples from "./fixtures/profile-examples.json";
import type { MockElement } from "./__mocks__/obsidian";
import { SERVER_STATUS_PREFIX } from "../src/types";
import type {
    ActiveProfileResponse,
    ProfileApplyResponse,
    ProfileDiffResponse,
    ProfileListResponse,
} from "../src/types";

export type Label = keyof typeof examples;

/** One example answer: the request it answers, by route template, and what came back. */
export interface Example {
    method: string;
    /** The OpenAPI path; null for a route a server without profiles lacks. */
    route: string | null;
    status: number;
    body: unknown;
    content_disposition?: string;
}

export const EXAMPLES = examples as Record<Label, Example>;

/** The example answer to one request, as fetch would hand it over. */
export function served(label: Label): Response {
    const entry = EXAMPLES[label];
    const text = typeof entry.body === "string" ? entry.body : JSON.stringify(entry.body);
    const headers = new Headers();
    if (entry.content_disposition !== undefined) headers.set("Content-Disposition", entry.content_disposition);
    return new Response(text, { status: entry.status, headers });
}

/** The error the client throws for an example refusal. */
export function refusal(label: Label): Error {
    const entry = EXAMPLES[label];
    return new Error(`${SERVER_STATUS_PREFIX} ${entry.status}: ${JSON.stringify(entry.body)}`);
}

export const LIST = examples.list.body as ProfileListResponse;
export const ACTIVE_DEFAULT = examples.active_default.body as ActiveProfileResponse;
export const ACTIVE_APPLIED = examples.active_applied.body as ActiveProfileResponse;
export const ACTIVE_SAVED = examples.active_saved.body as ActiveProfileResponse;
export const DIFF = examples.diff.body as ProfileDiffResponse;
export const DIFF_ACTIVE = examples.diff_active.body as ProfileDiffResponse;
export const DIFF_SAVED = examples.diff_saved.body as ProfileDiffResponse;
export const APPLY = examples.apply.body as ProfileApplyResponse;

/** *active* as a server that predates `changes` would send it. */
export function withoutChanges(active: ActiveProfileResponse): ActiveProfileResponse {
    const { changes: _changes, ...rest } = active;
    return rest;
}

/** Every element under *el* with the tag, depth first. */
export function byTag(el: MockElement, tag: string): MockElement[] {
    const found = el.tagName === tag.toUpperCase() ? [el] : [];
    for (const child of el.children) found.push(...byTag(child, tag));
    return found;
}

/** The button under *el* with exactly this label. */
export function button(el: MockElement, label: string): MockElement | undefined {
    return byTag(el, "button").find((b) => b.textContent === label);
}

/** Every button label under *el*, in order. */
export function buttonLabels(el: MockElement): string[] {
    return byTag(el, "button").map((b) => b.textContent);
}
