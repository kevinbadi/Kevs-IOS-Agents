import { compactElements, elementCentre, type IndexedElement } from '../devices/elements.js';
import type { JsonObject } from '../types.js';
import { decisionsConfigFromEnv, type DecisionsConfig } from './config.js';
import { JevClient, JevTimeoutError } from './jev-client.js';
import { decisionSink, type DecisionRecord, type DecisionSink } from './telemetry.js';
import type {
    Answers, DecisionBackend, DecisionScope, Decisions, ElementVerdict, EscalationReason,
    ScreenCatalog, ScreenVerdict, SystemOneAnswer, SystemOneQuestion, SystemOneResponse, TokenUsage,
} from './types.js';

export const UNKNOWN = 'unknown';
const PICK = 'pick';
const FITS = 'fits';

export interface CreateDecisionsOptions {
    config?: DecisionsConfig;
    /** Swap the backend (tests, other vendors). `null` forces "unavailable". */
    backend?: DecisionBackend | null;
    /** Defaults to the process-wide sink installed by the worker. */
    sink?: DecisionSink | null;
    now?: () => number;
}

/**
 * Build a decision maker for one execution on one device. With no API key the
 * result is `available: false` and every method returns an escalating verdict
 * without touching the network, so callers can always fall through to their
 * existing logic.
 */
export function createDecisions(scope: DecisionScope, options: CreateDecisionsOptions = {}): Decisions {
    const config = options.config ?? decisionsConfigFromEnv();
    const backend = options.backend === undefined
        ? (config.apiKey ? new JevClient({
            apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl,
            timeoutMs: config.timeoutMs, maxAttempts: config.maxAttempts,
        }) : null)
        : options.backend;
    const now = options.now ?? Date.now;
    const sinkFor = () => (options.sink === undefined ? decisionSink() : options.sink);

    const zeroUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0 });

    const record = (partial: Omit<DecisionRecord, 'executionId' | 'deviceUdid' | 'source' | 'model'>): void => {
        const sink = sinkFor();
        if (!sink) return;
        void sink.record({
            executionId: scope.executionId ?? null,
            deviceUdid: scope.deviceUdid,
            source: scope.source ?? null,
            model: backend?.model ?? 'none',
            ...partial,
        }).catch((error: unknown) => {
            console.error(`decision telemetry failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    };

    /** One round trip; timeouts and errors come back as a reason, never as a throw. */
    const call = async (
        state: unknown,
        questions: Record<string, SystemOneQuestion>,
    ): Promise<{ response: SystemOneResponse | null; reason?: EscalationReason; latencyMs: number; usage: TokenUsage }> => {
        const started = now();
        try {
            const response = await backend!.systemone(state, questions);
            return {
                response,
                latencyMs: now() - started,
                usage: {
                    inputTokens: response.usage?.input_tokens ?? 0,
                    outputTokens: response.usage?.output_tokens ?? 0,
                },
            };
        } catch (error) {
            return {
                response: null,
                reason: error instanceof JevTimeoutError ? 'timeout' : 'error',
                latencyMs: now() - started,
                usage: zeroUsage(),
            };
        }
    };

    const unavailable = <T>(value: T): { value: T; confidence: number; probabilities: Record<string, number>; escalate: true; reason: EscalationReason; latencyMs: number; usage: TokenUsage } => ({
        value, confidence: 0, probabilities: {}, escalate: true, reason: 'unavailable', latencyMs: 0, usage: zeroUsage(),
    });

    /**
     * The escalation rule. A Choice is relative — it always crowns a winner even
     * when every option is wrong — so the paired Noul ("does anything fit?") is
     * what catches that case, and it is checked before confidence.
     */
    const judge = (
        pick: Extract<SystemOneAnswer, { type: 'choice' }>,
        fits: number | undefined,
        valid: (choice: string) => boolean,
    ): { escalate: boolean; reason?: EscalationReason } => {
        if (pick.choice === UNKNOWN) return { escalate: true, reason: 'unknown' };
        if (!valid(pick.choice)) return { escalate: true, reason: 'invalid-choice' };
        if (fits !== undefined && fits < config.fitThreshold) return { escalate: true, reason: 'nothing-fits' };
        if (pick.confidence < config.confidenceThreshold) return { escalate: true, reason: 'low-confidence' };
        return { escalate: false };
    };

    const choiceAnswer = (response: SystemOneResponse): Extract<SystemOneAnswer, { type: 'choice' }> | null => {
        const answer = response.answers[PICK];
        return answer && answer.type === 'choice' && typeof answer.choice === 'string' ? answer : null;
    };

    const noulAnswer = (response: SystemOneResponse, id: string): number | undefined => {
        const answer = response.answers[id];
        return answer && answer.type === 'noul' && typeof answer.noul === 'number' ? answer.noul : undefined;
    };

    return {
        available: backend !== null,

        async decideScreen(elements, screens, context) {
            if (!backend) return unavailable(UNKNOWN);
            const questions: Record<string, SystemOneQuestion> = {
                [PICK]: {
                    type: 'choice',
                    instructions: 'Which of the `screens` is showing, judging from `elements` (the visible UI of an iPhone app)?',
                    criteria: { ...screens, [UNKNOWN]: 'None of the listed screens matches what is on screen' },
                },
                [FITS]: {
                    type: 'noul',
                    instructions: 'Do the `elements` clearly match exactly one of the `screens`?',
                },
            };
            const state = {
                task: 'Identify which screen of an iOS app is showing.',
                ...(context ? { context } : {}),
                screens,
                elements: compactElements(elements),
            };
            const { response, reason, latencyMs, usage } = await call(state, questions);
            const pick = response ? choiceAnswer(response) : null;
            const fits = response ? noulAnswer(response, FITS) : undefined;
            const verdict: ScreenVerdict = pick
                ? {
                    value: pick.choice, confidence: pick.confidence, probabilities: pick.probabilities ?? {},
                    ...judge(pick, fits, (choice) => choice in screens), fits, latencyMs, usage,
                }
                : { value: UNKNOWN, confidence: 0, probabilities: {}, escalate: true, reason: reason ?? 'error', latencyMs, usage };
            record({
                kind: 'screen', questions: questions as unknown as JsonObject, elements: state.elements,
                chosen: pick ? pick.choice : null, probabilities: verdict.probabilities,
                confidence: pick ? pick.confidence : null, fits: fits ?? null,
                escalated: verdict.escalate, escalationReason: verdict.reason ?? null,
                latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
            });
            return verdict;
        },

        async chooseElement(elements, goal) {
            if (!backend) return { ...unavailable<number | null>(null), element: null, tapPoint: null };
            const byIndex = new Map(elements.map((element) => [String(element.index), element]));
            const criteria: Record<string, string> = {};
            for (const element of elements) {
                criteria[String(element.index)] = describeElement(element);
            }
            criteria[UNKNOWN] = 'No listed element accomplishes the goal';
            const questions: Record<string, SystemOneQuestion> = {
                [PICK]: {
                    type: 'choice',
                    instructions: 'Which element (by its `i` index) should be tapped next to accomplish `goal`?',
                    criteria,
                },
                [FITS]: {
                    type: 'noul',
                    instructions: 'Is there an element in `elements` that, when tapped, accomplishes `goal`?',
                },
            };
            const state = {
                task: 'Choose the one on-screen element to tap.',
                goal,
                elements: compactElements(elements),
            };
            const { response, reason, latencyMs, usage } = await call(state, questions);
            const pick = response ? choiceAnswer(response) : null;
            const fits = response ? noulAnswer(response, FITS) : undefined;
            let verdict: ElementVerdict;
            if (pick) {
                const judged = judge(pick, fits, (choice) => /^\d+$/.test(choice) && byIndex.has(choice));
                const element = judged.escalate ? null : byIndex.get(pick.choice) ?? null;
                verdict = {
                    value: element ? element.index : null,
                    element,
                    // Index → rect → centre happens here, in our code, and nowhere else.
                    tapPoint: element ? elementCentre(element) : null,
                    confidence: pick.confidence,
                    probabilities: pick.probabilities ?? {},
                    ...judged,
                    fits,
                    latencyMs,
                    usage,
                };
            } else {
                verdict = {
                    value: null, element: null, tapPoint: null, confidence: 0, probabilities: {},
                    escalate: true, reason: reason ?? 'error', latencyMs, usage,
                };
            }
            record({
                kind: 'element', questions: { goal, options: criteria } as unknown as JsonObject, elements: state.elements,
                chosen: pick ? pick.choice : null, probabilities: verdict.probabilities,
                confidence: pick ? pick.confidence : null, fits: fits ?? null,
                escalated: verdict.escalate, escalationReason: verdict.reason ?? null,
                latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
            });
            return verdict;
        },

        async ask(elements, questionsByid) {
            if (!backend) return { answers: {}, escalate: true, reason: 'unavailable', latencyMs: 0, usage: zeroUsage() };
            const questions: Record<string, SystemOneQuestion> = {};
            for (const [id, instructions] of Object.entries(questionsByid)) {
                questions[id] = { type: 'noul', instructions };
            }
            const state = { elements: compactElements(elements) };
            const { response, reason, latencyMs, usage } = await call(state, questions);
            const answers: Record<string, number> = {};
            if (response) {
                for (const id of Object.keys(questions)) {
                    const probability = noulAnswer(response, id);
                    if (probability !== undefined) answers[id] = probability;
                }
            }
            const result: Answers = response
                ? { answers, escalate: false, latencyMs, usage }
                : { answers, escalate: true, reason: reason ?? 'error', latencyMs, usage };
            record({
                kind: 'ask', questions: questionsByid as unknown as JsonObject, elements: state.elements,
                chosen: null, probabilities: answers, confidence: null, fits: null,
                escalated: result.escalate, escalationReason: result.reason ?? null,
                latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
            });
            return result;
        },
    };
}

/** Option text for one element — role and words only, never coordinates. */
export function describeElement(element: IndexedElement): string {
    const parts = [element.role];
    if (element.label) parts.push(`"${element.label}"`);
    if (element.value) parts.push(`(${element.value})`);
    return parts.join(' ');
}
