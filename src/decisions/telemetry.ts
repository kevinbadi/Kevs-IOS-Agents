import { sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../database/client.js';
import { decisions } from '../database/schema.js';
import type { CompactElement } from '../devices/elements.js';
import type { JsonObject } from '../types.js';
import type { EscalationReason } from './types.js';

export interface DecisionRecord {
    executionId: string | null;
    deviceUdid: string;
    kind: 'screen' | 'element' | 'ask';
    source: string | null;
    model: string;
    questions: JsonObject;
    /** Exactly what the model saw, so the decision can be drawn back onto the screen. */
    elements: CompactElement[];
    chosen: string | null;
    probabilities: Record<string, number>;
    confidence: number | null;
    fits: number | null;
    escalated: boolean;
    escalationReason: EscalationReason | null;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
}

export interface DecisionSink {
    record(record: DecisionRecord): Promise<void>;
}

/**
 * Process-wide sink so plugins can record decisions without the module being
 * threaded through TaskExecutionContext. The worker installs a Drizzle sink at
 * startup; with none installed, decisions still work and simply aren't kept.
 */
let activeSink: DecisionSink | null = null;

export function setDecisionSink(sink: DecisionSink | null): void {
    activeSink = sink;
}

export function decisionSink(): DecisionSink | null {
    return activeSink;
}

export class DrizzleDecisionSink implements DecisionSink {
    constructor(private readonly connection: DatabaseConnection) {}

    async record(record: DecisionRecord): Promise<void> {
        await this.connection.db.insert(decisions).values({
            executionId: record.executionId,
            deviceUdid: record.deviceUdid,
            kind: record.kind,
            source: record.source,
            model: record.model,
            questions: record.questions,
            elements: record.elements as unknown as JsonObject[],
            chosen: record.chosen,
            probabilities: record.probabilities,
            confidence: record.confidence,
            fits: record.fits,
            escalated: record.escalated,
            escalationReason: record.escalationReason,
            latencyMs: record.latencyMs,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
        });
    }
}

/** Collects records in memory — for tests and for callers that only want to inspect. */
export class MemoryDecisionSink implements DecisionSink {
    readonly records: DecisionRecord[] = [];

    async record(record: DecisionRecord): Promise<void> {
        this.records.push(record);
    }
}

export interface RecentDecision {
    id: string;
    createdAt: string;
    executionId: string | null;
    deviceUdid: string;
    kind: string;
    source: string | null;
    model: string;
    questions: JsonObject;
    elements: CompactElement[];
    chosen: string | null;
    probabilities: Record<string, number>;
    confidence: number | null;
    fits: number | null;
    escalated: boolean;
    escalationReason: string | null;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
}

/** Raw row shape from `execute`; jsonb comes back parsed, timestamps as Date. */
type RecentDecisionRow = Record<string, unknown> & {
    id: string;
    created_at: Date | string;
    execution_id: string | null;
    device_udid: string;
    kind: string;
    source: string | null;
    model: string;
    questions: JsonObject;
    elements: CompactElement[] | null;
    chosen: string | null;
    probabilities: Record<string, number>;
    confidence: number | null;
    fits: number | null;
    escalated: boolean;
    escalation_reason: string | null;
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
};

function toRecent(row: RecentDecisionRow): RecentDecision {
    return {
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        executionId: row.execution_id,
        deviceUdid: row.device_udid,
        kind: row.kind,
        source: row.source,
        model: row.model,
        questions: row.questions,
        elements: row.elements ?? [],
        chosen: row.chosen,
        probabilities: row.probabilities,
        confidence: row.confidence,
        fits: row.fits,
        escalated: row.escalated,
        escalationReason: row.escalation_reason,
        latencyMs: Number(row.latency_ms),
        inputTokens: Number(row.input_tokens),
        outputTokens: Number(row.output_tokens),
    };
}

/** Newest first. `after` returns only decisions made after that instant (for live polling). */
export async function listRecentDecisions(
    connection: DatabaseConnection,
    options: { deviceUdid?: string; limit?: number; after?: Date } = {},
): Promise<RecentDecision[]> {
    const limit = Math.min(200, Math.max(1, options.limit ?? 30));
    const byDevice = options.deviceUdid ? sql`and ${decisions.deviceUdid} = ${options.deviceUdid}` : sql``;
    const since = options.after ? sql`and ${decisions.createdAt} > ${options.after.toISOString()}::timestamptz` : sql``;
    const rows = await connection.db.execute<RecentDecisionRow>(sql`
        select id, created_at, execution_id, device_udid, kind, source, model, questions, elements, chosen,
               probabilities, confidence, fits, escalated, escalation_reason, latency_ms, input_tokens, output_tokens
        from ${decisions}
        where true ${byDevice} ${since}
        order by ${decisions.createdAt} desc
        limit ${limit}
    `);
    return rows.rows.map(toRecent);
}

export interface EscalationBucket {
    /** ISO date (Monday) of the week. */
    weekStart: string;
    decisions: number;
    escalated: number;
    /** escalated / decisions, 0–1. */
    rate: number;
    avgLatencyMs: number;
    inputTokens: number;
}

/** The one number above all: escalation rate per ISO week, newest first. */
export async function escalationRateByWeek(connection: DatabaseConnection, weeks = 12, source?: string): Promise<EscalationBucket[]> {
    const filter = source ? sql`and ${decisions.source} = ${source}` : sql``;
    const rows = await connection.db.execute<{
        week_start: string; decisions: string; escalated: string; avg_latency_ms: string | null; input_tokens: string;
    }>(sql`
        select to_char(date_trunc('week', ${decisions.createdAt}), 'YYYY-MM-DD') as week_start,
               count(*)::text as decisions,
               count(*) filter (where ${decisions.escalated})::text as escalated,
               round(avg(${decisions.latencyMs}))::text as avg_latency_ms,
               coalesce(sum(${decisions.inputTokens}), 0)::text as input_tokens
        from ${decisions}
        where ${decisions.createdAt} >= now() - make_interval(weeks => ${weeks}) ${filter}
        group by 1
        order by 1 desc
    `);
    return rows.rows.map((row) => {
        const total = Number(row.decisions);
        const escalated = Number(row.escalated);
        return {
            weekStart: row.week_start,
            decisions: total,
            escalated,
            rate: total ? escalated / total : 0,
            avgLatencyMs: Number(row.avg_latency_ms ?? 0),
            inputTokens: Number(row.input_tokens),
        };
    });
}
