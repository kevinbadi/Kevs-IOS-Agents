/**
 * Local vision-language model behind "Agent (Local)". Talks to an Ollama server
 * on this Mac, so nothing leaves the machine and every step costs $0.
 *
 * Small local models are unreliable with native tool calling once an image is in
 * the prompt, so instead the model is asked for one flat JSON object (enforced by
 * Ollama's structured-output `format`) which is mapped onto the same AgentAction
 * set the cloud agent uses.
 */

import { AGENT_TOOLS, SCROLL_DIRECTIONS, parseAgentAction, toolCallForAction, type AgentAction } from './actions.js';
import { actionTally, MalformedReplyError, systemPrompt, VlmError, type VisionModel, type VlmDecision, type VlmStepRequest } from './vlm.js';

export const DEFAULT_LOCAL_AGENT_MODEL = 'qwen3-vl:8b';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

const TOOL_NAMES = AGENT_TOOLS.map((tool) => tool.name);

/** One flat object: every tool's arguments as optional fields, discriminated by `tool`. */
const DECISION_SCHEMA = {
    type: 'object',
    properties: {
        reasoning: { type: 'string' },
        tool: { type: 'string', enum: TOOL_NAMES },
        x: { type: 'integer' },
        y: { type: 'integer' },
        target: { type: 'string' },
        duration_ms: { type: 'integer' },
        start_x: { type: 'integer' },
        start_y: { type: 'integer' },
        end_x: { type: 'integer' },
        end_y: { type: 'integer' },
        direction: { type: 'string', enum: SCROLL_DIRECTIONS },
        text: { type: 'string' },
        bundle_id: { type: 'string' },
        seconds: { type: 'number' },
        summary: { type: 'string' },
        reason: { type: 'string' },
    },
    required: ['reasoning', 'tool'],
} as const;

function toolReference(): string {
    return AGENT_TOOLS.map((tool) => {
        const args = Object.keys(tool.input_schema.properties).filter((key) => key !== 'reasoning');
        const required = (tool.input_schema.required ?? []).filter((key) => key !== 'reasoning');
        const argList = args.map((key) => (required.includes(key) ? key : `${key}?`)).join(', ');
        return `- ${tool.name}(${argList}): ${tool.description}`;
    }).join('\n');
}

export function localSystemPrompt(screen: { width: number; height: number }): string {
    return [
        systemPrompt(screen),
        '',
        'OUTPUT FORMAT: respond with exactly one JSON object and nothing else:',
        '{"reasoning": "<1-3 short sentences>", "tool": "<tool name>", ...tool arguments}',
        'Put the tool arguments as top-level keys next to "tool" (for example {"reasoning": "...", "tool": "tap", "x": 195, "y": 805, "target": "Create"}).',
        'Available tools:',
        toolReference(),
    ].join('\n');
}

interface OllamaMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: string[];
}

/** Text-only transcript of earlier turns, then the current observation with the only image. */
export function buildLocalMessages(request: VlmStepRequest): OllamaMessage[] {
    const messages: OllamaMessage[] = [{ role: 'system', content: localSystemPrompt(request.screen) }];
    let userText = `GOAL: ${request.goal}`;
    request.history.forEach((turn, index) => {
        const call = toolCallForAction(turn.action, turn.reasoning);
        const { reasoning, ...args } = call.input;
        userText += `\n\nTURN ${index + 1}: foreground app was ${turn.app ?? 'unknown'} (${turn.elementCount} elements; screenshot omitted).`;
        messages.push({ role: 'user', content: userText });
        messages.push({ role: 'assistant', content: JSON.stringify({ reasoning: reasoning ?? '', tool: call.name, ...args }) });
        userText = `RESULT OF TURN ${index + 1}: ${turn.outcome}`;
    });
    userText += [
        '',
        '',
        `TURN ${request.stepIndex + 1} of at most ${request.maxSteps}.`,
        actionTally(request.history),
        request.locked ? 'The device reports it is LOCKED.' : '',
        request.nudge ? `NOTE: ${request.nudge}` : '',
        request.appHints ? `\nAPP HINTS (follow these):\n${request.appHints}` : '',
        '',
        `ON-SCREEN ELEMENTS${request.hierarchyTruncated ? ' (truncated)' : ''}:`,
        request.hierarchy,
        '',
        'The attached image is the CURRENT SCREENSHOT (grid labels are in points). Describe THIS screen in your reasoning —',
        'do not copy your earlier reasoning — and reply with one JSON object.',
    ].filter((line, index) => line !== '' || index < 2).join('\n');
    messages.push({ role: 'user', content: userText, images: [request.screenshot.toString('base64')] });
    return messages;
}

/** Pull the first JSON object out of a reply, tolerating code fences or stray prose. */
export function extractJsonObject(raw: string): Record<string, unknown> {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
        return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start === -1 || end <= start) throw new MalformedReplyError(`Model reply was not JSON: ${trimmed.slice(0, 200)}`);
        try {
            return JSON.parse(trimmed.slice(0, end + 1).slice(start)) as Record<string, unknown>;
        } catch {
            throw new MalformedReplyError(`Model reply was not valid JSON: ${trimmed.slice(0, 200)}`);
        }
    }
}

export function decisionFromJson(payload: Record<string, unknown>): { action: AgentAction; reasoning: string } {
    const { reasoning, tool, ...args } = payload;
    const name = typeof tool === 'string' ? tool.trim() : '';
    const thought = typeof reasoning === 'string' ? reasoning.trim() : '';
    if (!TOOL_NAMES.includes(name)) throw new MalformedReplyError(`Model picked an unknown tool "${name}"`, thought);
    // Drop empty strings / nulls so optional fields fall back to defaults.
    const input = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== '' && value !== undefined));
    let action: AgentAction;
    try {
        action = parseAgentAction(name, input);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new MalformedReplyError(`Model returned an invalid ${name}: ${detail} (got ${JSON.stringify(input).slice(0, 160)})`, thought);
    }
    return { action, reasoning: thought };
}

interface OllamaChatResponse {
    message?: { role: string; content: string; thinking?: string };
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number;
    error?: string;
}

export interface OllamaHealth {
    reachable: boolean;
    version: string | null;
    models: string[];
    hasModel: boolean;
    error: string | null;
}

export class OllamaVisionModel implements VisionModel {
    readonly model: string;
    readonly baseUrl: string;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;
    private readonly numCtx: number;

    constructor(options: { model?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; numCtx?: number } = {}) {
        this.model = options.model ?? DEFAULT_LOCAL_AGENT_MODEL;
        this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, '');
        this.fetchImpl = options.fetchImpl ?? fetch;
        // Local generation on a laptop-class GPU is slow; a screenshot turn can take a minute.
        this.timeoutMs = options.timeoutMs ?? 240_000;
        this.numCtx = options.numCtx ?? 16_384;
    }

    async health(): Promise<OllamaHealth> {
        const base: OllamaHealth = { reachable: false, version: null, models: [], hasModel: false, error: null };
        try {
            const [versionRes, tagsRes] = await Promise.all([
                this.fetchImpl(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(3_000) }),
                this.fetchImpl(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) }),
            ]);
            const version = await versionRes.json().catch(() => ({})) as { version?: string };
            const tags = await tagsRes.json().catch(() => ({})) as { models?: Array<{ name?: string; model?: string }> };
            const models = (tags.models ?? []).map((entry) => entry.name ?? entry.model ?? '').filter(Boolean);
            const wanted = this.model.includes(':') ? this.model : `${this.model}:latest`;
            return {
                reachable: true,
                version: version.version ?? null,
                models,
                hasModel: models.some((name) => name === wanted || name === this.model),
                error: null,
            };
        } catch (error) {
            return { ...base, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async decide(request: VlmStepRequest): Promise<VlmDecision> {
        const body = {
            model: this.model,
            stream: false,
            format: DECISION_SCHEMA,
            keep_alive: '30m',
            // Qwen3-VL ships as a "thinking" model: left on, it burns the whole output
            // budget on hidden reasoning and returns an empty answer. The JSON
            // `reasoning` field is all the deliberation we want.
            think: false,
            options: { temperature: 0.1, num_ctx: this.numCtx, num_predict: 600 },
            messages: buildLocalMessages(request),
        };
        let response: Response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new VlmError(/fetch failed|ECONNREFUSED/i.test(message)
                ? `Ollama is not reachable at ${this.baseUrl}. Start it with \`brew services start ollama\` (or \`ollama serve\`).`
                : `Local model request failed: ${message}`);
        }
        const payload = await response.json().catch(() => ({})) as OllamaChatResponse;
        if (!response.ok) {
            const detail = payload.error ?? `HTTP ${response.status}`;
            throw new VlmError(/not found/i.test(detail)
                ? `Model ${this.model} is not downloaded. Run \`ollama pull ${this.model}\`.`
                : `Local model returned an error: ${detail}`);
        }
        let content = payload.message?.content ?? '';
        const thinking = payload.message?.thinking ?? '';
        if (!content.trim() && /\{[\s\S]*"tool"[\s\S]*\}/.test(thinking)) content = thinking;
        const usage = { inputTokens: payload.prompt_eval_count ?? 0, outputTokens: payload.eval_count ?? 0 };
        if (!content.trim()) {
            throw new MalformedReplyError(thinking
                ? 'Local model spent its whole reply thinking and returned no action'
                : 'Local model returned an empty reply', '', usage);
        }
        try {
            const decision = decisionFromJson(extractJsonObject(content));
            return { ...decision, usage, raw: payload };
        } catch (error) {
            // Attach the tokens this wasted turn cost so the run's tally stays honest.
            if (error instanceof MalformedReplyError) throw new MalformedReplyError(error.message, error.reasoning, usage);
            throw error;
        }
    }
}

/** Build the local model from the environment. Always returns a model; readiness is checked via health(). */
export function localVisionModelFromEnv(env: NodeJS.ProcessEnv = process.env): OllamaVisionModel {
    return new OllamaVisionModel({
        model: env.AGENT_LOCAL_MODEL?.trim() || DEFAULT_LOCAL_AGENT_MODEL,
        baseUrl: env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL,
    });
}
