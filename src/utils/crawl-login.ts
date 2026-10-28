import { MESSAGES } from "../locales/en";
import type { CrawlLogin } from "../types";

const LAST_CONTROL_CHARACTER = 0x1f;
const DELETE_CHARACTER = 0x7f;
const LAST_ASCII_CHARACTER = 0x7f;

/** Fields whose values go into an HTTP header, so they must be ASCII. */
const HEADER_FIELDS = ["authorization", "cookie"] as const;

const FIELD_LABELS: Record<keyof CrawlLogin, string> = {
    authorization: MESSAGES.LABEL_CRAWL_LOGIN_AUTHORIZATION,
    username: MESSAGES.LABEL_CRAWL_LOGIN_USERNAME,
    password: MESSAGES.LABEL_CRAWL_LOGIN_PASSWORD,
    cookie: MESSAGES.LABEL_CRAWL_LOGIN_COOKIE,
};

export interface CrawlLoginResult {
    login: CrawlLogin | null;
    error: string | null;
}

function hasControlCharacter(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= LAST_CONTROL_CHARACTER || code === DELETE_CHARACTER) return true;
    }
    return false;
}

function isAscii(value: string): boolean {
    for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > LAST_ASCII_CHARACTER) return false;
    return true;
}

/** Check the typed login the way the server does; an error names a field, never its value. */
export function buildCrawlLogin(input: CrawlLogin): CrawlLoginResult {
    const login: CrawlLogin = {
        authorization: input.authorization.trim(),
        username: input.username,
        password: input.password,
        cookie: input.cookie.trim(),
    };
    if (Object.values(login).every((value) => value === "")) return { login: null, error: null };
    for (const field of Object.keys(login) as Array<keyof CrawlLogin>) {
        if (hasControlCharacter(login[field])) {
            return { login: null, error: MESSAGES.ERROR_CRAWL_LOGIN_CONTROL_CHARACTER(FIELD_LABELS[field]) };
        }
    }
    for (const field of HEADER_FIELDS) {
        if (!isAscii(login[field])) {
            return { login: null, error: MESSAGES.ERROR_CRAWL_LOGIN_NOT_ASCII(FIELD_LABELS[field]) };
        }
    }
    if (login.password !== "" && login.username === "") {
        return { login: null, error: MESSAGES.ERROR_CRAWL_LOGIN_PASSWORD_NEEDS_USERNAME };
    }
    if (login.authorization !== "" && login.username !== "") {
        return { login: null, error: MESSAGES.ERROR_CRAWL_LOGIN_AUTHORIZATION_AND_USERNAME };
    }
    return { login, error: null };
}
