/**
 * Pinned on purpose: "jev-latest" can change under us between runs, and the
 * escalation-rate telemetry is only comparable across a fixed model.
 * (`/v1/models` lists the alias, but the decision endpoint accepts the full
 * `jev-1.13.0` id; `jev-1.13` without the patch is rejected as unknown.)
 */
export const DEFAULT_JEV_MODEL = 'jev-1.13.0';
export const DEFAULT_JEV_URL = 'https://api.typesafe.ai';
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
export const DEFAULT_FIT_THRESHOLD = 0.5;
export const DEFAULT_TIMEOUT_MS = 3_000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export interface DecisionsConfig {
    /** Null → decisions unavailable; plugins use their existing logic. */
    apiKey: string | null;
    model: string;
    baseUrl: string;
    /** Choice confidence below this escalates. */
    confidenceThreshold: number;
    /** Paired "does anything fit?" Noul below this escalates. */
    fitThreshold: number;
    /** Per-attempt deadline; a timeout is an escalation, never a verdict. */
    timeoutMs: number;
    /** Attempts on 429 / 529 (exponential backoff between them). */
    maxAttempts: number;
}

function numberOr(value: string | undefined, fallback: number, range: [number, number]): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < range[0] || parsed > range[1]) return fallback;
    return parsed;
}

export function decisionsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DecisionsConfig {
    const apiKey = env.TYPESAFE_API_KEY?.trim() || null;
    return {
        apiKey,
        model: env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL,
        baseUrl: (env.TYPESAFE_API_URL?.trim() || DEFAULT_JEV_URL).replace(/\/$/, ''),
        confidenceThreshold: numberOr(env.DECISIONS_CONFIDENCE_THRESHOLD, DEFAULT_CONFIDENCE_THRESHOLD, [0, 1]),
        fitThreshold: numberOr(env.DECISIONS_FIT_THRESHOLD, DEFAULT_FIT_THRESHOLD, [0, 1]),
        timeoutMs: numberOr(env.DECISIONS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, [100, 60_000]),
        maxAttempts: numberOr(env.DECISIONS_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, [1, 10]),
    };
}
