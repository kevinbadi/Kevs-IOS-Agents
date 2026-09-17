/**
 * Vision-language model behind agent mode. Talks to the Anthropic Messages API
 * directly (no SDK) so the only configuration is ANTHROPIC_API_KEY in .env.
 */

import { AGENT_TOOLS, parseAgentAction, toolCallForAction, type AgentAction } from './actions.js';

export const DEFAULT_AGENT_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface VlmUsage {
    inputTokens: number;
    outputTokens: number;
}

export interface VlmDecision {
    action: AgentAction;
    reasoning: string;
    usage: VlmUsage;
    raw?: unknown;
}

/** One earlier turn, replayed to the model as its own tool call plus what happened. */
export interface PriorTurn {
    app: string | null;
    elementCount: number;
    reasoning: string;
    action: AgentAction;
    /** Short outcome, e.g. "Executed." or "FAILED: Touch coordinates are outside the device screen". */
    outcome: string;
}

export interface VlmStepRequest {
    goal: string;
    stepIndex: number;
    maxSteps: number;
    screen: { width: number; height: number };
    /** JPEG bytes, already downscaled and grid-annotated. */
    screenshot: Buffer;
    hierarchy: string;
    hierarchyTruncated: boolean;
    history: PriorTurn[];
    locked: boolean;
    nudge?: string;
}

export interface VisionModel {
    readonly model: string;
    decide(request: VlmStepRequest): Promise<VlmDecision>;
}

export class VlmError extends Error {}

export function systemPrompt(screen: { width: number; height: number }): string {
    return [
        'You are an autonomous agent operating a real iPhone through WebDriverAgent.',
        `The screen is ${screen.width}×${screen.height} points. Every coordinate you output is in points, origin top-left.`,
        `The screenshot image is larger than the point screen; never read raw image pixels — use the grid labels`,
        `(which are in points) or the element centres from the hierarchy. No x may exceed ${screen.width}, no y ${screen.height}.`,
        'Each turn you receive a fresh observation: which app is in the foreground, a compact list of on-screen elements',
        'from the accessibility tree ("Type \\"label\\" @(centerX,centerY) widthxheight"), and a screenshot with a labelled',
        '100-point grid. Earlier turns in this conversation are your own previous tool calls and their outcomes.',
        '',
        'Loop: OBSERVE the screenshot, EVALUATE whether your previous action worked, then make exactly ONE tool call.',
        'The tool you call is what gets executed on the phone — if your reasoning concludes the goal is finished, the',
        'tool you call must be done, not another action.',
        'Rules:',
        '- Prefer element centre coordinates from the hierarchy over guessing from pixels. Cross-check with the screenshot.',
        '- To open an app, use open_app with its bundle id when you know it (Settings = com.apple.Preferences). Otherwise',
        '  use Spotlight: on the home screen swipe DOWN from the middle, type the app name, tap the Top Hit.',
        '- press_home always returns to the home screen; use it to leave any app or dismiss Spotlight.',
        '- Multi-part goals ("open X, then do Y") are complete once every part has happened in order across the',
        '  conversation — call done then. Never redo a part that already succeeded.',
        '- Verify before you declare victory: the screenshot must be consistent with the goal being achieved.',
        '- If the same action has not changed the screen twice, try something different (scroll, back, other element).',
        '- Never enter passwords, payment details, or 2FA codes; call fail and explain instead.',
        '- Keep reasoning to two or three short sentences.',
    ].join('\n');
}

type ContentBlock = Record<string, unknown>;
interface Message { role: 'user' | 'assistant'; content: ContentBlock[] }

function observationText(request: VlmStepRequest): string {
    return [
        `TURN ${request.stepIndex + 1} of at most ${request.maxSteps}.`,
        request.locked ? 'The device reports it is LOCKED.' : '',
        request.nudge ? `NOTE: ${request.nudge}` : '',
        '',
        `ON-SCREEN ELEMENTS${request.hierarchyTruncated ? ' (truncated)' : ''}:`,
        request.hierarchy,
        '',
        'CURRENT SCREENSHOT (grid labels are in points):',
    ].filter((line) => line !== '').join('\n');
}

/**
 * Builds a genuine agentic transcript: goal → [observation → tool_use → tool_result]* → current observation.
 * Earlier observations are text-only (app + element count) so the only image in the request is the current one.
 */
export function buildMessages(request: VlmStepRequest): Message[] {
    const messages: Message[] = [];
    let pending: ContentBlock[] = [{ type: 'text', text: `GOAL: ${request.goal}` }];
    request.history.forEach((turn, index) => {
        const id = `toolu_turn_${index + 1}`;
        const call = toolCallForAction(turn.action, turn.reasoning);
        pending.push({
            type: 'text',
            text: `TURN ${index + 1}: foreground app was ${turn.app ?? 'unknown'} (${turn.elementCount} elements; screenshot omitted).`,
        });
        messages.push({ role: 'user', content: pending });
        messages.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: call.name, input: call.input }] });
        pending = [{ type: 'tool_result', tool_use_id: id, content: turn.outcome }];
    });
    pending.push(
        { type: 'text', text: observationText(request) },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: request.screenshot.toString('base64') } },
    );
    messages.push({ role: 'user', content: pending });
    return messages;
}

interface AnthropicResponse {
    content?: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { type?: string; message?: string };
    stop_reason?: string;
}

export class AnthropicVisionModel implements VisionModel {
    readonly model: string;
    private readonly apiKey: string;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;

    constructor(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
        if (!options.apiKey) throw new VlmError('ANTHROPIC_API_KEY is required');
        this.apiKey = options.apiKey;
        this.model = options.model ?? DEFAULT_AGENT_MODEL;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }

    async decide(request: VlmStepRequest): Promise<VlmDecision> {
        const body = {
            model: this.model,
            max_tokens: 400,
            system: systemPrompt(request.screen),
            tools: AGENT_TOOLS,
            tool_choice: { type: 'any' },
            messages: buildMessages(request),
        };
        let response: Response;
        try {
            response = await this.fetchImpl(ANTHROPIC_URL, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': ANTHROPIC_VERSION,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            throw new VlmError(`Model request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const payload = await response.json().catch(() => ({})) as AnthropicResponse;
        if (!response.ok) {
            throw new VlmError(`Model returned ${response.status}: ${payload.error?.message ?? 'unknown error'}`);
        }
        const blocks = payload.content ?? [];
        const prose = blocks.filter((block) => block.type === 'text').map((block) => block.text.trim()).filter(Boolean).join('\n');
        const call = blocks.find((block) => block.type === 'tool_use');
        if (!call || call.type !== 'tool_use') {
            throw new VlmError(`Model did not return an action${prose ? `: ${prose.slice(0, 200)}` : ''}`);
        }
        const input = call.input ?? {};
        const inline = typeof input.reasoning === 'string' ? input.reasoning.trim() : '';
        return {
            action: parseAgentAction(call.name, input),
            reasoning: [prose, inline].filter(Boolean).join('\n'),
            usage: {
                inputTokens: payload.usage?.input_tokens ?? 0,
                outputTokens: payload.usage?.output_tokens ?? 0,
            },
            raw: payload,
        };
    }
}

/** Build the model from the environment, or null when agent mode is not configured. */
export function visionModelFromEnv(env: NodeJS.ProcessEnv = process.env): AnthropicVisionModel | null {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) return null;
    return new AnthropicVisionModel({ apiKey, model: env.AGENT_VLM_MODEL?.trim() || DEFAULT_AGENT_MODEL });
}
