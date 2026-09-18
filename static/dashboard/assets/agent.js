const $ = (selector) => {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing ${selector}`);
    return element;
};
const optional = (selector) => document.querySelector(selector);
// The cloud and local pages share this script; the body says which API to talk to.
const API = document.body.dataset.agentApi ?? '/api/agent';
const FLAVOR = document.body.dataset.agentFlavor === 'local' ? 'local' : 'cloud';
const form = $('#agent-form');
const deviceSelect = $('#agent-device');
const goalInput = $('#agent-goal');
const maxStepsInput = $('#agent-max-steps');
const startButton = $('#agent-start');
const formError = $('#agent-form-error');
const unconfigured = $('#agent-unconfigured');
const modelBadge = $('#agent-model-badge');
const modelName = $('#agent-model-name');
const historyEl = $('#agent-history');
const refreshButton = $('#agent-refresh');
const liveGoal = $('#agent-live-goal');
const liveMeta = $('#agent-live-meta');
const liveStatus = $('#agent-live-status');
const liveNotes = $('#agent-live-notes');
const stopButton = $('#agent-stop');
const voiceButton = $('#agent-voice');
const voiceLabel = $('#agent-voice-label');
const screenImg = $('#agent-screen-img');
const screenEmpty = $('#agent-screen-empty');
const screenEmptyText = $('#agent-screen-empty-text');
const screenCaption = $('#agent-screen-caption');
const tapMarker = $('#agent-tap-marker');
const liveBadge = $('#agent-live-badge');
const modeLiveButton = $('#agent-mode-live');
const modeCaptureButton = $('#agent-mode-capture');
const thoughtText = $('#agent-thought-text');
const thoughtAction = $('#agent-thought-action');
const statSteps = $('#agent-stat-steps');
const statTokens = $('#agent-stat-tokens');
const statElapsed = $('#agent-stat-elapsed');
const outcome = $('#agent-outcome');
const timeline = $('#agent-timeline');
const livePanel = $('#agent-live');
const logEl = $('#agent-log');
const logFollow = $('#agent-log-follow');
const unconfiguredTitle = optional('#agent-unconfigured-title');
const unconfiguredText = optional('#agent-unconfigured-text');
const unconfiguredCommands = optional('#agent-unconfigured-commands');
const runtimePanel = optional('#agent-local-runtime');
const runtimeServer = optional('#agent-runtime-server');
const runtimeModel = optional('#agent-runtime-model');
const runtimeModels = optional('#agent-runtime-models');
let currentRunId = new URLSearchParams(location.search).get('run');
let pollTimer = null;
let elapsedTimer = null;
let currentRun = null;
let configured = false;
let devices = [];
/**
 * Voice: narrate the agent's reasoning with the browser's own speech engine
 * (Web Speech API — on-device, no API key, works for cloud and local runs).
 * Only live runs are narrated, never runs opened from history, and the queue is
 * kept to the newest step so the voice never lags behind a fast cloud model.
 */
const VOICE_PREF_KEY = 'agent-voice';
const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let voiceOn = speechSupported && localStorage.getItem(VOICE_PREF_KEY) === 'on';
let narratedRunId = null;
const narratedSteps = new Set();
let narratedOutcome = false;
function renderVoiceButton() {
    voiceButton.hidden = !speechSupported;
    voiceButton.setAttribute('aria-pressed', String(voiceOn));
    voiceButton.classList.toggle('is-on', voiceOn);
    voiceLabel.textContent = voiceOn ? 'Voice on' : 'Voice off';
}
function pickVoice() {
    const voices = speechSynthesis.getVoices();
    if (!voices.length)
        return null;
    const preferred = ['Samantha', 'Ava', 'Allison', 'Zoe', 'Google US English', 'Karen', 'Daniel'];
    for (const name of preferred) {
        const match = voices.find((voice) => voice.name === name || voice.name.startsWith(`${name} `));
        if (match)
            return match;
    }
    return voices.find((voice) => voice.lang.startsWith('en') && voice.default)
        ?? voices.find((voice) => voice.lang.startsWith('en'))
        ?? voices[0];
}
function speak(text) {
    if (!voiceOn || !speechSupported)
        return;
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed)
        return;
    // Keep the narration current: if we're already behind, drop the backlog.
    if (speechSynthesis.pending)
        speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(trimmed);
    const voice = pickVoice();
    if (voice)
        utterance.voice = voice;
    utterance.rate = 1.08;
    utterance.pitch = 1;
    speechSynthesis.speak(utterance);
}
function stopSpeaking() {
    if (speechSupported)
        speechSynthesis.cancel();
}
/** A short, coordinate-free spoken version of the action the agent chose. */
function speakableAction(step) {
    const action = step.action;
    if (!action)
        return step.result === 'error' && step.error ? `That didn't work: ${step.error}` : '';
    let phrase;
    switch (action.type) {
        case 'tap':
            phrase = action.target ? `Tapping ${action.target}.` : 'Tapping the screen.';
            break;
        case 'long_press':
            phrase = action.target ? `Long-pressing ${action.target}.` : 'Long-pressing.';
            break;
        case 'swipe':
            phrase = 'Swiping.';
            break;
        case 'scroll':
            phrase = `Scrolling ${action.direction}.`;
            break;
        case 'type_text':
            phrase = `Typing: ${action.text}`;
            break;
        case 'press_home':
            phrase = 'Going to the home screen.';
            break;
        case 'open_app':
            phrase = 'Opening the app.';
            break;
        case 'wait':
            phrase = `Waiting ${action.seconds} second${action.seconds === 1 ? '' : 's'}.`;
            break;
        case 'done': return '';
        case 'fail': return '';
    }
    if (step.result === 'error' && step.error)
        phrase += ` But that was blocked: ${step.error}`;
    return phrase;
}
function narrateRun(run, wasRunning) {
    if (!voiceOn)
        return;
    if (narratedRunId !== run.id) {
        narratedRunId = run.id;
        narratedSteps.clear();
        narratedOutcome = false;
        // Opening an old run from history: don't read its whole transcript back.
        if (run.status !== 'running') {
            for (const step of run.steps)
                narratedSteps.add(step.index);
            narratedOutcome = true;
            return;
        }
    }
    const live = run.status === 'running' || wasRunning;
    if (!live)
        return;
    for (const step of run.steps) {
        if (narratedSteps.has(step.index))
            continue;
        // Wait until the model has answered for this step so we read the full thought.
        if (step.result === 'pending' && !step.reasoning)
            continue;
        narratedSteps.add(step.index);
        const reasoning = step.reasoning || (step.action ? '' : step.actionLabel);
        speak(`Step ${step.index + 1}. ${reasoning} ${speakableAction(step)}`);
    }
    if (run.status !== 'running' && !narratedOutcome) {
        narratedOutcome = true;
        const closing = run.status === 'succeeded'
            ? `Goal reached. ${run.summary ?? ''}`
            : run.status === 'stopped'
                ? 'Run stopped.'
                : `Run failed. ${run.error ?? ''}`;
        speak(closing);
    }
}
function toggleVoice() {
    voiceOn = !voiceOn;
    localStorage.setItem(VOICE_PREF_KEY, voiceOn ? 'on' : 'off');
    renderVoiceButton();
    if (voiceOn) {
        // Speaking from the click handler also unlocks audio in browsers that gate it on a gesture.
        speak(FLAVOR === 'local' ? 'Voice on. I will read the local agent\'s reasoning as it runs.' : 'Voice on. I will read the agent\'s reasoning as it runs.');
        if (currentRun) {
            narratedRunId = currentRun.id;
            narratedSteps.clear();
            for (const step of currentRun.steps)
                narratedSteps.add(step.index);
            narratedOutcome = currentRun.status !== 'running';
        }
    }
    else {
        stopSpeaking();
    }
}
let screenMode = 'live';
let liveUdid = null;
let liveRetryTimer = null;
let pinnedCapture = null;
function streamUrl(udid) {
    return `/api/devices/${encodeURIComponent(udid)}/remote/stream?t=${Date.now()}`;
}
/** Which phone the live view should follow: the selected run's phone, else the form's. */
function liveTargetUdid() {
    if (currentRun)
        return currentRun.deviceUdid;
    return deviceSelect.value || null;
}
function deviceLabel(udid) {
    return devices.find((device) => device.udid === udid)?.name ?? currentRun?.deviceName ?? udid;
}
function stopLiveStream() {
    if (liveRetryTimer !== null)
        window.clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveUdid = null;
    liveBadge.hidden = true;
    if (screenImg.dataset.kind === 'live') {
        screenImg.removeAttribute('src');
        delete screenImg.dataset.kind;
        delete screenImg.dataset.src;
    }
}
function showLiveStream(force = false) {
    const udid = liveTargetUdid();
    if (!udid) {
        stopLiveStream();
        screenImg.hidden = true;
        screenEmpty.hidden = false;
        screenEmptyText.textContent = 'Pick a phone to see its screen here.';
        return;
    }
    if (!force && liveUdid === udid && screenImg.dataset.kind === 'live' && screenImg.getAttribute('src'))
        return;
    if (liveRetryTimer !== null)
        window.clearTimeout(liveRetryTimer);
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
function showCapture(run, step) {
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
function setScreenMode(mode) {
    screenMode = mode;
    if (mode === 'live')
        pinnedCapture = null;
    modeLiveButton.classList.toggle('is-active', mode === 'live');
    modeCaptureButton.classList.toggle('is-active', mode === 'capture');
    if (currentRun)
        renderStage(currentRun);
    else if (mode === 'live')
        showLiveStream();
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
    if (screenImg.dataset.kind !== 'live')
        return;
    screenImg.removeAttribute('src');
    screenImg.hidden = true;
    screenEmpty.hidden = false;
    liveBadge.hidden = true;
    screenEmptyText.textContent = `${liveUdid ? deviceLabel(liveUdid) : 'The phone'} isn't streaming right now — is it unlocked and connected? Retrying…`;
    liveRetryTimer = window.setTimeout(() => showLiveStream(true), 5_000);
});
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
}
function formatTokens(value) {
    if (value >= 1_000_000)
        return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000)
        return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
}
/** Total spend for a finished run, shown once in the history list rather than ticking live. */
function formatCost(value) {
    if (FLAVOR === 'local')
        return 'free · local';
    if (value === 0)
        return '$0.00 total';
    return `${value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`} total`;
}
function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1)
        return 'just now';
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return `${hours} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function statusLabel(status) {
    return { running: 'Running', succeeded: 'Succeeded', failed: 'Failed', stopped: 'Stopped' }[status];
}
function actionIcon(action) {
    if (!action)
        return '…';
    return {
        tap: '⊙', long_press: '◉', swipe: '⇅', scroll: '⇣', type_text: '⌨', press_home: '⌂',
        open_app: '▣', wait: '◷', done: '✓', fail: '✕',
    }[action.type];
}
function showFormError(message) {
    formError.hidden = !message;
    formError.textContent = message ?? '';
}
async function api(url, init) {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
/** Local runtime readiness: Ollama must answer and have the configured model pulled. */
function renderLocalStatus(status) {
    const health = status.ollama;
    const model = status.model ?? 'qwen3-vl:8b';
    const ready = Boolean(health?.reachable && health?.hasModel);
    if (runtimePanel) {
        runtimePanel.hidden = !health?.reachable;
        if (runtimeServer) {
            runtimeServer.textContent = health?.reachable ? `Ollama ${health.version ?? ''} · ${status.ollamaUrl ?? ''}`.trim() : 'not running';
            runtimeServer.className = health?.reachable ? 'ok' : 'bad';
        }
        if (runtimeModel) {
            runtimeModel.textContent = health?.hasModel ? `${model} · ready` : `${model} · not downloaded`;
            runtimeModel.className = health?.hasModel ? 'ok' : 'bad';
        }
        if (runtimeModels) {
            const others = (health?.models ?? []).filter((name) => name !== model && name !== `${model}:latest`);
            runtimeModels.textContent = others.length ? others.join(', ') : 'none';
        }
    }
    if (ready)
        return true;
    if (!health?.reachable) {
        if (unconfiguredTitle)
            unconfiguredTitle.textContent = 'Ollama is not running on this Mac';
        if (unconfiguredText)
            unconfiguredText.textContent = `The local agent needs an Ollama server at ${status.ollamaUrl ?? 'http://127.0.0.1:11434'}. Install it once and start it; the model download (~6 GB for ${model}) happens once.`;
        if (unconfiguredCommands) {
            unconfiguredCommands.hidden = false;
            unconfiguredCommands.textContent = `brew install ollama\nbrew services start ollama\nollama pull ${model}`;
        }
    }
    else {
        if (unconfiguredTitle)
            unconfiguredTitle.textContent = `Model ${model} is not downloaded yet`;
        if (unconfiguredText)
            unconfiguredText.textContent = `Ollama is running but ${model} is missing. Pull it once (about 6 GB), then this page turns on automatically. Set AGENT_LOCAL_MODEL in .env to use a different model.`;
        if (unconfiguredCommands) {
            unconfiguredCommands.hidden = false;
            unconfiguredCommands.textContent = `ollama pull ${model}`;
        }
    }
    return false;
}
let statusTimer = null;
async function loadStatus() {
    try {
        const status = await api(`${API}/status`);
        const ready = FLAVOR === 'local' ? renderLocalStatus(status) : status.configured;
        configured = ready;
        unconfigured.hidden = ready;
        modelBadge.hidden = !ready;
        modelName.textContent = status.model ?? '';
        if (!maxStepsInput.value)
            maxStepsInput.value = String(status.defaultMaxSteps);
        startButton.disabled = !ready;
        startButton.textContent = ready ? 'Run agent' : (FLAVOR === 'local' ? 'Local model not ready' : 'Model key required');
        // The local runtime can come up (or finish downloading) while the page is open.
        if (FLAVOR === 'local' && !ready && statusTimer === null) {
            statusTimer = window.setTimeout(() => { statusTimer = null; void loadStatus(); }, 10_000);
        }
    }
    catch (error) {
        unconfigured.hidden = false;
        startButton.disabled = true;
        showFormError(error instanceof Error ? error.message : 'Could not reach the dashboard');
    }
}
async function loadDevices() {
    try {
        devices = await api('/api/devices');
        const usable = devices.filter((device) => !device.disabled);
        const previous = deviceSelect.value;
        deviceSelect.innerHTML = usable.length
            ? usable.map((device) => `<option value="${escapeHtml(device.udid)}"${device.connected ? '' : ' disabled'}>${escapeHtml(device.name)}${device.connected ? ` · iOS ${escapeHtml(device.connected.osVersion)}` : ' · offline'}</option>`).join('')
            : '<option value="">No registered phones</option>';
        const firstOnline = usable.find((device) => device.connected);
        deviceSelect.value = previous && usable.some((device) => device.udid === previous) ? previous : firstOnline?.udid ?? '';
        if (screenMode === 'live' && !currentRun)
            showLiveStream();
    }
    catch {
        deviceSelect.innerHTML = '<option value="">Could not load phones</option>';
    }
}
async function loadHistory() {
    try {
        const { runs } = await api(`${API}/runs`);
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
    }
    catch (error) {
        historyEl.classList.remove('loading-card');
        historyEl.innerHTML = `<p class="agent-history-empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load runs')}</p>`;
    }
}
function screenshotUrl(run, step) {
    if (!step.screenshot)
        return null;
    return `${API}/runs/${encodeURIComponent(run.id)}/steps/${step.index}/screenshot`;
}
function positionMarker(step) {
    const action = step.action;
    if (!action || (action.type !== 'tap' && action.type !== 'long_press')) {
        tapMarker.hidden = true;
        return;
    }
    tapMarker.hidden = false;
    tapMarker.style.left = `${(action.x / step.screen.width) * 100}%`;
    tapMarker.style.top = `${(action.y / step.screen.height) * 100}%`;
}
function renderStage(run) {
    const latest = run.steps.at(-1);
    const shown = screenMode === 'capture' ? (pinnedCapture ?? latest) : latest;
    if (screenMode === 'live') {
        showLiveStream();
        const stepInfo = latest ? `step ${latest.index + 1}${latest.locked ? ' · locked' : ''}` : (run.status === 'running' ? 'taking the first screenshot…' : 'idle');
        screenCaption.textContent = `Live · ${run.deviceName} · ${stepInfo}`;
    }
    else if (shown) {
        showCapture(run, shown);
        screenCaption.textContent = `Step ${shown.index + 1} · ${shown.screen.width}×${shown.screen.height} pt · ${shown.elementCount} elements${shown.locked ? ' · locked' : ''}`;
    }
    else {
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
function renderTimeline(run) {
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
function renderLog(run) {
    const lines = run.log ?? [];
    const text = lines.length
        ? lines.join('\n')
        : (run.status === 'running' ? 'Waiting for the first log line…' : 'No log was recorded for this run.');
    if (logEl.textContent === text)
        return;
    logEl.textContent = text;
    if (logFollow.checked)
        logEl.scrollTop = logEl.scrollHeight;
}
function renderRun(run) {
    const wasRunning = currentRun?.id === run.id && currentRun.status === 'running';
    currentRun = run;
    narrateRun(run, wasRunning);
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
    updateElapsed();
    renderStage(run);
    renderLog(run);
    renderTimeline(run);
    if (run.status === 'running') {
        outcome.hidden = true;
    }
    else {
        outcome.hidden = false;
        outcome.className = `agent-outcome ${run.status}`;
        const heading = run.status === 'succeeded' ? 'Goal reached' : run.status === 'stopped' ? 'Run stopped' : 'Run failed';
        outcome.innerHTML = `<strong>${heading}</strong><span>${escapeHtml(run.summary ?? run.error ?? '')}</span>`;
    }
}
function updateElapsed() {
    if (!currentRun)
        return;
    const end = currentRun.finishedAt ? new Date(currentRun.finishedAt).getTime() : Date.now();
    statElapsed.textContent = formatElapsed(end - new Date(currentRun.createdAt).getTime());
}
function stopPolling() {
    if (pollTimer !== null)
        window.clearTimeout(pollTimer);
    pollTimer = null;
}
async function pollRun() {
    if (!currentRunId)
        return;
    try {
        const run = await api(`${API}/runs/${encodeURIComponent(currentRunId)}`);
        if (run.id !== currentRunId)
            return;
        const wasRunning = currentRun?.status === 'running';
        renderRun(run);
        if (run.status === 'running') {
            pollTimer = window.setTimeout(() => void pollRun(), 1_500);
        }
        else {
            stopPolling();
            if (wasRunning || !currentRun)
                void loadHistory();
        }
    }
    catch (error) {
        liveMeta.textContent = error instanceof Error ? error.message : 'Could not load the run';
        pollTimer = window.setTimeout(() => void pollRun(), 4_000);
    }
}
function selectRun(id) {
    stopPolling();
    stopSpeaking();
    currentRunId = id;
    currentRun = null;
    pinnedCapture = null;
    const url = new URL(location.href);
    url.searchParams.set('run', id);
    history.replaceState(null, '', url);
    for (const item of historyEl.querySelectorAll('.agent-history-item')) {
        item.classList.toggle('is-active', item.dataset.run === id);
    }
    liveGoal.textContent = 'Loading run…';
    void pollRun();
}
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured)
        return;
    showFormError(null);
    const deviceUdid = deviceSelect.value;
    const goal = goalInput.value.trim();
    if (!deviceUdid)
        return showFormError('Pick an online phone first.');
    if (!goal)
        return showFormError('Describe what the agent should do.');
    startButton.disabled = true;
    startButton.textContent = 'Starting…';
    try {
        const run = await api(`${API}/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceUdid, goal, maxSteps: Number(maxStepsInput.value) || undefined }),
        });
        selectRun(run.id);
        void loadHistory();
        livePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    catch (error) {
        showFormError(error instanceof Error ? error.message : 'Could not start the run');
    }
    finally {
        startButton.disabled = false;
        startButton.textContent = 'Run agent';
    }
});
stopButton.addEventListener('click', async () => {
    if (!currentRunId)
        return;
    stopButton.disabled = true;
    stopButton.textContent = 'Stopping…';
    try {
        await api(`${API}/runs/${encodeURIComponent(currentRunId)}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    }
    catch (error) {
        liveMeta.textContent = error instanceof Error ? error.message : 'Could not stop the run';
    }
    finally {
        stopButton.textContent = 'Stop';
    }
});
historyEl.addEventListener('click', (event) => {
    const item = event.target.closest('.agent-history-item');
    if (item?.dataset.run)
        selectRun(item.dataset.run);
});
timeline.addEventListener('click', (event) => {
    const thumb = event.target.closest('.agent-step-thumb[data-step]');
    if (!thumb || !currentRun)
        return;
    const step = currentRun.steps[Number(thumb.dataset.step)];
    const url = step ? screenshotUrl(currentRun, step) : null;
    if (!step || !url)
        return;
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
voiceButton.addEventListener('click', toggleVoice);
renderVoiceButton();
if (speechSupported)
    speechSynthesis.addEventListener('voiceschanged', () => { /* warm the voice list so pickVoice() has options on first use */ speechSynthesis.getVoices(); });
modeLiveButton.addEventListener('click', () => setScreenMode('live'));
modeCaptureButton.addEventListener('click', () => setScreenMode('capture'));
deviceSelect.addEventListener('change', () => {
    if (screenMode === 'live' && !currentRun)
        showLiveStream();
});
for (const example of document.querySelectorAll('.agent-example[data-goal]')) {
    example.addEventListener('click', () => {
        goalInput.value = example.dataset.goal ?? '';
        goalInput.focus();
    });
}
elapsedTimer = window.setInterval(updateElapsed, 1_000);
window.addEventListener('beforeunload', () => {
    stopPolling();
    stopLiveStream();
    stopSpeaking();
    if (elapsedTimer !== null)
        window.clearInterval(elapsedTimer);
});
// Don't hold an MJPEG connection open for a hidden tab.
document.addEventListener('visibilitychange', () => {
    if (document.hidden)
        stopLiveStream();
    else if (screenMode === 'live')
        showLiveStream(true);
});
void loadStatus();
void loadDevices();
void loadHistory();
if (currentRunId)
    selectRun(currentRunId);
window.setInterval(() => void loadDevices(), 15_000);
export {};
