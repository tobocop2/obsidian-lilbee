/**
 * Checks each example profile answer against the response schema `openapi.json` gives its
 * route and status. A server change to a profile response shape, or to the errors a route
 * answers, fails here instead of leaving the examples the other tests replay out of date.
 */
import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import spec from "./fixtures/openapi.json";
import { EXAMPLES } from "./profile-fixtures";

interface SpecResponse {
    content?: Record<string, unknown>;
}
interface Spec {
    paths: Record<string, Record<string, { responses?: Record<string, SpecResponse> }>>;
}

const SCHEMA = spec as unknown as Spec;
const JSON_BODY = "application/json";
// strict: false, because the document is OpenAPI, not a bare JSON Schema; formats such as
// `path` describe a param, not a value ajv can check.
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema(spec, "openapi");

/** A JSON pointer to *parts*, escaped as RFC 6901 asks. */
function pointer(parts: string[]): string {
    return parts.map((part) => part.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

/** The reference to the body schema the route documents for *status*, if it documents one. */
function bodySchema(route: string, method: string, status: number): string | undefined {
    const verb = method.toLowerCase();
    const content = SCHEMA.paths[route]?.[verb]?.responses?.[String(status)]?.content;
    if (content === undefined) return undefined;
    const mediaType = JSON_BODY in content ? JSON_BODY : Object.keys(content)[0];
    return `openapi#/${pointer(["paths", route, verb, "responses", String(status), "content", mediaType, "schema"])}`;
}

const ROUTED = Object.entries(EXAMPLES).filter(([, example]) => example.route !== null);

describe("profile examples", () => {
    it.each(ROUTED)("%s matches the body its route documents", (_label, example) => {
        const ref = bodySchema(example.route!, example.method, example.status);
        expect(ref, `${example.method} ${example.route} documents no ${example.status} body`).toBeDefined();
        const validate = ajv.getSchema(ref!)!;
        const valid = validate(example.body);
        expect(valid, ajv.errorsText(validate.errors)).toBe(true);
    });
});
