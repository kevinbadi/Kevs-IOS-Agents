import type { DecisionBackend, SystemOneQuestion, SystemOneResponse } from './types.js';
import { DEFAULT_JEV_MODEL, DEFAULT_JEV_URL, DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_MS } from './config.js';

export class JevError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
    }
}

/** The request hit its deadline. Callers must treat this as "escalate", never as an answer. */
export class JevTimeoutError extends JevError {}

const RETRY_STATUSES = new Set([429, 529]);
const BACKOFF_BASE_MS = 300;

export interface JevClientOptions {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    timeoutMs?: number;
    maxAttempts?: number;
    fetchImpl?: typeof fetch;
    /** Injectable so tests can assert the backoff schedule without waiting. */
    sleep?: (ms: number) => Promise<void>;
}

/**
 * Thin HTTP client for TypeSafe's System One endpoint. One POST per call; the
 * caller batches every question it needs into that one request because
 * questions are evaluated in parallel and each only costs its own tokens.
 */
export class JevClient implements DecisionBackend {
    readonly model: string;
    private readonly apiKey: string;
    private readonly url: string;
    private readonly timeoutMs: number;
    private readonly maxAttempts: number;
    private readonly fetchImpl: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(options: JevClientOptions) {
        if (!options.apiKey) throw new JevError('TYPESAFE_API_KEY is required');
        this.apiKey = options.apiKey;
        this.model = options.model ?? DEFAULT_JEV_MODEL;
        this.url = `${(options.baseUrl ?? DEFAULT_JEV_URL).replace(/\/$/, '')}/v1/systemone`;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    async systemone(state: unknown, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse> {
        const body = JSON.stringify({ model: this.model, state, questions });
        for (let attempt = 1; ; attempt += 1) {
            let response: Response;
            try {
                response = await this.fetchImpl(this.url, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${this.apiKey}`,
                        'content-type': 'application/json',
                    },
                    body,
                    signal: AbortSignal.timeout(this.timeoutMs),
                });
            } catch (error) {
                if (isTimeout(error)) throw new JevTimeoutError(`Jev did not answer within ${this.timeoutMs} ms`);
                throw new JevError(`Jev request failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (RETRY_STATUSES.has(response.status) && attempt < this.maxAttempts) {
                await this.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
                continue;
            }
            const payload = await response.json().catch(() => ({})) as SystemOneResponse & { detail?: { message?: string } | string };
            if (!response.ok) {
                const detail = typeof payload.detail === 'string' ? payload.detail : payload.detail?.message;
                throw new JevError(`Jev returned ${response.status}${detail ? `: ${detail}` : ''}`, response.status);
            }
            if (!payload.answers || typeof payload.answers !== 'object') {
                throw new JevError('Jev returned no answers');
            }
            return payload;
        }
    }
}

function isTimeout(error: unknown): boolean {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
