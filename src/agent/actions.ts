/**
 * The structured actions the vision model may return. One action per step.
 * Coordinates are always in iOS points (the same space as the view hierarchy).
 */

export type AgentAction =
    | { type: 'tap'; x: number; y: number; target?: string }
    | { type: 'long_press'; x: number; y: number; durationMs: number; target?: string }
    | { type: 'swipe'; startX: number; startY: number; endX: number; endY: number; durationMs: number }
    | { type: 'scroll'; direction: ScrollDirection }
    | { type: 'type_text'; text: string }
    | { type: 'press_home' }
    | { type: 'open_app'; bundleId: string }
    | { type: 'wait'; seconds: number }
    | { type: 'done'; summary: string }
    | { type: 'fail'; reason: string };

/** Which way to move through the content — "down" shows what is below / the next item. */
export type ScrollDirection = 'down' | 'up' | 'left' | 'right';
export const SCROLL_DIRECTIONS: ScrollDirection[] = ['down', 'up', 'left', 'right'];

export interface AgentToolSchema {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

const point = { type: 'integer', description: 'iOS points from the left/top edge of the screen' };

const REASONING = {
    type: 'string',
    description: 'One to three sentences: what the screenshot shows, whether the previous action worked, and why this action is next.',
};

/** Every tool carries a required `reasoning` so the model explains itself even when a tool call is forced. */
function withReasoning(tool: AgentToolSchema): AgentToolSchema {
    return {
        ...tool,
        input_schema: {
            ...tool.input_schema,
            properties: { reasoning: REASONING, ...tool.input_schema.properties },
            required: ['reasoning', ...(tool.input_schema.required ?? [])],
        },
    };
}

const BASE_TOOLS: AgentToolSchema[] = [
    {
        name: 'tap',
        description: 'Tap once at a point on the screen. Prefer the centre coordinates listed for an element in the view hierarchy.',
        input_schema: {
            type: 'object',
            properties: { x: point, y: point, target: { type: 'string', description: 'Short label of what is being tapped' } },
            required: ['x', 'y'],
        },
    },
    {
        name: 'long_press',
        description: 'Press and hold at a point (context menus, drag handles).',
        input_schema: {
            type: 'object',
            properties: {
                x: point, y: point,
                duration_ms: { type: 'integer', description: 'Hold time in milliseconds (default 800)' },
                target: { type: 'string' },
            },
            required: ['x', 'y'],
        },
    },
    {
        name: 'swipe',
        description: 'Drag from one point to another. Swipe up (start low, end high) to scroll down a feed. Use a distance of at least 250 points for a normal scroll.',
        input_schema: {
            type: 'object',
            properties: {
                start_x: point, start_y: point, end_x: point, end_y: point,
                duration_ms: { type: 'integer', description: 'Gesture duration in milliseconds (default 350)' },
            },
            required: ['start_x', 'start_y', 'end_x', 'end_y'],
        },
    },
    {
        name: 'scroll',
        description: 'Move one screen through the content, the way a thumb flick would. "down" reveals what is below — in vertical video feeds (Reels, TikTok, Shorts) this goes to the NEXT video; "up" goes back; "left"/"right" page sideways (next/previous home page, carousel item). Prefer this over swipe for feeds and lists.',
        input_schema: {
            type: 'object',
            properties: { direction: { type: 'string', enum: SCROLL_DIRECTIONS } },
            required: ['direction'],
        },
    },
    {
        name: 'type_text',
        description: 'Type text into the currently focused text field. Tap the field first if the keyboard is not showing. Use "\\n" to press return.',
        input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
    {
        name: 'press_home',
        description: 'Press the Home button / go to the iOS home screen.',
        input_schema: { type: 'object', properties: {} },
    },
    {
        name: 'open_app',
        description: 'Launch an app by bundle id, e.g. com.burbn.instagram, com.zhiliaoapp.musically, com.linkedin.LinkedIn, com.apple.mobilesafari, com.apple.Preferences.',
        input_schema: { type: 'object', properties: { bundle_id: { type: 'string' } }, required: ['bundle_id'] },
    },
    {
        name: 'wait',
        description: 'Pause and re-observe without acting (content loading, animation).',
        input_schema: { type: 'object', properties: { seconds: { type: 'number', minimum: 0.5, maximum: 10 } }, required: ['seconds'] },
    },
    {
        name: 'done',
        description: 'Call as soon as every part of the goal has been carried out (check PREVIOUS ACTIONS for earlier parts) and the screenshot is consistent with that. Summarise what was achieved.',
        input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
    {
        name: 'fail',
        description: 'Call when the goal cannot be completed (blocked by login, missing app, repeated failures). Explain why.',
        input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
];

export const AGENT_TOOLS: AgentToolSchema[] = BASE_TOOLS.map(withReasoning);

function integer(value: unknown, name: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
    return Math.round(parsed);
}

function text(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    return value;
}

/** Turns a raw tool call from the model into a validated action. */
export function parseAgentAction(name: string, input: Record<string, unknown>): AgentAction {
    switch (name) {
        case 'tap':
            return {
                type: 'tap', x: integer(input.x, 'x'), y: integer(input.y, 'y'),
                ...(typeof input.target === 'string' ? { target: input.target } : {}),
            };
        case 'long_press':
            return {
                type: 'long_press', x: integer(input.x, 'x'), y: integer(input.y, 'y'),
                durationMs: input.duration_ms === undefined ? 800 : Math.min(5_000, Math.max(200, integer(input.duration_ms, 'duration_ms'))),
                ...(typeof input.target === 'string' ? { target: input.target } : {}),
            };
        case 'swipe':
            return {
                type: 'swipe',
                startX: integer(input.start_x, 'start_x'), startY: integer(input.start_y, 'start_y'),
                endX: integer(input.end_x, 'end_x'), endY: integer(input.end_y, 'end_y'),
                durationMs: input.duration_ms === undefined ? 350 : Math.min(3_000, Math.max(80, integer(input.duration_ms, 'duration_ms'))),
            };
        case 'scroll': {
            const direction = typeof input.direction === 'string' ? input.direction.trim().toLowerCase() : '';
            if (!SCROLL_DIRECTIONS.includes(direction as ScrollDirection)) {
                throw new Error(`direction must be one of ${SCROLL_DIRECTIONS.join(', ')}`);
            }
            return { type: 'scroll', direction: direction as ScrollDirection };
        }
        case 'type_text':
            return { type: 'type_text', text: text(input.text, 'text') };
        case 'press_home':
            return { type: 'press_home' };
        case 'open_app':
            return { type: 'open_app', bundleId: text(input.bundle_id, 'bundle_id').trim() };
        case 'wait': {
            const seconds = typeof input.seconds === 'number' ? input.seconds : Number(input.seconds ?? 1);
            return { type: 'wait', seconds: Math.min(10, Math.max(0.5, Number.isFinite(seconds) ? seconds : 1)) };
        }
        case 'done':
            return { type: 'done', summary: typeof input.summary === 'string' && input.summary.trim() ? input.summary : 'Goal complete.' };
        case 'fail':
            return { type: 'fail', reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason : 'The model gave up.' };
        default:
            throw new Error(`Unknown tool ${name}`);
    }
}

/**
 * The model occasionally reads coordinates off the (1.5×) screenshot instead of
 * the point grid. When a target lies outside the point screen but inside the
 * image, scale it back into points rather than failing the turn.
 */
export function normalizeCoordinates(
    action: AgentAction,
    screen: { width: number; height: number },
    image: { width: number; height: number },
): { action: AgentAction; rescaled: boolean } {
    const scale = image.width / screen.width;
    if (!(scale > 1.01)) return { action, rescaled: false };
    const inPoints = (x: number, y: number) => x >= 0 && x <= screen.width && y >= 0 && y <= screen.height;
    const inImage = (x: number, y: number) => x >= 0 && x <= image.width && y >= 0 && y <= image.height;
    const toPoints = (value: number) => Math.round(value / scale);
    if (action.type === 'tap' || action.type === 'long_press') {
        if (inPoints(action.x, action.y) || !inImage(action.x, action.y)) return { action, rescaled: false };
        return { action: { ...action, x: toPoints(action.x), y: toPoints(action.y) }, rescaled: true };
    }
    if (action.type === 'swipe') {
        const ok = inPoints(action.startX, action.startY) && inPoints(action.endX, action.endY);
        const fits = inImage(action.startX, action.startY) && inImage(action.endX, action.endY);
        if (ok || !fits) return { action, rescaled: false };
        return {
            action: {
                ...action,
                startX: toPoints(action.startX), startY: toPoints(action.startY),
                endX: toPoints(action.endX), endY: toPoints(action.endY),
            },
            rescaled: true,
        };
    }
    return { action, rescaled: false };
}

/** Reverse of parseAgentAction — used to replay earlier turns to the model as tool_use blocks. */
export function toolCallForAction(action: AgentAction, reasoning: string): { name: string; input: Record<string, unknown> } {
    const base: Record<string, unknown> = reasoning ? { reasoning } : {};
    switch (action.type) {
        case 'tap': return { name: 'tap', input: { ...base, x: action.x, y: action.y, ...(action.target ? { target: action.target } : {}) } };
        case 'long_press': return { name: 'long_press', input: { ...base, x: action.x, y: action.y, duration_ms: action.durationMs, ...(action.target ? { target: action.target } : {}) } };
        case 'swipe': return { name: 'swipe', input: { ...base, start_x: action.startX, start_y: action.startY, end_x: action.endX, end_y: action.endY, duration_ms: action.durationMs } };
        case 'scroll': return { name: 'scroll', input: { ...base, direction: action.direction } };
        case 'type_text': return { name: 'type_text', input: { ...base, text: action.text } };
        case 'press_home': return { name: 'press_home', input: base };
        case 'open_app': return { name: 'open_app', input: { ...base, bundle_id: action.bundleId } };
        case 'wait': return { name: 'wait', input: { ...base, seconds: action.seconds } };
        case 'done': return { name: 'done', input: { ...base, summary: action.summary } };
        case 'fail': return { name: 'fail', input: { ...base, reason: action.reason } };
    }
}

export function describeAction(action: AgentAction): string {
    switch (action.type) {
        case 'tap': return `tap (${action.x}, ${action.y})${action.target ? ` — ${action.target}` : ''}`;
        case 'long_press': return `long press (${action.x}, ${action.y}) ${action.durationMs}ms${action.target ? ` — ${action.target}` : ''}`;
        case 'swipe': return `swipe (${action.startX}, ${action.startY}) → (${action.endX}, ${action.endY})`;
        case 'scroll': return `scroll ${action.direction}`;
        case 'type_text': return `type "${action.text.length > 40 ? `${action.text.slice(0, 39)}…` : action.text}"`;
        case 'press_home': return 'press home';
        case 'open_app': return `open ${action.bundleId}`;
        case 'wait': return `wait ${action.seconds}s`;
        case 'done': return `done — ${action.summary}`;
        case 'fail': return `fail — ${action.reason}`;
    }
}
