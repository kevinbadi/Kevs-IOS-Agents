/**
 * Agent mode execution kernel.
 *
 *   Observe  — screenshot + accessibility XML from WebDriverAgent
 *   Reason   — the VLM maps the goal onto the screen and picks one tool call
 *   Act      — the tool call becomes a WDA gesture / keystroke / app launch
 *   Evaluate — the next observation is fed back so the model can verify
 *
 * Runs live in memory while the web process is up and are mirrored to
 * data/agent/<runId>/run.json (plus one annotated JPEG per step).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import { describeAction, normalizeCoordinates, type AgentAction } from './actions.js';
import { AgentDevice, type AgentRemote } from './device.js';
import type { VisionModel, VlmUsage } from './vlm.js';

export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'stopped';

export interface AgentStep {
    index: number;
    startedAt: string;
    durationMs: number;
    screen: { width: number; height: number };
    screenshot: string | null;
    elementCount: number;
    /** Foreground app reported by the accessibility tree at observation time. */
    app: string | null;
    locked: boolean;
    reasoning: string;
    action: AgentAction | null;
    actionLabel: string;
    result: 'ok' | 'error' | 'pending';
    error?: string;
    usage: VlmUsage;
}

export interface AgentRun {
    id: string;
    deviceUdid: string;
    deviceName: string;
    goal: string;
    model: string;
    maxSteps: number;
    status: AgentRunStatus;
    createdAt: string;
    finishedAt: string | null;
    steps: AgentStep[];
    summary: string | null;
    error: string | null;
    notes: string[];
    usage: VlmUsage;
    estimatedCostUsd: number;
}

export interface AgentRunnerOptions {
    remote: AgentRemote;
    model: VisionModel | null;
    dataDir?: string;
    /** True when the scheduler already has a queued/running task on this phone. */
    isDeviceBusy?(udid: string): Promise<boolean>;
    deviceName?(udid: string): Promise<string | undefined>;
    /** Pause after each action before re-observing. */
    settleMs?: number;
    defaultMaxSteps?: number;
}

export class AgentRunnerError extends Error {
    constructor(message: string, readonly statusCode = 400) {
        super(message);
    }
}

const RUN_ID = /^[0-9a-f-]{36}$/;
export const AGENT_MAX_STEPS_LIMIT = 60;

// USD per million tokens; used only for the on-screen estimate.
const PRICING: Record<string, { input: number; output: number }> = {
    'claude-haiku-4-5': { input: 1, output: 5 },
    'claude-sonnet-5': { input: 2, output: 10 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
};

function estimateCost(model: string, usage: VlmUsage): number {
    const key = Object.keys(PRICING).find((name) => model.startsWith(name));
    const price = key ? PRICING[key]! : PRICING['claude-haiku-4-5']!;
    return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

function publicRun(run: AgentRun): AgentRun {
    return { ...run, steps: run.steps.map((step) => ({ ...step })) };
}

export class AgentRunner {
    private readonly runs = new Map<string, AgentRun>();
    private readonly stopRequested = new Set<string>();
    private readonly active = new Map<string, string>(); // deviceUdid → runId
    readonly dataDir: string;
    private loaded: Promise<void> | null = null;

    constructor(private readonly options: AgentRunnerOptions) {
        this.dataDir = options.dataDir ?? path.resolve(process.env.AGENT_DATA_DIR ?? path.join('data', 'agent'));
    }

    get configured(): boolean {
        return this.options.model !== null;
    }

    get modelName(): string | null {
        return this.options.model?.model ?? null;
    }

    get defaultMaxSteps(): number {
        const fromEnv = Number(process.env.AGENT_MAX_STEPS);
        const preferred = this.options.defaultMaxSteps ?? (Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : 20);
        return Math.min(AGENT_MAX_STEPS_LIMIT, Math.max(1, preferred));
    }

    /** Restore finished runs from disk so the page shows history across restarts. */
    async loadFromDisk(): Promise<void> {
        if (!this.loaded) {
            this.loaded = (async () => {
                let entries: string[] = [];
                try {
                    entries = await readdir(this.dataDir);
                } catch {
                    return;
                }
                for (const entry of entries) {
                    if (!RUN_ID.test(entry) || this.runs.has(entry)) continue;
                    try {
                        const run = JSON.parse(await readFile(path.join(this.dataDir, entry, 'run.json'), 'utf8')) as AgentRun;
                        if (run.status === 'running') {
                            run.status = 'stopped';
                            run.error = 'The dashboard restarted while this run was in progress.';
                            run.finishedAt = run.finishedAt ?? new Date().toISOString();
                        }
                        this.runs.set(run.id, run);
                    } catch {
                        // Ignore partial or corrupt run folders.
                    }
                }
            })();
        }
        await this.loaded;
    }

    async list(deviceUdid?: string, limit = 30): Promise<AgentRun[]> {
        await this.loadFromDisk();
        return [...this.runs.values()]
            .filter((run) => !deviceUdid || run.deviceUdid === deviceUdid)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
            .map((run) => ({ ...publicRun(run), steps: run.steps.map((step) => ({ ...step, reasoning: step.reasoning.slice(0, 160) })) }));
    }

    async get(id: string): Promise<AgentRun | null> {
        await this.loadFromDisk();
        const run = this.runs.get(id);
        return run ? publicRun(run) : null;
    }

    screenshotPath(id: string, stepIndex: number): string | null {
        const run = this.runs.get(id);
        const step = run?.steps[stepIndex];
        if (!run || !step?.screenshot || !RUN_ID.test(id)) return null;
        return path.join(this.dataDir, id, step.screenshot);
    }

    async start(input: { deviceUdid: string; goal: string; maxSteps?: number }): Promise<AgentRun> {
        await this.loadFromDisk();
        const model = this.options.model;
        if (!model) {
            throw new AgentRunnerError('Agent mode is not configured. Add ANTHROPIC_API_KEY to .env and restart the dashboard.', 409);
        }
        const goal = input.goal?.trim();
        if (!goal) throw new AgentRunnerError('Describe the goal first');
        if (goal.length > 1_000) throw new AgentRunnerError('Keep the goal under 1000 characters');
        if (!input.deviceUdid) throw new AgentRunnerError('Pick a device');
        if (this.active.has(input.deviceUdid)) {
            throw new AgentRunnerError('An agent run is already active on this phone. Stop it first.', 409);
        }
        if (await this.options.isDeviceBusy?.(input.deviceUdid)) {
            throw new AgentRunnerError('This phone has a scheduled automation queued or running. Wait for it to finish or stop it from the device page.', 409);
        }
        const requested = Number(input.maxSteps ?? this.defaultMaxSteps);
        const maxSteps = Number.isInteger(requested) ? Math.min(AGENT_MAX_STEPS_LIMIT, Math.max(1, requested)) : this.defaultMaxSteps;

        const run: AgentRun = {
            id: crypto.randomUUID(),
            deviceUdid: input.deviceUdid,
            deviceName: (await this.options.deviceName?.(input.deviceUdid)) ?? input.deviceUdid,
            goal,
            model: model.model,
            maxSteps,
            status: 'running',
            createdAt: new Date().toISOString(),
            finishedAt: null,
            steps: [],
            summary: null,
            error: null,
            notes: [],
            usage: { inputTokens: 0, outputTokens: 0 },
            estimatedCostUsd: 0,
        };
        this.runs.set(run.id, run);
        this.active.set(run.deviceUdid, run.id);
        await mkdir(path.join(this.dataDir, run.id), { recursive: true });
        await this.persist(run);
        void this.execute(run, model);
        return publicRun(run);
    }

    async stop(id: string): Promise<AgentRun | null> {
        const run = this.runs.get(id);
        if (!run) return null;
        if (run.status === 'running') this.stopRequested.add(id);
        return publicRun(run);
    }

    private async execute(run: AgentRun, model: VisionModel): Promise<void> {
        const device = new AgentDevice(this.options.remote, run.deviceUdid);
        const settleMs = this.options.settleMs ?? 1_200;
        let lastFingerprint: string | null = null;
        let lastActionLabel: string | null = null;
        let unchangedRepeats = 0;
        try {
            const unlock = await device.ensureUnlocked();
            if (unlock.note) run.notes.push(unlock.note);

            for (let index = 0; index < run.maxSteps; index += 1) {
                if (this.stopRequested.has(run.id)) {
                    run.status = 'stopped';
                    run.error = 'Stopped by operator.';
                    break;
                }
                const startedAt = Date.now();
                const observation = await device.observe();
                const screenshot = `step-${String(index + 1).padStart(2, '0')}.jpg`;
                await writeFile(path.join(this.dataDir, run.id, screenshot), observation.image);

                const unchanged = lastFingerprint !== null && observation.fingerprint === lastFingerprint;
                unchangedRepeats = unchanged ? unchangedRepeats + 1 : 0;
                const nudge = unchangedRepeats >= 2 && lastActionLabel
                    ? `The screen has not changed after your last ${unchangedRepeats} actions (last: ${lastActionLabel}). Do something different.`
                    : undefined;

                const step: AgentStep = {
                    index,
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: 0,
                    screen: observation.screen,
                    screenshot,
                    elementCount: observation.hierarchy.total,
                    app: observation.app,
                    locked: observation.locked,
                    reasoning: '',
                    action: null,
                    actionLabel: 'thinking…',
                    result: 'pending',
                    usage: { inputTokens: 0, outputTokens: 0 },
                };
                run.steps.push(step);

                const decision = await model.decide({
                    goal: run.goal,
                    stepIndex: index,
                    maxSteps: run.maxSteps,
                    screen: observation.screen,
                    screenshot: observation.image,
                    hierarchy: observation.hierarchy.text,
                    hierarchyTruncated: observation.hierarchy.truncated,
                    history: run.steps.slice(0, -1).flatMap((previous) => (previous.action ? [{
                        app: previous.app,
                        elementCount: previous.elementCount,
                        reasoning: previous.reasoning,
                        action: previous.action,
                        outcome: previous.result === 'error' ? `FAILED: ${previous.error}` : 'Executed.',
                    }] : [])),
                    locked: observation.locked,
                    nudge,
                });
                step.reasoning = decision.reasoning;
                const normalized = normalizeCoordinates(decision.action, observation.screen, observation.imageSize);
                decision.action = normalized.action;
                step.action = decision.action;
                step.actionLabel = describeAction(decision.action) + (normalized.rescaled ? ' · rescaled from image px' : '');
                step.usage = decision.usage;
                run.usage.inputTokens += decision.usage.inputTokens;
                run.usage.outputTokens += decision.usage.outputTokens;
                run.estimatedCostUsd = estimateCost(run.model, run.usage);

                if (decision.action.type === 'done') {
                    step.result = 'ok';
                    step.durationMs = Date.now() - startedAt;
                    run.status = 'succeeded';
                    run.summary = decision.action.summary;
                    await this.persist(run);
                    break;
                }
                if (decision.action.type === 'fail') {
                    step.result = 'ok';
                    step.durationMs = Date.now() - startedAt;
                    run.status = 'failed';
                    run.error = decision.action.reason;
                    await this.persist(run);
                    break;
                }
                if (this.stopRequested.has(run.id)) {
                    step.result = 'ok';
                    step.error = 'Not executed — stop requested.';
                    step.durationMs = Date.now() - startedAt;
                    run.status = 'stopped';
                    run.error = 'Stopped by operator.';
                    await this.persist(run);
                    break;
                }
                try {
                    await device.perform(decision.action);
                    step.result = 'ok';
                } catch (error) {
                    step.result = 'error';
                    step.error = error instanceof Error ? error.message : String(error);
                }
                step.durationMs = Date.now() - startedAt;
                lastFingerprint = observation.fingerprint;
                lastActionLabel = step.actionLabel;
                await this.persist(run);
                if (decision.action.type !== 'wait') await new Promise((resolve) => setTimeout(resolve, settleMs));
            }
            if (run.status === 'running') {
                run.status = 'failed';
                run.error = `Reached the ${run.maxSteps}-step limit without finishing.`;
            }
        } catch (error) {
            run.status = this.stopRequested.has(run.id) ? 'stopped' : 'failed';
            run.error = error instanceof Error ? error.message : String(error);
            if (/WebDriverAgent is unavailable/i.test(run.error)) {
                run.error += ' — WDA is not running for this phone. Unlock it (or store its passcode) and check the device page; WDA starts automatically once the phone is unlocked.';
            }
            const pending = run.steps.at(-1);
            if (pending && pending.result === 'pending') {
                pending.result = 'error';
                pending.error = run.error;
                pending.actionLabel = 'no action';
            }
        } finally {
            run.finishedAt = new Date().toISOString();
            this.active.delete(run.deviceUdid);
            this.stopRequested.delete(run.id);
            await device.release();
            await this.persist(run);
        }
    }

    private async persist(run: AgentRun): Promise<void> {
        try {
            await writeFile(path.join(this.dataDir, run.id, 'run.json'), JSON.stringify(run, null, 2));
        } catch {
            // Disk mirroring is best effort; the in-memory run is authoritative.
        }
    }
}
