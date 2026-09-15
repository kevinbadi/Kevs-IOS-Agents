import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';

import type { DatabaseConnection } from '../database/client.js';
import {
    assets, executionAttempts, executionLogs, executions, pipelineItems, schedules,
    type ExecutionRow, type PipelineItemRow, type ScheduleRow,
} from '../database/schema.js';
import type { PluginRegistry } from '../registry.js';
import type { CreateTaskInput, JsonObject, PipelineClaim, ScheduleTiming, StoredAsset, TaskEnvelope } from '../types.js';
import { ensureDeviceQueue, queueNameForDevice } from './queue.js';
import { initialRunAt, latestDueOccurrence } from './recurrence.js';
import { DEFAULT_MIN_SCHEDULE_GAP_MINUTES, estimatedTaskWindow, validateTaskInput, windowsTooClose } from './validation.js';

export interface ExecutionDetail extends ExecutionRow { logs: string[] }

/** Thrown by setScheduleStatus for a disallowed status change (e.g. resuming a completed schedule). */
export class ScheduleTransitionError extends Error {}

/**
 * Schedule status state machine. A completed or cancelled schedule can only be
 * cancelled — never resumed, which would recompute nextRunAt and re-fire a
 * one-shot (a duplicate public post).
 */
export function scheduleTransitionAllowed(from: string, to: 'active' | 'paused' | 'cancelled'): boolean {
    if (from === to) return true;
    const allowed: Record<string, Array<typeof to>> = {
        active: ['paused', 'cancelled'],
        paused: ['active', 'cancelled'],
        completed: ['cancelled'],
        cancelled: [],
    };
    return (allowed[from] ?? []).includes(to);
}

function taskEnvelope(row: Pick<ScheduleRow, 'pluginId' | 'taskType' | 'taskVersion' | 'payload'>): TaskEnvelope {
    return { pluginId: row.pluginId, taskType: row.taskType, taskVersion: row.taskVersion, payload: row.payload };
}

export class SchedulerRepository {
    constructor(
        readonly connection: DatabaseConnection,
        readonly boss: PgBoss,
        readonly plugins: PluginRegistry,
    ) {}

    async createTask(
        input: CreateTaskInput,
        devicePluginData: JsonObject = {},
        now = new Date(),
        assetIds: string[] = [],
    ): Promise<ScheduleRow> {
        const validated = validateTaskInput(this.plugins, input, devicePluginData, now);
        const nextRunAt = initialRunAt(validated.timing, now);
        await this.assertNoScheduleConflict(validated.deviceUdid, validated.task, nextRunAt);
        await ensureDeviceQueue(this.boss, validated.deviceUdid);
        const [schedule] = await this.connection.db.insert(schedules).values({
            deviceUdid: validated.deviceUdid,
            pluginId: validated.task.pluginId,
            taskType: validated.task.taskType,
            taskVersion: validated.task.taskVersion,
            payload: validated.task.payload,
            timing: validated.timing,
            runWindowMinutes: validated.runWindowMinutes ?? Number(process.env.SCHEDULER_RUN_WINDOW_MINUTES ?? 30),
            nextRunAt,
        }).returning();
        if (!schedule) throw new Error('Unable to create schedule');
        await this.attachAssets(schedule.id, assetIds);
        if (schedule.nextRunAt && schedule.nextRunAt <= now) await this.materializeDue(now, schedule.id);
        return schedule;
    }

    private async assertNoScheduleConflict(deviceUdid: string, task: TaskEnvelope, start: Date, excludeId?: string): Promise<void> {
        const gap = Number(process.env.SCHEDULER_MIN_TASK_GAP_MINUTES ?? DEFAULT_MIN_SCHEDULE_GAP_MINUTES);
        if (gap <= 0) return;
        const candidate = estimatedTaskWindow(this.plugins, task, start);
        const others = await this.connection.db.select().from(schedules).where(and(
            eq(schedules.deviceUdid, deviceUdid), eq(schedules.status, 'active'),
        ));
        for (const other of others) {
            if (other.id === excludeId || !other.nextRunAt) continue;
            const otherWindow = estimatedTaskWindow(this.plugins, taskEnvelope(other), other.nextRunAt);
            if (windowsTooClose(candidate, otherWindow, gap)) {
                throw new Error(`This schedule is within ${gap} minutes of another schedule on this device`);
            }
        }
    }

    async registerAssets(files: Array<{
        relativePath: string; originalName: string; mimeType: string; size: number; sha256: string;
    }>): Promise<Array<{ id: string; name: string; mimeType: string }>> {
        if (!files.length) return [];
        const rows = await this.connection.db.insert(assets).values(files).returning();
        return rows.map((asset) => ({ id: asset.id, name: asset.originalName, mimeType: asset.mimeType }));
    }

    async attachAssets(scheduleId: string, assetIds: string[]): Promise<void> {
        if (assetIds.length) await this.connection.db.update(assets).set({ scheduleId }).where(inArray(assets.id, assetIds));
    }

    async deleteAssets(assetIds: string[]): Promise<void> { await this.purgeAssetIds(assetIds); }

    async listSchedules(limit = 100, deviceUdid?: string): Promise<ScheduleRow[]> {
        const query = this.connection.db.select().from(schedules);
        return deviceUdid
            ? query.where(eq(schedules.deviceUdid, deviceUdid)).orderBy(desc(schedules.createdAt)).limit(limit)
            : query.orderBy(desc(schedules.createdAt)).limit(limit);
    }

    async schedule(id: string): Promise<ScheduleRow | null> {
        const [row] = await this.connection.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        return row ?? null;
    }

    async listExecutions(limit = 100, deviceUdid?: string): Promise<ExecutionRow[]> {
        const query = this.connection.db.select().from(executions);
        return deviceUdid
            ? query.where(eq(executions.deviceUdid, deviceUdid)).orderBy(desc(executions.createdAt)).limit(limit)
            : query.orderBy(desc(executions.createdAt)).limit(limit);
    }

    async execution(id: string): Promise<ExecutionDetail | null> {
        const [row] = await this.connection.db.select().from(executions).where(eq(executions.id, id)).limit(1);
        if (!row) return null;
        const logs = await this.connection.db.select({ line: executionLogs.line }).from(executionLogs)
            .where(eq(executionLogs.executionId, id)).orderBy(executionLogs.id);
        return { ...row, logs: logs.map(({ line }) => line) };
    }

    async executionAssets(execution: ExecutionRow): Promise<StoredAsset[]> {
        const rows = await this.connection.db.select().from(assets).where(or(
            eq(assets.executionId, execution.id),
            ...(execution.scheduleId ? [eq(assets.scheduleId, execution.scheduleId)] : []),
        ));
        const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        return rows.map((asset) => ({
            id: asset.id, path: path.resolve(root, asset.relativePath), name: asset.originalName,
            mimeType: asset.mimeType, size: asset.size, sha256: asset.sha256,
        }));
    }

    async activeExecution(deviceUdid: string): Promise<ExecutionRow | null> {
        const [row] = await this.connection.db.select().from(executions).where(and(
            eq(executions.deviceUdid, deviceUdid), inArray(executions.status, ['queued', 'running']),
        )).orderBy(desc(executions.createdAt)).limit(1);
        return row ?? null;
    }

    async updateSchedule(
        id: string,
        changes: { timing?: ScheduleTiming; task?: TaskEnvelope; runWindowMinutes?: number },
        devicePluginData: JsonObject = {},
        now = new Date(),
    ): Promise<ScheduleRow | null> {
        const [current] = await this.connection.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        if (!current || current.status === 'cancelled' || current.status === 'completed') return null;
        const input = validateTaskInput(this.plugins, {
            deviceUdid: current.deviceUdid,
            task: changes.task ?? taskEnvelope(current),
            timing: changes.timing ?? current.timing,
            runWindowMinutes: changes.runWindowMinutes ?? current.runWindowMinutes,
        }, devicePluginData, now);
        const nextRunAt = changes.timing ? initialRunAt(input.timing, now) : current.nextRunAt;
        if (nextRunAt) await this.assertNoScheduleConflict(input.deviceUdid, input.task, nextRunAt, id);
        const [updated] = await this.connection.db.update(schedules).set({
            pluginId: input.task.pluginId, taskType: input.task.taskType, taskVersion: input.task.taskVersion,
            payload: input.task.payload, timing: input.timing, runWindowMinutes: input.runWindowMinutes,
            nextRunAt, updatedAt: now,
        }).where(eq(schedules.id, id)).returning();
        return updated ?? null;
    }

    async setScheduleStatus(id: string, status: 'active' | 'paused' | 'cancelled', now = new Date()): Promise<ScheduleRow | null> {
        const [current] = await this.connection.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        if (!current) return null;
        if (!scheduleTransitionAllowed(current.status, status)) {
            throw new ScheduleTransitionError(`Cannot change a ${current.status} schedule to ${status}`);
        }
        const [updated] = await this.connection.db.update(schedules).set({
            status, nextRunAt: status === 'active' ? initialRunAt(current.timing, now) : current.nextRunAt, updatedAt: now,
        }).where(eq(schedules.id, id)).returning();
        if (status === 'cancelled') {
            const queued = await this.connection.db.select().from(executions).where(and(
                eq(executions.scheduleId, id), eq(executions.status, 'queued'),
            ));
            for (const execution of queued) await this.cancelQueuedJob(execution);
            await this.connection.db.update(executions).set({ status: 'cancelled', finishedAt: now, updatedAt: now })
                .where(and(eq(executions.scheduleId, id), eq(executions.status, 'queued')));
            await this.purgeScheduleAssetsIfIdle(id);
        }
        return updated ?? null;
    }

    async materializeDue(now = new Date(), onlyScheduleId?: string): Promise<number> {
        let count = 0;
        await this.connection.db.transaction(async (tx) => {
            const conditions = onlyScheduleId
                ? sql`status = 'active' and next_run_at <= ${now} and id = ${onlyScheduleId}::uuid`
                : sql`status = 'active' and next_run_at <= ${now}`;
            interface DueRow {
                id: string; device_udid: string; plugin_id: string; task_type: string; task_version: number;
                payload: JsonObject; timing: ScheduleTiming; run_window_minutes: number; next_run_at: Date;
            }
            const result = await tx.execute(sql`select id, device_udid, plugin_id, task_type, task_version, payload,
                timing, run_window_minutes, next_run_at from scheduler.schedules where ${conditions}
                order by next_run_at for update skip locked limit 100`);
            for (const row of result.rows as unknown as DueRow[]) {
                const occurrence = latestDueOccurrence(row.timing, new Date(row.next_run_at), now);
                if (!occurrence) continue;
                const task: TaskEnvelope = {
                    pluginId: row.plugin_id, taskType: row.task_type, taskVersion: row.task_version, payload: row.payload,
                };
                const definition = this.plugins.task(task);
                const policy = definition.retryPolicy(task.payload);
                // Interval drains (every 5 min) with a 7-minute wait window used
                // to stack a second job behind a silent waitForDevice, which the
                // dashboard showed as one hung queued task. Hold nextRunAt until
                // the in-flight occurrence leaves queued/running.
                const [inflight] = await tx.select({ id: executions.id }).from(executions).where(and(
                    eq(executions.scheduleId, row.id),
                    inArray(executions.status, ['queued', 'running']),
                )).limit(1);
                if (inflight) continue;
                const [execution] = await tx.insert(executions).values({
                    scheduleId: row.id, deviceUdid: row.device_udid,
                    pluginId: row.plugin_id, taskType: row.task_type, taskVersion: row.task_version, payload: row.payload,
                    scheduledFor: occurrence.scheduledFor,
                    deadlineAt: new Date(occurrence.scheduledFor.getTime() + row.run_window_minutes * 60_000),
                }).onConflictDoNothing().returning();
                await tx.update(schedules).set({
                    nextRunAt: occurrence.nextRunAt, status: occurrence.nextRunAt ? 'active' : 'completed', updatedAt: now,
                }).where(eq(schedules.id, row.id));
                if (!execution) continue;
                const queueJobId = await this.boss.send(queueNameForDevice(row.device_udid), { executionId: execution.id }, {
                    db: fromDrizzle(tx, sql), retryLimit: policy.retryLimit,
                    retryDelay: policy.retryDelaySeconds, retryBackoff: policy.retryBackoff,
                    expireInSeconds: Math.max(900, Math.ceil(definition.estimateDurationMs(task.payload) / 1000) + 600),
                });
                if (!queueJobId) throw new Error('Queue rejected an execution job');
                await tx.update(executions).set({ queueJobId }).where(eq(executions.id, execution.id));
                count++;
            }
        });
        return count;
    }

    async startAttempt(id: string, attempt: number, now = new Date()): Promise<ExecutionRow | null> {
        const [row] = await this.connection.db.update(executions).set({
            status: 'running', startedAt: now, updatedAt: now, error: null,
        }).where(and(eq(executions.id, id), inArray(executions.status, ['queued', 'running']))).returning();
        if (!row) return null;
        await this.connection.db.insert(executionAttempts).values({ executionId: id, attempt }).onConflictDoNothing();
        return row;
    }

    async appendLogs(id: string, attempt: number, lines: string[]): Promise<void> {
        if (!lines.length) return;
        await this.connection.db.insert(executionLogs).values(lines.map((line) => ({ executionId: id, attempt, line })));
        // Heartbeat so reconcile does not treat a healthy long post as a zombie.
        await this.touchRunning(id);
    }

    /** Keep a running execution alive across wait-for-device polls that have nothing new to log. */
    async touchRunning(id: string): Promise<void> {
        await this.connection.db.update(executions).set({ updatedAt: new Date() })
            .where(and(eq(executions.id, id), eq(executions.status, 'running')));
    }

    async finishAttempt(id: string, attempt: number, exitCode: number | null, error?: string): Promise<void> {
        await this.connection.db.update(executionAttempts).set({ finishedAt: new Date(), exitCode, error })
            .where(and(eq(executionAttempts.executionId, id), eq(executionAttempts.attempt, attempt)));
    }

    async finishExecution(id: string, status: 'succeeded' | 'failed' | 'cancelled' | 'stopped', exitCode: number | null, error?: string): Promise<void> {
        await this.connection.db.update(executions).set({
            status, exitCode, error: error ?? null, finishedAt: new Date(), updatedAt: new Date(),
        }).where(eq(executions.id, id));
        await this.syncPipelineItemsForExecution(id, status, error);
        // Keep the media for retryable outcomes — the dashboard Retry button
        // accepts failed/stopped and would otherwise hit "asset is missing".
        // failed/stopped media is reclaimed by cleanup() once it ages out.
        if (status === 'succeeded' || status === 'cancelled') await this.purgeTerminalAssets(id);
    }

    async resetForRetry(id: string, error: string): Promise<void> {
        await this.connection.db.update(executions).set({ status: 'queued', error, updatedAt: new Date() }).where(eq(executions.id, id));
    }

    async stopRequested(id: string): Promise<boolean> {
        const [row] = await this.connection.db.select({ requested: executions.stopRequestedAt }).from(executions)
            .where(eq(executions.id, id)).limit(1);
        return Boolean(row?.requested);
    }

    async requestStop(id: string): Promise<'queued' | 'running' | 'not-found' | 'unsupported'> {
        const [execution] = await this.connection.db.select().from(executions).where(eq(executions.id, id)).limit(1);
        if (!execution) return 'not-found';
        if (execution.status === 'queued') {
            await this.cancelQueuedJob(execution);
            await this.finishExecution(id, 'cancelled', null, 'Cancelled before execution');
            return 'queued';
        }
        if (execution.status !== 'running') return 'unsupported';
        // If the plugin was uninstalled, still let the operator request a stop —
        // a running execution nobody can inspect is exactly what needs stopping.
        let supportsStop = true;
        try {
            supportsStop = this.plugins.task(taskEnvelope(execution)).supportsStop(execution.payload);
        } catch { /* plugin unavailable */ }
        if (!supportsStop) return 'unsupported';
        await this.connection.db.update(executions).set({ stopRequestedAt: new Date(), updatedAt: new Date() })
            .where(eq(executions.id, id));
        // Abort the active pg-boss job so waitForDevice / runProcess see the
        // signal immediately instead of sitting out the next 5s poll.
        if (execution.queueJobId) {
            try {
                await this.boss.cancel(queueNameForDevice(execution.deviceUdid), execution.queueJobId);
            } catch (error) {
                console.error(
                    `pg-boss cancel failed for running ${execution.id}:`,
                    error instanceof Error ? error.message : error,
                );
            }
        }
        return 'running';
    }

    /**
     * Cancel every queued job for a device and request stop on every running one.
     * Used by the device-page Clear queue control so operators are not stuck
     * cancelling one-by-one while Start silently stacks behind a backlog.
     */
    async clearDeviceQueue(
        deviceUdid: string,
        filter: { pluginId?: string; taskType?: string; onlyQueued?: boolean } = {},
    ): Promise<{ cancelled: number; stopping: number }> {
        const pending = await this.connection.db.select().from(executions).where(and(
            eq(executions.deviceUdid, deviceUdid),
            inArray(executions.status, filter.onlyQueued ? ['queued'] : ['queued', 'running']),
        ));
        let cancelled = 0;
        let stopping = 0;
        for (const execution of pending) {
            if (filter.pluginId && execution.pluginId !== filter.pluginId) continue;
            if (filter.taskType && execution.taskType !== filter.taskType) continue;
            if (execution.status === 'queued') {
                await this.cancelQueuedJob(execution);
                await this.finishExecution(execution.id, 'cancelled', null, 'Cleared from device queue');
                cancelled += 1;
                continue;
            }
            const result = await this.requestStop(execution.id);
            if (result === 'running') stopping += 1;
            else if (result === 'queued') cancelled += 1;
        }
        return { cancelled, stopping };
    }

    private async cancelQueuedJob(execution: ExecutionRow): Promise<void> {
        if (!execution.queueJobId) return;
        try {
            await this.boss.cancel(queueNameForDevice(execution.deviceUdid), execution.queueJobId);
        } catch (error) {
            console.error(
                `pg-boss cancel failed for ${execution.id}:`,
                error instanceof Error ? error.message : error,
            );
        }
    }

    async retryExecution(id: string, now = new Date()): Promise<ExecutionRow | null> {
        const [source] = await this.connection.db.select().from(executions).where(eq(executions.id, id)).limit(1);
        if (!source || !['failed', 'stopped'].includes(source.status)) return null;
        await ensureDeviceQueue(this.boss, source.deviceUdid);
        const definition = this.plugins.task(taskEnvelope(source));
        const policy = definition.retryPolicy(source.payload);
        let created: ExecutionRow | undefined;
        await this.connection.db.transaction(async (tx) => {
            [created] = await tx.insert(executions).values({
                scheduleId: source.scheduleId, deviceUdid: source.deviceUdid,
                pluginId: source.pluginId, taskType: source.taskType, taskVersion: source.taskVersion, payload: source.payload,
                scheduledFor: now, deadlineAt: new Date(now.getTime() + Number(process.env.SCHEDULER_RUN_WINDOW_MINUTES ?? 30) * 60_000),
            }).returning();
            if (!created) throw new Error('Unable to create retry execution');
            const jobId = await this.boss.send(queueNameForDevice(source.deviceUdid), { executionId: created.id }, {
                db: fromDrizzle(tx, sql), retryLimit: policy.retryLimit,
                retryDelay: policy.retryDelaySeconds, retryBackoff: policy.retryBackoff,
                // Match materializeDue — a retried multi-hour task must not be
                // expired by pg-boss's ~15-minute default while it's still running.
                expireInSeconds: Math.max(900, Math.ceil(definition.estimateDurationMs(source.payload) / 1000) + 600),
            });
            if (!jobId) throw new Error('Unable to enqueue retry execution');
            await tx.update(executions).set({ queueJobId: jobId }).where(eq(executions.id, created.id));
            created = { ...created, queueJobId: jobId };
        });
        return created ?? null;
    }

    async reconcileQueueStates(): Promise<number> {
        const pending = await this.connection.db.select().from(executions).where(inArray(executions.status, ['queued', 'running']));
        let changed = 0;
        for (const execution of pending) {
            const queue = queueNameForDevice(execution.deviceUdid);
            let job: { id: string; state?: string } | undefined;
            if (execution.queueJobId) {
                try {
                    const found = await this.boss.findJobs(queue, { id: execution.queueJobId });
                    job = found[0] as { id: string; state?: string } | undefined;
                } catch {
                    job = undefined;
                }
            }

            const ageMs = Date.now() - new Date(execution.updatedAt).getTime();
            const abandonAfterMs = this.runningAbandonGraceMs(execution);

            if (execution.status === 'running') {
                if (job?.state === 'retry') {
                    await this.resetForRetry(execution.id, 'Worker attempt interrupted; waiting for retry');
                    changed += 1;
                } else if (!job || job.state === 'failed' || job.state === 'cancelled' || job.state === 'completed') {
                    await this.finishExecution(
                        execution.id,
                        job?.state === 'cancelled' || execution.stopRequestedAt ? 'stopped' : 'failed',
                        null,
                        job ? `Queue job ${job.state}` : 'Queue job missing after worker restart',
                    );
                    changed += 1;
                } else if (
                    job.state === 'active'
                    && (ageMs > abandonAfterMs || (execution.stopRequestedAt && ageMs > 5_000))
                ) {
                    // Worker SIGTERM leaves the job "active" and blocks the singleton
                    // device queue forever — same class of ghost as queued orphans.
                    // Grace is task-duration based so long TikTok posts are not killed
                    // while still logging heartbeats.
                    await this.boss.cancel(queue, job.id).catch(() => {});
                    await this.finishExecution(
                        execution.id,
                        execution.stopRequestedAt ? 'stopped' : 'failed',
                        null,
                        'Abandoned active queue job after worker restart',
                    );
                    changed += 1;
                    console.log(`Finalized zombie running execution ${execution.id} (no heartbeat for ${Math.round(ageMs / 1000)}s)`);
                }
                continue;
            }

            // queued — re-enqueue when the pg-boss job is gone, finished, or left
            // "active" without ever flipping the execution to running (zombie after
            // a worker SIGTERM). Singleton device queues otherwise block forever.
            const missingOrDead = !job || job.state === 'failed' || job.state === 'cancelled' || job.state === 'completed';
            const zombieActive = job?.state === 'active' && ageMs > 45_000;
            if (!missingOrDead && !zombieActive) continue;
            try {
                if (job && (job.state === 'active' || job.state === 'created')) {
                    await this.boss.cancel(queue, job.id).catch(() => {});
                }
                await this.requeueQueuedExecution(execution);
                changed += 1;
                console.log(`Requeued orphaned execution ${execution.id} (was job state=${job?.state ?? 'missing'})`);
            } catch (error) {
                console.error(`Failed to requeue ${execution.id}:`, error);
            }
        }
        changed += await this.releaseOrphanedPublishingItems();
        return changed;
    }

    /** How long a running job may go without an updatedAt heartbeat before reconcile abandons it. */
    private runningAbandonGraceMs(execution: ExecutionRow): number {
        const configured = Number(process.env.SCHEDULER_RUNNING_ABANDON_MS);
        if (Number.isFinite(configured) && configured >= 60_000) return configured;
        let estimate = 60_000;
        try {
            estimate = this.plugins.task(taskEnvelope(execution)).estimateDurationMs(execution.payload);
        } catch { /* plugin unavailable */ }
        // Posts routinely run 2–5+ minutes; keep a floor so short estimates never
        // recreate the old 45s false-abandon.
        return Math.min(15 * 60_000, Math.max(5 * 60_000, estimate + 2 * 60_000));
    }

    /**
     * If a drain/post dies outside task.execute (reconcile abandon, SIGTERM),
     * pipeline items can be left in publishing forever. Release them back to ready.
     */
    private async syncPipelineItemsForExecution(
        executionId: string,
        status: 'succeeded' | 'failed' | 'cancelled' | 'stopped',
        error?: string,
    ): Promise<void> {
        if (status === 'succeeded') {
            await this.connection.db.update(pipelineItems).set({
                status: 'published', publishedAt: new Date(), updatedAt: new Date(), error: null, assetId: null,
            }).where(and(eq(pipelineItems.executionId, executionId), eq(pipelineItems.status, 'publishing')));
            return;
        }
        const message = error?.trim() || `Execution ${status}`;
        // Do not auto-requeue — a half-finished TikTok post must not silently retry
        // and risk publishing the wrong camera-roll clip.
        await this.connection.db.update(pipelineItems).set({
            status: 'failed',
            error: message,
            updatedAt: new Date(),
        }).where(and(eq(pipelineItems.executionId, executionId), eq(pipelineItems.status, 'publishing')));
    }

    /** Catch publishing rows whose execution already finished but never synced. */
    private async releaseOrphanedPublishingItems(): Promise<number> {
        const published = await this.connection.db.execute(sql`
            update scheduler.pipeline_items as p
            set status = 'published',
                published_at = coalesce(p.published_at, now()),
                asset_id = null,
                error = null,
                updated_at = now()
            from scheduler.executions as e
            where p.execution_id = e.id
              and p.status = 'publishing'
              and e.status = 'succeeded'
            returning p.id
        `);
        const failed = await this.connection.db.execute(sql`
            update scheduler.pipeline_items as p
            set status = 'failed',
                error = coalesce(e.error, 'Released after execution ended'),
                updated_at = now()
            from scheduler.executions as e
            where p.execution_id = e.id
              and p.status = 'publishing'
              and e.status in ('failed', 'cancelled', 'stopped', 'skipped')
            returning p.id
        `);
        return (published.rows as unknown[]).length + (failed.rows as unknown[]).length;
    }

    /** Send a fresh pg-boss job for an execution that is still marked queued. */
    private async requeueQueuedExecution(execution: ExecutionRow): Promise<void> {
        const task = taskEnvelope(execution);
        const definition = this.plugins.task(task);
        const policy = definition.retryPolicy(execution.payload);
        await ensureDeviceQueue(this.boss, execution.deviceUdid);
        const queueJobId = await this.boss.send(queueNameForDevice(execution.deviceUdid), { executionId: execution.id }, {
            retryLimit: policy.retryLimit,
            retryDelay: policy.retryDelaySeconds,
            retryBackoff: policy.retryBackoff,
            expireInSeconds: Math.max(900, Math.ceil(definition.estimateDurationMs(execution.payload) / 1000) + 600),
        });
        if (!queueJobId) throw new Error(`Queue rejected requeue for ${execution.id}`);
        await this.connection.db.update(executions).set({
            queueJobId,
            error: null,
            updatedAt: new Date(),
        }).where(and(eq(executions.id, execution.id), eq(executions.status, 'queued')));
    }

    async cleanup(historyDays = Number(process.env.SCHEDULER_HISTORY_DAYS ?? 30)): Promise<number> {
        const cutoff = new Date(Date.now() - historyDays * 86_400_000);
        const expired = await this.connection.db.select().from(executions).where(and(
            lt(executions.finishedAt, cutoff), inArray(executions.status, ['succeeded', 'failed', 'cancelled', 'skipped', 'stopped']),
        ));
        for (const execution of expired) await this.purgeTerminalAssets(execution.id);
        const removed = await this.connection.db.delete(executions).where(and(
            lt(executions.finishedAt, cutoff), inArray(executions.status, ['succeeded', 'failed', 'cancelled', 'skipped', 'stopped']),
        )).returning({ id: executions.id });
        return removed.length;
    }

    /** Media uploaded via POST /api/assets but never attached to a schedule (abandoned post form). */
    async sweepOrphanedAssets(olderThanHours = Number(process.env.SCHEDULER_ORPHAN_ASSET_HOURS)): Promise<number> {
        // A destructive job — an empty/NaN env must not collapse the window to 0.
        const hours = Number.isFinite(olderThanHours) && olderThanHours >= 1 ? olderThanHours : 24;
        const cutoff = new Date(Date.now() - hours * 3_600_000);
        const rows = await this.connection.db.select({ id: assets.id }).from(assets).where(and(
            isNull(assets.scheduleId), isNull(assets.executionId), lt(assets.createdAt, cutoff),
            sql`not exists (
                select 1 from scheduler.pipeline_items p
                where p.asset_id = ${assets.id}
                  and p.status in ('ready', 'publishing', 'failed')
            )`,
        ));
        await this.purgeAssetIds(rows.map(({ id }) => id));
        return rows.length;
    }

    async enqueuePipelineItem(input: {
        deviceUdid: string;
        assetId: string;
        caption?: string;
    }): Promise<PipelineItemRow> {
        const [row] = await this.connection.db.insert(pipelineItems).values({
            deviceUdid: input.deviceUdid,
            assetId: input.assetId,
            caption: input.caption?.trim() || null,
            status: 'ready',
        }).returning();
        if (!row) throw new Error('Unable to enqueue pipeline item');
        return row;
    }

    async listPipelineItems(deviceUdid: string, limit = 50): Promise<Array<PipelineItemRow & { assetName: string | null; mimeType: string | null }>> {
        const rows = await this.connection.db.select({
            item: pipelineItems,
            assetName: assets.originalName,
            mimeType: assets.mimeType,
        }).from(pipelineItems)
            .leftJoin(assets, eq(pipelineItems.assetId, assets.id))
            .where(eq(pipelineItems.deviceUdid, deviceUdid))
            .orderBy(desc(pipelineItems.createdAt))
            .limit(limit);
        return rows.map(({ item, assetName, mimeType }) => ({ ...item, assetName, mimeType }));
    }

    async cancelPipelineItem(id: string, deviceUdid: string): Promise<PipelineItemRow | null> {
        const [row] = await this.connection.db.select().from(pipelineItems).where(and(
            eq(pipelineItems.id, id),
            eq(pipelineItems.deviceUdid, deviceUdid),
            inArray(pipelineItems.status, ['ready', 'failed']),
        )).limit(1);
        if (!row) return null;
        const assetId = row.assetId;
        await this.connection.db.delete(pipelineItems).where(eq(pipelineItems.id, id));
        if (assetId) await this.purgeAssetIds([assetId]);
        return { ...row, status: 'cancelled', updatedAt: new Date() };
    }

    async claimNextPipelineItem(deviceUdid: string, executionId: string): Promise<PipelineClaim | null> {
        const claimed = await this.connection.db.transaction(async (tx) => {
            const result = await tx.execute(sql`
                update scheduler.pipeline_items
                set status = 'publishing', execution_id = ${executionId}::uuid, updated_at = now(), error = null
                where id = (
                    select id from scheduler.pipeline_items
                    where device_udid = ${deviceUdid} and status = 'ready' and asset_id is not null
                    order by created_at asc
                    for update skip locked
                    limit 1
                )
                returning id, caption, asset_id
            `);
            const row = (result.rows as Array<{ id: string; caption: string | null; asset_id: string | null }>)[0];
            if (!row?.asset_id) return null;
            await tx.update(assets).set({ executionId }).where(eq(assets.id, row.asset_id));
            return row as { id: string; caption: string | null; asset_id: string };
        });
        if (!claimed) return null;
        const [assetRow] = await this.connection.db.select().from(assets).where(eq(assets.id, claimed.asset_id)).limit(1);
        if (!assetRow) {
            await this.failPipelineItem(claimed.id, `Pipeline media asset ${claimed.asset_id} is missing`);
            return null;
        }
        const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        const filePath = path.resolve(root, assetRow.relativePath);
        try {
            await access(filePath);
        } catch {
            await this.failPipelineItem(claimed.id, `Pipeline media file is missing on disk (${assetRow.originalName})`);
            return null;
        }
        return {
            id: claimed.id,
            caption: claimed.caption,
            asset: {
                id: assetRow.id,
                path: filePath,
                name: assetRow.originalName,
                mimeType: assetRow.mimeType,
                size: assetRow.size,
                sha256: assetRow.sha256,
            },
        };
    }

    async completePipelineItem(id: string): Promise<void> {
        // Detach media so finishExecution can purge the file without hitting the FK.
        await this.connection.db.update(pipelineItems).set({
            status: 'published', publishedAt: new Date(), updatedAt: new Date(), error: null, assetId: null,
        }).where(eq(pipelineItems.id, id));
    }

    async failPipelineItem(id: string, error: string): Promise<void> {
        await this.connection.db.update(pipelineItems).set({
            status: 'failed', error, updatedAt: new Date(),
        }).where(eq(pipelineItems.id, id));
    }

    private async purgeTerminalAssets(executionId: string): Promise<void> {
        const [execution] = await this.connection.db.select().from(executions).where(eq(executions.id, executionId)).limit(1);
        if (!execution) return;
        if (execution.scheduleId) {
            const [schedule] = await this.connection.db.select().from(schedules).where(eq(schedules.id, execution.scheduleId)).limit(1);
            if (schedule && ['daily', 'weekly', 'interval'].includes(schedule.timing.kind) && schedule.status !== 'cancelled') return;
        }
        const rows = await this.connection.db.select({ id: assets.id }).from(assets).where(or(
            eq(assets.executionId, executionId),
            ...(execution.scheduleId ? [eq(assets.scheduleId, execution.scheduleId)] : []),
        ));
        await this.purgeAssetIds(rows.map(({ id }) => id));
    }

    private async purgeScheduleAssetsIfIdle(scheduleId: string): Promise<void> {
        const [running] = await this.connection.db.select({ id: executions.id }).from(executions).where(and(
            eq(executions.scheduleId, scheduleId), eq(executions.status, 'running'),
        )).limit(1);
        if (running) return;
        const rows = await this.connection.db.select({ id: assets.id }).from(assets).where(eq(assets.scheduleId, scheduleId));
        await this.purgeAssetIds(rows.map(({ id }) => id));
    }

    private async purgeAssetIds(ids: string[]): Promise<void> {
        if (!ids.length) return;
        const rows = await this.connection.db.select().from(assets).where(inArray(assets.id, ids));
        const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        for (const asset of rows) {
            const file = path.resolve(root, asset.relativePath);
            if (file.startsWith(`${root}${path.sep}`)) await rm(file, { force: true });
        }
        await this.connection.db.delete(assets).where(inArray(assets.id, ids));
    }
}
