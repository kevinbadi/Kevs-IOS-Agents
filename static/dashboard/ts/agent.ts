export {};

type RunStatus = 'running' | 'succeeded' | 'failed' | 'stopped';

type AgentAction =
    | { type: 'tap'; x: number; y: number; target?: string }
    | { type: 'long_press'; x: number; y: number; durationMs: number; target?: string }
    | { type: 'swipe'; startX: number; startY: number; endX: number; endY: number; durationMs: number }
    | { type: 'type_text'; text: string }
    | { type: 'press_home' }
    | { type: 'open_app'; bundleId: string }
    | { type: 'wait'; seconds: number }
    | { type: 'done'; summary: string }
    | { type: 'fail'; reason: string };

interface AgentStep {
    index: number;
    startedAt: string;
    durationMs: number;
    screen: { width: number; height: number };
    screenshot: string | null;
    elementCount: number;
    locked: boolean;
    reasoning: string;
    action: AgentAction | null;
    actionLabel: string;
    result: 'ok' | 'error' | 'pending';
    error?: string;
    usage: { inputTokens: number; outputTokens: number };
}

interface AgentRun {
    id: string;
    deviceUdid: string;
    deviceName: string;
    goal: string;
    model: string;
    maxSteps: number;
    status: RunStatus;
    createdAt: string;
    finishedAt: string | null;
    steps: AgentStep[];
    summary: string | null;
    error: string | null;
    notes: string[];
    log?: string[];
    usage: { inputTokens: number; outputTokens: number };
    estimatedCostUsd: number;
}

interface DeviceSummary {
    udid: string;
    name: string;
    disabled?: boolean;
    connected: { osVersion: string } | null;
}

const $ = <T extends HTMLElement>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
};

const form = $<HTMLFormElement>('#agent-form');
const deviceSelect = $<HTMLSelectElement>('#agent-device');
const goalInput = $<HTMLTextAreaElement>('#agent-goal');
const maxStepsInput = $<HTMLInputElement>('#agent-max-steps');
const startButton = $<HTMLButtonElement>('#agent-start');
const formError = $<HTMLParagraphElement>('#agent-form-error');
const unconfigured = $<HTMLElement>('#agent-unconfigured');
const modelBadge = $<HTMLElement>('#agent-model-badge');
const modelName = $<HTMLElement>('#agent-model-name');
const historyEl = $<HTMLElement>('#agent-history');
const refreshButton = $<HTMLButtonElement>('#agent-refresh');
const liveGoal = $<HTMLElement>('#agent-live-goal');
const liveMeta = $<HTMLElement>('#agent-live-meta');
const liveStatus = $<HTMLElement>('#agent-live-status');
const liveNotes = $<HTMLElement>('#agent-live-notes');
const stopButton = $<HTMLButtonElement>('#agent-stop');
const screenImg = $<HTMLImageElement>('#agent-screen-img');
const screenEmpty = $<HTMLElement>('#agent-screen-empty');
const screenEmptyText = $<HTMLElement>('#agent-screen-empty-text');
const screenCaption = $<HTMLElement>('#agent-screen-caption');
const tapMarker = $<HTMLElement>('#agent-tap-marker');
const liveBadge = $<HTMLElement>('#agent-live-badge');
const modeLiveButton = $<HTMLButtonElement>('#agent-mode-live');
const modeCaptureButton = $<HTMLButtonElement>('#agent-mode-capture');
const thoughtText = $<HTMLElement>('#agent-thought-text');
const thoughtAction = $<HTMLElement>('#agent-thought-action');
const statSteps = $<HTMLElement>('#agent-stat-steps');
const statTokens = $<HTMLElement>('#agent-stat-tokens');
const statCost = $<HTMLElement>('#agent-stat-cost');
const statElapsed = $<HTMLElement>('#agent-stat-elapsed');
const outcome = $<HTMLElement>('#agent-outcome');
const timeline = $<HTMLOListElement>('#agent-timeline');
const livePanel = $<HTMLElement>('#agent-live');
const logEl = $<HTMLPreElement>('#agent-log');
const logFollow = $<HTMLInputElement>('#agent-log-follow');

let currentRunId: string | null = new URLSearchParams(location.search).get('run');
let pollTimer: number | null = null;
let elapsedTimer: number | null = null;
let currentRun: AgentRun | null = null;
let configured = false;
let devices: DeviceSummary[] = [];

/**
 * The screen frame shows the phone's live MJPEG stream by default (same feed as
 * the device page) and switches to the annotated step captures the model saw
 * when the operator asks for them or clicks a timeline thumbnail.
 */
type ScreenMode = 'live' | 'capture';
let screenMode: ScreenMode = 'live';
let liveUdid: string | null = null;
let liveRetryTimer: number | null = null;
let pinnedCapture: AgentStep | null = null;

function streamUrl(udid: string): string {
    return `/api/devices/${encodeURIComponent(udid)}/remote/stream?t=${Date.now()}`;
}

/** Which phone the live view should follow: the selected run's phone, else the form's. */
function liveTargetUdid(): string | null {
    if (currentRun) return currentRun.deviceUdid;
    return deviceSelect.value || null;
}

function deviceLabel(udid: string): string {
    return devices.find((device) => device.udid === udid)?.name ?? currentRun?.deviceName ?? udid;
}

function stopLiveStream(): void {
    if (liveRetryTimer !== null) window.clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveUdid = null;
    liveBadge.hidden = true;
    if (screenImg.dataset.kind === 'live') {
        screenImg.removeAttribute('src');
        delete screenImg.dataset.kind;
        delete screenImg.dataset.src;
    }
}

function showLiveStream(force = false): void {
    const udid = liveTargetUdid();
    if (!udid) {
        stopLiveStream();
        screenImg.hidden = true;
        screenEmpty.hidden = false;
        screenEmptyText.textContent = 'Pick a phone to see its screen here.';
        return;
    }
    if (!force && liveUdid === udid && screenImg.dataset.kind === 'live' && screenImg.getAttribute('src')) return;
    if (liveRetryTimer !== null) window.clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveUdid = udid;
    screenImg.dataset.kind = 'live';
    delete screenImg.dataset.src;
    screenImg.alt = `Live screen of ${deviceLabel(udid)}`;
    screenImg.hidden = true;
    screenEmpty.hidden = false;
    screenEmptyText.textContent = `Connecting to ${deviceLabel(udid)}…`;
    liveBadge.hidden = true;
    screenImg.src = streamUrl(udid);
}

function showCapture(run: AgentRun, step: AgentStep): void {
    const url = screenshotUrl(run, step);
    stopLiveStream();
    if (!url) {
        screenImg.hidden = true;
        screenEmpty.hidden = false;
        screenEmptyText.textContent = 'No capture for this step.';
        return;
    }
    if (screenImg.dataset.src !== url || screenImg.dataset.kind !== 'capture') {
        screenImg.dataset.kind = 'capture';
        screenImg.dataset.src = url;
        screenImg.src = url;
    }
    screenImg.alt = `Step ${step.index + 1} screenshot`;
    screenImg.hidden = false;
    screenEmpty.hidden = true;
}

function setScreenMode(mode: ScreenMode): void {
    screenMode = mode;
    if (mode === 'live') pinnedCapture = null;
    modeLiveButton.classList.toggle('is-active', mode === 'live');
    modeCaptureButton.classList.toggle('is-active', mode === 'capture');
    if (currentRun) renderStage(currentRun);
    else if (mode === 'live') showLiveStream();
    else {
        stopLiveStream();
        screenImg.hidden = true;
        screenEmpty.hidden = false;
        screenEmptyText.textContent = 'Step captures appear here once a run has taken a step.';
    }
}

screenImg.addEventListener('load', () => {
    screenImg.hidden = false;
    screenEmpty.hidden = true;
    liveBadge.hidden = screenImg.dataset.kind !== 'live';
});
screenImg.addEventListener('error', () => {
    if (screenImg.dataset.kind !== 'live') return;
    screenImg.removeAttribute('src');
    screenImg.hidden = true;
    screenEmpty.hidden = false;
    liveBadge.hidden = true;
    screenEmptyText.textContent = `${liveUdid ? deviceLabel(liveUdid) : 'The phone'} isn't streaming right now — is it unlocked and connected? Retrying…`;
    liveRetryTimer = window.setTimeout(() => showLiveStream(true), 5_000);
});

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
}

function formatTokens(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
}

function formatCost(value: number): string {
    if (value === 0) return '$0.00';
    return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

function formatElapsed(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(status: RunStatus): string {
    return { running: 'Running', succeeded: 'Succeeded', failed: 'Failed', stopped: 'Stopped' }[status];
}

function actionIcon(action: AgentAction | null): string {
    if (!action) return '…';
    return {
        tap: '⊙', long_press: '◉', swipe: '⇅', type_text: '⌨', press_home: '⌂',
        open_app: '▣', wait: '◷', done: '✓', fail: '✕',
    }[action.type];
}

function showFormError(message: string | null): void {
    formError.hidden = !message;
    formError.textContent = message ?? '';
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}

async function loadStatus(): Promise<void> {
    try {
        const status = await api<{ configured: boolean; model: string | null; defaultMaxSteps: number }>('/api/agent/status');
        configured = status.configured;
        unconfigured.hidden = status.configured;
        modelBadge.hidden = !status.configured;
        modelName.textContent = status.model ?? '';
        if (!maxStepsInput.value) maxStepsInput.value = String(status.defaultMaxSteps);
        startButton.disabled = !status.configured;
        if (!status.configured) startButton.textContent = 'Model key required';
    } catch (error) {
        unconfigured.hidden = false;
        startButton.disabled = true;
        showFormError(error instanceof Error ? error.message : 'Could not reach the dashboard');
    }
}

async function loadDevices(): Promise<void> {
    try {
        devices = await api<DeviceSummary[]>('/api/devices');
        const usable = devices.filter((device) => !device.disabled);
        const previous = deviceSelect.value;
        deviceSelect.innerHTML = usable.length
            ? usable.map((device) => `<option value="${escapeHtml(device.udid)}"${device.connected ? '' : ' disabled'}>${escapeHtml(device.name)}${device.connected ? ` · iOS ${escapeHtml(device.connected.osVersion)}` : ' · offline'}</option>`).join('')
            : '<option value="">No registered phones</option>';
        const firstOnline = usable.find((device) => device.connected);
        deviceSelect.value = previous && usable.some((device) => device.udid === previous) ? previous : firstOnline?.udid ?? '';
        if (screenMode === 'live' && !currentRun) showLiveStream();
    } catch {
        deviceSelect.innerHTML = '<option value="">Could not load phones</option>';
    }
}

async function loadHistory(): Promise<void> {
    try {
        const { runs } = await api<{ runs: AgentRun[] }>('/api/agent/runs');
        historyEl.classList.remove('loading-card');
        if (!runs.length) {
            historyEl.innerHTML = '<p class="agent-history-empty">No runs yet. The first one will show up here.</p>';
            return;
        }
        historyEl.innerHTML = runs.map((run) => `
            <button type="button" class="agent-history-item${run.id === currentRunId ? ' is-active' : ''}" data-run="${escapeHtml(run.id)}">
                <span class="agent-status-dot ${run.status}" aria-hidden="true"></span>
                <span class="agent-history-copy">
                    <span class="agent-history-goal">${escapeHtml(run.goal)}</span>
                    <span class="agent-history-meta">${escapeHtml(run.deviceName)} · ${run.steps.length} step${run.steps.length === 1 ? '' : 's'} · ${escapeHtml(relativeTime(run.createdAt))} · ${escapeHtml(formatCost(run.estimatedCostUsd))}</span>
                </span>
                <span class="agent-history-status">${escapeHtml(statusLabel(run.status))}</span>
            </button>`).join('');
    } catch (error) {
        historyEl.classList.remove('loading-card');
        historyEl.innerHTML = `<p class="agent-history-empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load runs')}</p>`;
    }
}

function screenshotUrl(run: AgentRun, step: AgentStep): string | null {
    if (!step.screenshot) return null;
    return `/api/agent/runs/${encodeURIComponent(run.id)}/steps/${step.index}/screenshot`;
}

function positionMarker(step: AgentStep): void {
    const action = step.action;
    if (!action || (action.type !== 'tap' && action.type !== 'long_press')) {
        tapMarker.hidden = true;
        return;
    }
    tapMarker.hidden = false;
    tapMarker.style.left = `${(action.x / step.screen.width) * 100}%`;
    tapMarker.style.top = `${(action.y / step.screen.height) * 100}%`;
}

function renderStage(run: AgentRun): void {
    const latest = run.steps.at(-1);
    const shown = screenMode === 'capture' ? (pinnedCapture ?? latest) : latest;

    if (screenMode === 'live') {
        showLiveStream();
        const stepInfo = latest ? `step ${latest.index + 1}${latest.locked ? ' · locked' : ''}` : (run.status === 'running' ? 'taking the first screenshot…' : 'idle');
        screenCaption.textContent = `Live · ${run.deviceName} · ${stepInfo}`;
    } else if (shown) {
        showCapture(run, shown);
        screenCaption.textContent = `Step ${shown.index + 1} · ${shown.screen.width}×${shown.screen.height} pt · ${shown.elementCount} elements${shown.locked ? ' · locked' : ''}`;
    } else {
        stopLiveStream();
        screenImg.hidden = true;
        screenEmpty.hidden = false;
        screenEmptyText.textContent = run.status === 'running' ? 'Taking the first screenshot…' : 'No steps were recorded.';
        screenCaption.textContent = '';
    }

    if (!latest) {
        tapMarker.hidden = true;
        thoughtText.textContent = run.status === 'running' ? 'Waking the phone and taking the first screenshot…' : (run.error ?? 'No steps were recorded.');
        thoughtAction.hidden = true;
        return;
    }
    // In live mode the marker shows where the most recent action landed; when a
    // capture is pinned it shows that step's action.
    positionMarker(screenMode === 'capture' && pinnedCapture ? pinnedCapture : latest);
    thoughtText.textContent = latest.reasoning || (latest.result === 'pending' ? 'Looking at the screen and deciding what to do…' : latest.actionLabel);
    thoughtAction.hidden = latest.result === 'pending';
    thoughtAction.className = `agent-action-chip ${latest.result}`;
    thoughtAction.innerHTML = `<span class="agent-action-icon" aria-hidden="true">${actionIcon(latest.action)}</span><span>${escapeHtml(latest.actionLabel)}</span>${latest.error ? `<span class="agent-action-error">${escapeHtml(latest.error)}</span>` : ''}`;
}

function renderTimeline(run: AgentRun): void {
    if (!run.steps.length) {
        timeline.innerHTML = '<li class="agent-timeline-empty">Steps appear here as the agent works.</li>';
        return;
    }
    timeline.innerHTML = [...run.steps].reverse().map((step) => {
        const url = screenshotUrl(run, step);
        return `<li class="agent-step ${step.result}${step.action?.type === 'done' ? ' is-done' : ''}${step.action?.type === 'fail' ? ' is-fail' : ''}">
            <span class="agent-step-index">${step.index + 1}</span>
            ${url ? `<button type="button" class="agent-step-thumb" data-step="${step.index}" aria-label="Show step ${step.index + 1} screenshot"><img src="${escapeHtml(url)}" alt="" loading="lazy"></button>` : '<span class="agent-step-thumb empty"></span>'}
            <div class="agent-step-body">
                <div class="agent-step-action"><span class="agent-action-icon" aria-hidden="true">${actionIcon(step.action)}</span>${escapeHtml(step.actionLabel)}${step.result === 'pending' ? '<span class="spinner small" aria-hidden="true"></span>' : ''}</div>
                ${step.reasoning ? `<p class="agent-step-reasoning">${escapeHtml(step.reasoning)}</p>` : ''}
                ${step.error ? `<p class="agent-step-error">${escapeHtml(step.error)}</p>` : ''}
                <p class="agent-step-meta">${step.durationMs ? `${(step.durationMs / 1000).toFixed(1)}s · ` : ''}${formatTokens(step.usage.inputTokens + step.usage.outputTokens)} tokens</p>
            </div>
        </li>`;
    }).join('');
}

function renderLog(run: AgentRun): void {
    const lines = run.log ?? [];
    const text = lines.length
        ? lines.join('\n')
        : (run.status === 'running' ? 'Waiting for the first log line…' : 'No log was recorded for this run.');
    if (logEl.textContent === text) return;
    logEl.textContent = text;
    if (logFollow.checked) logEl.scrollTop = logEl.scrollHeight;
}

function renderRun(run: AgentRun): void {
    currentRun = run;
    livePanel.dataset.status = run.status;
    liveGoal.textContent = run.goal;
    liveMeta.textContent = `${run.deviceName} · ${run.model} · started ${new Date(run.createdAt).toLocaleTimeString()}`;
    liveStatus.hidden = false;
    liveStatus.className = `agent-status-pill ${run.status}`;
    liveStatus.innerHTML = `${run.status === 'running' ? '<span class="spinner small" aria-hidden="true"></span>' : ''}${escapeHtml(statusLabel(run.status))}`;
    stopButton.hidden = run.status !== 'running';
    stopButton.disabled = false;
    liveNotes.hidden = !run.notes.length;
    liveNotes.innerHTML = run.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('');

    statSteps.textContent = `${run.steps.length} / ${run.maxSteps}`;
    statTokens.textContent = formatTokens(run.usage.inputTokens + run.usage.outputTokens);
    statCost.textContent = formatCost(run.estimatedCostUsd);
    updateElapsed();

    renderStage(run);
    renderLog(run);
    renderTimeline(run);

    if (run.status === 'running') {
        outcome.hidden = true;
    } else {
        outcome.hidden = false;
        outcome.className = `agent-outcome ${run.status}`;
        const heading = run.status === 'succeeded' ? 'Goal reached' : run.status === 'stopped' ? 'Run stopped' : 'Run failed';
        outcome.innerHTML = `<strong>${heading}</strong><span>${escapeHtml(run.summary ?? run.error ?? '')}</span>`;
    }
}

function updateElapsed(): void {
    if (!currentRun) return;
    const end = currentRun.finishedAt ? new Date(currentRun.finishedAt).getTime() : Date.now();
    statElapsed.textContent = formatElapsed(end - new Date(currentRun.createdAt).getTime());
}

function stopPolling(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
}

async function pollRun(): Promise<void> {
    if (!currentRunId) return;
    try {
        const run = await api<AgentRun>(`/api/agent/runs/${encodeURIComponent(currentRunId)}`);
        if (run.id !== currentRunId) return;
        const wasRunning = currentRun?.status === 'running';
        renderRun(run);
        if (run.status === 'running') {
            pollTimer = window.setTimeout(() => void pollRun(), 1_500);
        } else {
            stopPolling();
            if (wasRunning || !currentRun) void loadHistory();
        }
    } catch (error) {
        liveMeta.textContent = error instanceof Error ? error.message : 'Could not load the run';
        pollTimer = window.setTimeout(() => void pollRun(), 4_000);
    }
}

function selectRun(id: string): void {
    stopPolling();
    currentRunId = id;
    currentRun = null;
    pinnedCapture = null;
    const url = new URL(location.href);
    url.searchParams.set('run', id);
    history.replaceState(null, '', url);
    for (const item of historyEl.querySelectorAll<HTMLElement>('.agent-history-item')) {
        item.classList.toggle('is-active', item.dataset.run === id);
    }
    liveGoal.textContent = 'Loading run…';
    void pollRun();
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured) return;
    showFormError(null);
    const deviceUdid = deviceSelect.value;
    const goal = goalInput.value.trim();
    if (!deviceUdid) return showFormError('Pick an online phone first.');
    if (!goal) return showFormError('Describe what the agent should do.');
    startButton.disabled = true;
    startButton.textContent = 'Starting…';
    try {
        const run = await api<AgentRun>('/api/agent/runs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceUdid, goal, maxSteps: Number(maxStepsInput.value) || undefined }),
        });
        selectRun(run.id);
        void loadHistory();
        livePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        showFormError(error instanceof Error ? error.message : 'Could not start the run');
    } finally {
        startButton.disabled = false;
        startButton.textContent = 'Run agent';
    }
});

stopButton.addEventListener('click', async () => {
    if (!currentRunId) return;
    stopButton.disabled = true;
    stopButton.textContent = 'Stopping…';
    try {
        await api(`/api/agent/runs/${encodeURIComponent(currentRunId)}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    } catch (error) {
        liveMeta.textContent = error instanceof Error ? error.message : 'Could not stop the run';
    } finally {
        stopButton.textContent = 'Stop';
    }
});

historyEl.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('.agent-history-item');
    if (item?.dataset.run) selectRun(item.dataset.run);
});

timeline.addEventListener('click', (event) => {
    const thumb = (event.target as HTMLElement).closest<HTMLElement>('.agent-step-thumb[data-step]');
    if (!thumb || !currentRun) return;
    const step = currentRun.steps[Number(thumb.dataset.step)];
    const url = step ? screenshotUrl(currentRun, step) : null;
    if (!step || !url) return;
    pinnedCapture = step;
    screenMode = 'capture';
    modeLiveButton.classList.remove('is-active');
    modeCaptureButton.classList.add('is-active');
    showCapture(currentRun, step);
    screenCaption.textContent = `Step ${step.index + 1} · ${step.actionLabel}`;
    positionMarker(step);
    thoughtText.textContent = step.reasoning || step.actionLabel;
    thoughtAction.hidden = false;
    thoughtAction.className = `agent-action-chip ${step.result}`;
    thoughtAction.innerHTML = `<span class="agent-action-icon" aria-hidden="true">${actionIcon(step.action)}</span><span>${escapeHtml(step.actionLabel)}</span>`;
    livePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

refreshButton.addEventListener('click', () => { void loadHistory(); void loadDevices(); });
modeLiveButton.addEventListener('click', () => setScreenMode('live'));
modeCaptureButton.addEventListener('click', () => setScreenMode('capture'));
deviceSelect.addEventListener('change', () => {
    if (screenMode === 'live' && !currentRun) showLiveStream();
});

for (const example of document.querySelectorAll<HTMLButtonElement>('.agent-example[data-goal]')) {
    example.addEventListener('click', () => {
        goalInput.value = example.dataset.goal ?? '';
        goalInput.focus();
    });
}

elapsedTimer = window.setInterval(updateElapsed, 1_000);
window.addEventListener('beforeunload', () => {
    stopPolling();
    stopLiveStream();
    if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
});
// Don't hold an MJPEG connection open for a hidden tab.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLiveStream();
    else if (screenMode === 'live') showLiveStream(true);
});

void loadStatus();
void loadDevices();
void loadHistory();
if (currentRunId) selectRun(currentRunId);
window.setInterval(() => void loadDevices(), 15_000);
