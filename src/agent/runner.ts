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
import { appHintsFor } from './playbook.js';
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
    /** Timestamped, human-readable lines — the same kind of relay the static workflows stream. */
    log: string[];
    usage: VlmUsage;
    estimatedCostUsd: number;
}

const LOG_LINE_LIMIT = 600;

function appendLog(run: AgentRun, message: string): void {
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    run.log.push(`${stamp}  ${message}`);
    if (run.log.length > LOG_LINE_LIMIT) run.log.splice(0, run.log.length - LOG_LINE_LIMIT);
}

export interface AgentRunnerOptions {
    remote: AgentRemote;
    model: VisionModel | null;
    dataDir?: string;
    /** "cloud" (metered API) or "local" (on-device model, $0). Defaults to cloud. */
    flavor?: 'cloud' | 'local';
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

const REPEAT_TAP_RADIUS_PT = 12;

/**
 * Tapping the exact spot you just tapped is almost always a toggle flapping
 * (like → unlike, follow → unfollow). Refuse it and tell the model why; the
 * message goes back into its history as the outcome of this turn.
 */
export function repeatedTapGuard(action: AgentAction, earlierSteps: AgentStep[]): string | null {
    if (action.type !== 'tap') return null;
    // Compare with the last action that actually reached the phone — blocked or failed turns don't count.
    const previous = [...earlierSteps].reverse().find((step) => step.result === 'ok' && step.action);
    if (!previous?.action || previous.action.type !== 'tap') return null;
    const near = Math.abs(action.x - previous.action.x) <= REPEAT_TAP_RADIUS_PT && Math.abs(action.y - previous.action.y) <= REPEAT_TAP_RADIUS_PT;
    if (!near) return null;
    const label = action.target ?? previous.action.target ?? `(${action.x}, ${action.y})`;
    return `Blocked: your last executed action already tapped ${label}. Tapping it again would UNDO it (toggles flip), so it was not performed. `
        + 'Do NOT tap it again. Scroll down to the next item (or pick a different element) now. If you truly must tap it again, call wait first.';
}

function estimateCost(model: string, usage: VlmUsage, flavor: 'cloud' | 'local'): number {
    if (flavor === 'local') return 0;
    const key = Object.keys(PRICING).find((name) => model.startsWith(name));
    const price = key ? PRICING[key]! : PRICING['claude-haiku-4-5']!;
    return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/** Runs saved before the log existed: rebuild a relay from their recorded steps. */
function reconstructLog(run: AgentRun): string[] {
    const stamp = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
    const lines = [`${stamp(run.createdAt)}  Agent run started on ${run.deviceName}`, `${stamp(run.createdAt)}  Goal: ${run.goal}`];
    for (const step of run.steps) {
        const stepNo = `Step ${step.index + 1}/${run.maxSteps}`;
        const at = stamp(step.startedAt);
        lines.push(`${at}  ${stepNo} · On ${step.app ?? 'unknown screen'} · ${step.elementCount} elements${step.locked ? ' · locked' : ''}`);
        if (step.reasoning) lines.push(`${at}  ${stepNo} · Reason — ${step.reasoning}`);
        lines.push(`${at}  ${stepNo} · Act — ${step.actionLabel}`);
        if (step.result === 'error') lines.push(`${at}  ${stepNo} · Action failed ✕ ${step.error ?? ''}`);
    }
    const end = stamp(run.finishedAt ?? run.createdAt);
    if (run.summary) lines.push(`${end}  ✓ Goal reached — ${run.summary}`);
    else if (run.error) lines.push(`${end}  ✕ ${run.error}`);
    lines.push(`${end}  Finished · ${run.status} · ${run.steps.length} step${run.steps.length === 1 ? '' : 's'}`);
    return lines;
}

function publicRun(run: AgentRun): AgentRun {
    return { ...run, steps: run.steps.map((step) => ({ ...step })) };
}

export class AgentRunner {
    private readonly runs = new Map<string, AgentRun>();
    private readonly stopRequested = new Set<string>();
    private readonly active = new Map<string, string>(); // deviceUdid → runId
    readonly dataDir: string;
    readonly flavor: 'cloud' | 'local';
    private loaded: Promise<void> | null = null;

    constructor(private readonly options: AgentRunnerOptions) {
        this.flavor = options.flavor ?? 'cloud';
        const envDir = this.flavor === 'local' ? process.env.AGENT_LOCAL_DATA_DIR : process.env.AGENT_DATA_DIR;
        this.dataDir = options.dataDir ?? path.resolve(envDir ?? path.join('data', this.flavor === 'local' ? 'agent-local' : 'agent'));
    }

    get configured(): boolean {
        return this.options.model !== null;
    }

    get model(): VisionModel | null {
        return this.options.model;
    }

    /** True while this runner is driving the given phone. Lets sibling runners refuse to double-book it. */
    isActiveOn(udid: string): boolean {
        return this.active.has(udid);
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
                        run.log ??= reconstructLog(run);
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
            .map((run) => ({ ...publicRun(run), log: [], steps: run.steps.map((step) => ({ ...step, reasoning: step.reasoning.slice(0, 160) })) }));
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
            throw new AgentRunnerError('This phone is busy — a scheduled automation or another agent run is using it. Wait for it to finish or stop it first.', 409);
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
            log: [],
            usage: { inputTokens: 0, outputTokens: 0 },
            estimatedCostUsd: 0,
        };
        appendLog(run, `Agent run started on ${run.deviceName}`);
        appendLog(run, `Goal: ${goal}`);
        appendLog(run, `Model ${run.model} · up to ${maxSteps} steps`);
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
            appendLog(run, 'Checking that the phone is unlocked');
            const unlock = await device.ensureUnlocked();
            if (unlock.note) {
                run.notes.push(unlock.note);
                appendLog(run, unlock.note);
            }

            for (let index = 0; index < run.maxSteps; index += 1) {
                if (this.stopRequested.has(run.id)) {
                    run.status = 'stopped';
                    run.error = 'Stopped by operator.';
                    appendLog(run, 'Stopped by operator');
                    break;
                }
                const startedAt = Date.now();
                const stepNo = `Step ${index + 1}/${run.maxSteps}`;
                appendLog(run, `${stepNo} · Observe — screenshot + accessibility tree`);
                const observation = await device.observe();
                const screenshot = `step-${String(index + 1).padStart(2, '0')}.jpg`;
                await writeFile(path.join(this.dataDir, run.id, screenshot), observation.image);
                appendLog(run, `${stepNo} · On ${observation.app ?? 'unknown screen'} · ${observation.hierarchy.total} elements${observation.locked ? ' · locked' : ''}`);

                const unchanged = lastFingerprint !== null && observation.fingerprint === lastFingerprint;
                unchangedRepeats = unchanged ? unchangedRepeats + 1 : 0;
                const nudge = unchangedRepeats >= 2 && lastActionLabel
                    ? `The screen has not changed after your last ${unchangedRepeats} actions (last: ${lastActionLabel}). Do something different.`
                    : undefined;
                if (nudge) appendLog(run, `${stepNo} · Screen unchanged ${unchangedRepeats}× — nudging the model to try something else`);

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
                    appHints: appHintsFor(observation.app),
                });
                step.reasoning = decision.reasoning;
                const normalized = normalizeCoordinates(decision.action, observation.screen, observation.imageSize);
                decision.action = normalized.action;
                step.action = decision.action;
                step.actionLabel = describeAction(decision.action) + (normalized.rescaled ? ' · rescaled from image px' : '');
                step.usage = decision.usage;
                run.usage.inputTokens += decision.usage.inputTokens;
                run.usage.outputTokens += decision.usage.outputTokens;
                run.estimatedCostUsd = estimateCost(run.model, run.usage, this.flavor);
                if (decision.reasoning) appendLog(run, `${stepNo} · Reason — ${decision.reasoning}`);
                appendLog(run, `${stepNo} · Act — ${step.actionLabel}`);

                if (decision.action.type === 'done') {
                    step.result = 'ok';
                    step.durationMs = Date.now() - startedAt;
                    run.status = 'succeeded';
                    run.summary = decision.action.summary;
                    appendLog(run, `✓ Goal reached — ${run.summary}`);
                    await this.persist(run);
                    break;
                }
                if (decision.action.type === 'fail') {
                    step.result = 'ok';
                    step.durationMs = Date.now() - startedAt;
                    run.status = 'failed';
                    run.error = decision.action.reason;
                    appendLog(run, `✕ Model gave up — ${run.error}`);
                    await this.persist(run);
                    break;
                }
                if (this.stopRequested.has(run.id)) {
                    step.result = 'ok';
                    step.error = 'Not executed — stop requested.';
                    step.durationMs = Date.now() - startedAt;
                    run.status = 'stopped';
                    run.error = 'Stopped by operator.';
                    appendLog(run, 'Stopped by operator — action not executed');
                    await this.persist(run);
                    break;
                }
                const flap = repeatedTapGuard(decision.action, run.steps.slice(0, -1));
                if (flap) {
                    step.result = 'error';
                    step.error = flap;
                    appendLog(run, `${stepNo} · Blocked ✕ ${flap}`);
                    step.durationMs = Date.now() - startedAt;
                    lastFingerprint = observation.fingerprint;
                    lastActionLabel = step.actionLabel;
                    await this.persist(run);
                    continue;
                }
                try {
                    await device.perform(decision.action);
                    step.result = 'ok';
                    appendLog(run, `${stepNo} · Executed ✓`);
                } catch (error) {
                    step.result = 'error';
                    step.error = error instanceof Error ? error.message : String(error);
                    appendLog(run, `${stepNo} · Action failed ✕ ${step.error}`);
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
                appendLog(run, `✕ ${run.error}`);
            }
        } catch (error) {
            run.status = this.stopRequested.has(run.id) ? 'stopped' : 'failed';
            run.error = error instanceof Error ? error.message : String(error);
            if (/WebDriverAgent is unavailable/i.test(run.error)) {
                run.error += ' — WDA is not running for this phone. Unlock it (or store its passcode) and check the device page; WDA starts automatically once the phone is unlocked.';
            }
            appendLog(run, `✕ ${run.status === 'stopped' ? 'Stopped' : 'Run failed'} — ${run.error}`);
            const pending = run.steps.at(-1);
            if (pending && pending.result === 'pending') {
                pending.result = 'error';
                pending.error = run.error;
                pending.actionLabel = 'no action';
            }
        } finally {
            run.finishedAt = new Date().toISOString();
            const cost = this.flavor === 'local' ? 'local · $0' : `~$${run.estimatedCostUsd.toFixed(4)}`;
            appendLog(run, `Finished · ${run.status} · ${run.steps.length} step${run.steps.length === 1 ? '' : 's'} · ${run.usage.inputTokens + run.usage.outputTokens} tokens · ${cost}`);
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
