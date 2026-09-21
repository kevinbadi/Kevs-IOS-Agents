import type { IndexedElement } from '../devices/elements.js';

/** Why a verdict was flagged for escalation instead of being acted on. */
export type EscalationReason =
    | 'unavailable'      // no API key / decisions disabled
    | 'low-confidence'   // Choice confidence under the configured threshold
    | 'unknown'          // the model picked the explicit "unknown" option
    | 'nothing-fits'     // the paired Noul says no listed option is right
    | 'invalid-choice'   // reply was not a key we offered (e.g. not an index)
    | 'timeout'          // no answer within the deadline — never a verdict
    | 'error';           // transport / API error

export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
}

/** Common shape of every answer the module gives back. */
export interface Verdict<T> {
    value: T;
    /** Choice confidence from the model, 0–1 (0 when unavailable / errored). */
    confidence: number;
    /** Probability per offered option, including "unknown". */
    probabilities: Record<string, number>;
    /** True when the caller must NOT act on `value` and should fall back. */
    escalate: boolean;
    reason?: EscalationReason;
    /** Probability from the paired "does anything fit?" Noul, when asked. */
    fits?: number;
    latencyMs: number;
    usage: TokenUsage;
}

/** `value` is one of the screen names offered, or "unknown". */
export type ScreenVerdict = Verdict<string>;

export interface ElementVerdict extends Verdict<number | null> {
    /** The chosen element, resolved by us from the index. Null when escalating. */
    element: IndexedElement | null;
    /**
     * Centre of `element.rect`, computed by our code. The model never produces
     * this — it only ever returns an index into the list we built.
     */
    tapPoint: { x: number; y: number } | null;
}

/** Escape hatch: arbitrary yes/no questions about the current elements. */
export interface Answers {
    /** Question id → probability the answer is yes (0–1). */
    answers: Record<string, number>;
    escalate: boolean;
    reason?: EscalationReason;
    latencyMs: number;
    usage: TokenUsage;
}

/** Screens a caller can ask `decideScreen` to distinguish between. */
export type ScreenCatalog = Record<string, string>;

/** Who is asking — recorded with every decision for the escalation-rate telemetry. */
export interface DecisionScope {
    executionId?: string | null;
    deviceUdid: string;
    /** Free-form origin, e.g. "example/open-app" or "agent-cloud". */
    source?: string;
}

export interface Decisions {
    /** False when no backend is configured; every method then escalates immediately. */
    readonly available: boolean;
    decideScreen(elements: readonly IndexedElement[], screens: ScreenCatalog, context?: string): Promise<ScreenVerdict>;
    chooseElement(elements: readonly IndexedElement[], goal: string): Promise<ElementVerdict>;
    ask(elements: readonly IndexedElement[], questions: Record<string, string>): Promise<Answers>;
}

// --- Backend contract (TypeSafe's wire shapes stay behind this line) -------

export type SystemOneQuestion =
    | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
    | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } };

export type SystemOneAnswer =
    | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
    | { type: 'noul'; noul: number };

export interface SystemOneResponse {
    model: string;
    answers: Record<string, SystemOneAnswer>;
    usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anything that can answer a batch of typed questions about a JSON state. */
export interface DecisionBackend {
    readonly model: string;
    systemone(state: unknown, questions: Record<string, SystemOneQuestion>): Promise<SystemOneResponse>;
}
