/**
 * The server's route contract, read from the `openapi.json` a lilbee release attaches.
 *
 * Each operation says whether it streams (a response declares `text/event-stream`) and,
 * when its success body is one modelled object, the shape of each field. A multi-segment
 * path param carries `format: path` in the schema, and comes back here as `{name:path}`,
 * because OpenAPI writes it as `{name}`, the same as a one-segment param.
 */
import spec from "./fixtures/openapi.json";

/** The JSON shape a response field lands in: only `array` is asserted. */
type FieldKind = "array" | "other";
interface Operation {
    streams: boolean;
    fields?: Record<string, FieldKind>;
}

interface Schema {
    $ref?: string;
    type?: string | string[];
    properties?: Record<string, Schema>;
    oneOf?: Schema[];
    anyOf?: Schema[];
    additionalProperties?: unknown;
    format?: string;
}
interface Parameter {
    name: string;
    in: string;
    schema?: Schema;
}
interface MediaTypes {
    [mediaType: string]: { schema?: Schema };
}
interface SpecOperation {
    parameters?: Parameter[];
    responses?: Record<string, { content?: MediaTypes }>;
}
interface Spec {
    paths: Record<string, Record<string, SpecOperation>>;
    components: { schemas: Record<string, Schema> };
}

const SCHEMA = spec as unknown as Spec;
const SSE = "text/event-stream";
const JSON_BODY = "application/json";

/** Follow a `#/components/schemas/...` reference to the schema it names. */
function resolve(schema: Schema): Schema {
    let current = schema;
    while (current.$ref !== undefined) {
        const name = current.$ref.split("/").pop() ?? "";
        current = SCHEMA.components.schemas[name] ?? {};
    }
    return current;
}

/** Drop the `null` arm of an optional field; `null` for a union of more than one real arm. */
function withoutNull(schema: Schema): Schema | null {
    const arms = schema.oneOf ?? schema.anyOf;
    if (arms === undefined) return schema;
    const real = arms.filter((arm) => arm.type !== "null");
    return real.length === 1 ? resolve(real[0]) : null;
}

function kind(schema: Schema): FieldKind {
    return withoutNull(resolve(schema))?.type === "array" ? "array" : "other";
}

/** The field shapes of the one modelled object a success answers with, if there is one. */
function fields(operation: SpecOperation): Record<string, FieldKind> | undefined {
    const bodies = Object.entries(operation.responses ?? {})
        .filter(([status]) => status.startsWith("2"))
        .map(([, response]) => response.content?.[JSON_BODY]?.schema)
        .filter((schema): schema is Schema => schema !== undefined);
    if (bodies.length !== 1) return undefined;
    const body = withoutNull(resolve(bodies[0]));
    if (body?.properties === undefined || body.additionalProperties === true) return undefined;
    return Object.fromEntries(Object.entries(body.properties).map(([name, field]) => [name, kind(field)]));
}

function streams(operation: SpecOperation): boolean {
    return Object.values(operation.responses ?? {}).some((response) => SSE in (response.content ?? {}));
}

/** The path with every multi-segment param written `{name:path}`. */
function template(path: string, operations: Record<string, SpecOperation>): string {
    const greedy = new Set(
        Object.values(operations)
            .flatMap((operation) => operation.parameters ?? [])
            .filter((param) => param.in === "path" && param.schema?.format === "path")
            .map((param) => param.name),
    );
    return path.replace(/\{([^}]+)\}/g, (whole, name: string) => (greedy.has(name) ? `{${name}:path}` : whole));
}

function buildOperations(): Record<string, Record<string, Operation>> {
    const result: Record<string, Record<string, Operation>> = {};
    for (const [path, operations] of Object.entries(SCHEMA.paths)) {
        const methods: Record<string, Operation> = {};
        for (const [method, operation] of Object.entries(operations)) {
            const shape = fields(operation);
            methods[method.toUpperCase()] = { streams: streams(operation), ...(shape && { fields: shape }) };
        }
        result[template(path, operations)] = methods;
    }
    return result;
}

export const OPERATIONS = buildOperations();
