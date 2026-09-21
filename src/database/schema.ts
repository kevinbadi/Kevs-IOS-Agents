import { bigint, boolean, index, integer, jsonb, pgSchema, primaryKey, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { JsonObject, ScheduleTiming } from '../types.js';

export const schedulerSchema = pgSchema('scheduler');
export const scheduleStatus = schedulerSchema.enum('schedule_status', ['active', 'paused', 'completed', 'cancelled']);
export const executionStatus = schedulerSchema.enum('execution_status', [
    'queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'stopped',
]);

const taskColumns = {
    pluginId: text('plugin_id').notNull(),
    taskType: text('task_type').notNull(),
    taskVersion: integer('task_version').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
};

export const schedules = schedulerSchema.table('schedules', {
    id: uuid('id').primaryKey().defaultRandom(), deviceUdid: text('device_udid').notNull(), ...taskColumns,
    timing: jsonb('timing').$type<ScheduleTiming>().notNull(),
    status: scheduleStatus('status').notNull().default('active'),
    runWindowMinutes: integer('run_window_minutes').notNull().default(30),
    nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    index('schedules_due_idx').on(table.status, table.nextRunAt),
    index('schedules_device_idx').on(table.deviceUdid, table.createdAt),
    index('schedules_plugin_idx').on(table.pluginId, table.taskType, table.taskVersion),
]);

export const executions = schedulerSchema.table('executions', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    deviceUdid: text('device_udid').notNull(), ...taskColumns,
    scheduledFor: timestamp('scheduled_for', { withTimezone: true, mode: 'date' }).notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: executionStatus('status').notNull().default('queued'), queueJobId: text('queue_job_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }), exitCode: integer('exit_code'),
    error: text('error'), stopRequestedAt: timestamp('stop_requested_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('executions_schedule_occurrence_idx').on(table.scheduleId, table.scheduledFor),
    index('executions_device_status_idx').on(table.deviceUdid, table.status),
    index('executions_plugin_idx').on(table.pluginId, table.taskType, table.taskVersion),
]);

export const executionAttempts = schedulerSchema.table('execution_attempts', {
    executionId: uuid('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }), exitCode: integer('exit_code'), error: text('error'),
}, (table) => [primaryKey({ columns: [table.executionId, table.attempt] })]);

export const executionLogs = schedulerSchema.table('execution_logs', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    executionId: uuid('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(), line: text('line').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [index('execution_logs_execution_idx').on(table.executionId, table.id)]);

export const assets = schedulerSchema.table('assets', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull().unique(), originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(), size: bigint('size', { mode: 'number' }).notNull(), sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [index('assets_schedule_idx').on(table.scheduleId), index('assets_execution_idx').on(table.executionId)]);

export const pipelineItemStatus = schedulerSchema.enum('pipeline_item_status', [
    'ready', 'publishing', 'published', 'failed', 'cancelled',
]);

/** Ready-to-post inbox: video + caption, drained at fixed EST check times. */
export const pipelineItems = schedulerSchema.table('pipeline_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceUdid: text('device_udid').notNull(),
    status: pipelineItemStatus('status').notNull().default('ready'),
    caption: text('caption'),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'restrict' }),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
    index('pipeline_items_device_status_idx').on(table.deviceUdid, table.status, table.createdAt),
    index('pipeline_items_asset_idx').on(table.assetId),
]);

/**
 * One row per semantic decision (src/decisions). The number that matters is
 * the escalation rate over time — if it is not falling week over week, the
 * approach is not working.
 */
export const decisions = schedulerSchema.table('decisions', {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    deviceUdid: text('device_udid').notNull(),
    /** "screen" | "element" | "ask" */
    kind: text('kind').notNull(),
    source: text('source'),
    model: text('model').notNull(),
    questions: jsonb('questions').$type<JsonObject>().notNull(),
    /** The indexed element list the model chose from — lets the dashboard draw the decision on the screen. */
    elements: jsonb('elements').$type<JsonObject[]>().notNull().default([]),
    chosen: text('chosen'),
    probabilities: jsonb('probabilities').$type<Record<string, number>>().notNull(),
    confidence: real('confidence'),
    fits: real('fits'),
    escalated: boolean('escalated').notNull(),
    escalationReason: text('escalation_reason'),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    index('decisions_created_idx').on(table.createdAt),
    index('decisions_escalated_idx').on(table.escalated, table.createdAt),
    index('decisions_execution_idx').on(table.executionId),
]);

export type ScheduleRow = typeof schedules.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;
export type PipelineItemRow = typeof pipelineItems.$inferSelect;
