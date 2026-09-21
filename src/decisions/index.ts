export { createDecisions, describeElement, UNKNOWN, type CreateDecisionsOptions } from './client.js';
export {
    DEFAULT_CONFIDENCE_THRESHOLD, DEFAULT_FIT_THRESHOLD, DEFAULT_JEV_MODEL, DEFAULT_JEV_URL,
    DEFAULT_MAX_ATTEMPTS, DEFAULT_TIMEOUT_MS, decisionsConfigFromEnv, type DecisionsConfig,
} from './config.js';
export { JevClient, JevError, JevTimeoutError, type JevClientOptions } from './jev-client.js';
export {
    DrizzleDecisionSink, MemoryDecisionSink, decisionSink, escalationRateByWeek, setDecisionSink,
    type DecisionRecord, type DecisionSink, type EscalationBucket,
} from './telemetry.js';
export type {
    Answers, DecisionBackend, DecisionScope, Decisions, ElementVerdict, EscalationReason,
    ScreenCatalog, ScreenVerdict, SystemOneAnswer, SystemOneQuestion, SystemOneResponse, TokenUsage, Verdict,
} from './types.js';
