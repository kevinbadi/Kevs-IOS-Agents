"use strict";
/**
 * Jev on screen: draws every semantic decision (src/decisions) back over the
 * phone it was made on. The element list the model saw is rendered as boxes
 * weighted by the probability it assigned each; the pick glows; escalations
 * turn the frame red. Live mode follows the newest decision as it lands.
 */
const $ = (selector) => {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing ${selector}`);
    return element;
};
const deviceSelect = $('#jev-device');
const followButton = $('#jev-follow');
const followLabel = $('#jev-follow-label');
const title = $('#jev-title');
const meta = $('#jev-meta');
const frame = $('#jev-frame');
const screenImg = $('#jev-screen-img');
const screenEmpty = $('#jev-screen-empty');
const screenEmptyText = $('#jev-screen-empty-text');
const overlay = $('#jev-overlay');
const banner = $('#jev-banner');
const liveBadge = $('#jev-live-badge');
const caption = $('#jev-caption');
const questionEl = $('#jev-question');
const verdictEl = $('#jev-verdict');
const statConfidence = $('#jev-stat-confidence');
const statFits = $('#jev-stat-fits');
const statLatency = $('#jev-stat-latency');
const statTokens = $('#jev-stat-tokens');
const probabilitiesEl = $('#jev-probabilities');
const elementsEl = $('#jev-elements');
const elementsCount = $('#jev-elements-count');
const historyEl = $('#jev-history');
const refreshButton = $('#jev-refresh');
const unconfigured = $('#jev-unconfigured');
const modelBadge = $('#jev-model-badge');
const modelName = $('#jev-model-name');
const layerButtons = [...document.querySelectorAll('.agent-screen-mode[data-layer]')];
const probeForm = $('#jev-probe');
const probeGoal = $('#jev-probe-goal');
const probeElementButton = $('#jev-probe-element');
const probeScreenButton = $('#jev-probe-screen');
const probeStatus = $('#jev-probe-status');
let devices = [];
let decisions = [];
let selectedId = null;
let following = true;
let layer = 'all';
let liveUdid = null;
let liveRetryTimer = null;
let pollTimer = null;
/** Points size of each phone's screen, for scaling rects onto the stream. */
const screenSizes = new Map();
const SVG = 'http://www.w3.org/2000/svg';
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
}
const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);
function formatTokens(value) {
    return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value);
}
function timeAgo(iso) {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1_000);
    if (seconds < 5)
        return 'just now';
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return `${hours} h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
async function api(url, init) {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
function deviceLabel(udid) {
    return devices.find((device) => device.udid === udid)?.name ?? udid;
}
// --- live stream -------------------------------------------------------------
function stopLiveStream() {
    if (liveRetryTimer !== null)
        window.clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveUdid = null;
    liveBadge.hidden = true;
    screenImg.removeAttribute('src');
    screenImg.hidden = true;
}
function showLiveStream(udid, force = false) {
    if (!udid) {
        stopLiveStream();
        screenEmpty.hidden = false;
        screenEmptyText.textContent = 'Pick a phone to see its screen here.';
        return;
    }
    if (!force && liveUdid === udid && screenImg.getAttribute('src'))
        return;
    if (liveRetryTimer !== null)
        window.clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
    liveUdid = udid;
    screenImg.alt = `Live screen of ${deviceLabel(udid)}`;
    screenImg.hidden = true;
    screenEmpty.hidden = false;
    screenEmptyText.textContent = `Connecting to ${deviceLabel(udid)}…`;
    liveBadge.hidden = true;
    screenImg.src = `/api/devices/${encodeURIComponent(udid)}/remote/stream?t=${Date.now()}`;
    void ensureScreenSize(udid);
}
screenImg.addEventListener('load', () => {
    screenImg.hidden = false;
    screenEmpty.hidden = true;
    liveBadge.hidden = false;
});
screenImg.addEventListener('error', () => {
    if (!liveUdid)
        return;
    screenImg.removeAttribute('src');
    screenImg.hidden = true;
    screenEmpty.hidden = false;
    liveBadge.hidden = true;
    screenEmptyText.textContent = `${deviceLabel(liveUdid)} isn't streaming right now — is it unlocked and connected? Retrying…`;
    liveRetryTimer = window.setTimeout(() => showLiveStream(liveUdid, true), 5_000);
});
const sizeLookups = new Set();
async function ensureScreenSize(udid) {
    if (screenSizes.has(udid) || sizeLookups.has(udid))
        return;
    sizeLookups.add(udid);
    try {
        const info = await api(`/api/devices/${encodeURIComponent(udid)}/remote/info`);
        screenSizes.set(udid, info.screen.screenSize);
        const current = currentDecision();
        if (current && current.deviceUdid === udid) {
            drawOverlay(current);
            renderPanel(current);
        }
    }
    catch {
        // Offline phone: the 390×844 default below stays in effect; retry on the next selection.
        sizeLookups.delete(udid);
    }
}
/**
 * Screen size in points for a decision. The phone reports it when connected;
 * until then assume the common 390×844. Element extents are not a good guide
 * because partly visible cells extend past the screen edge.
 */
function screenSizeFor(decision) {
    return screenSizes.get(decision.deviceUdid) ?? { width: 390, height: 844 };
}
// --- overlay -----------------------------------------------------------------
/** How much probability the model put on this element (element decisions only). */
function probabilityFor(decision, element) {
    if (decision.kind !== 'element')
        return null;
    return decision.probabilities[String(element.i)] ?? 0;
}
function drawOverlay(decision) {
    overlay.replaceChildren();
    frame.classList.toggle('is-escalated', Boolean(decision?.escalated));
    if (!decision) {
        banner.hidden = true;
        return;
    }
    const screen = screenSizeFor(decision);
    overlay.setAttribute('viewBox', `0 0 ${screen.width} ${screen.height}`);
    // Match the frame to the real screen so the stream isn't cropped under the boxes.
    frame.style.aspectRatio = `${screen.width} / ${screen.height}`;
    const chosenIndex = decision.kind === 'element' && decision.chosen && /^\d+$/.test(decision.chosen) ? Number(decision.chosen) : null;
    const pickEscalated = decision.kind === 'element' && decision.escalated;
    // Dim everything but the pick so the choice reads at a glance.
    const shade = document.createElementNS(SVG, 'rect');
    shade.setAttribute('class', 'jev-shade');
    shade.setAttribute('width', String(screen.width));
    shade.setAttribute('height', String(screen.height));
    overlay.append(shade);
    const sorted = [...decision.elements].sort((a, b) => (probabilityFor(decision, a) ?? 0) - (probabilityFor(decision, b) ?? 0));
    for (const element of sorted) {
        const probability = probabilityFor(decision, element);
        const isPick = chosenIndex !== null && element.i === chosenIndex;
        const scored = probability !== null && probability >= 0.02;
        if (layer === 'pick' && !isPick)
            continue;
        if (layer === 'scored' && !isPick && !scored)
            continue;
        const group = document.createElementNS(SVG, 'g');
        group.setAttribute('class', `jev-box${isPick ? ' is-pick' : ''}${scored ? ' is-scored' : ''}${isPick && pickEscalated ? ' is-escalated' : ''}`);
        group.style.setProperty('--p', String(probability ?? 0));
        const [x, y, w, h] = element.rect;
        const rect = document.createElementNS(SVG, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(w));
        rect.setAttribute('height', String(h));
        rect.setAttribute('rx', '6');
        const tooltip = document.createElementNS(SVG, 'title');
        tooltip.textContent = `#${element.i} ${element.role}${element.label ? ` "${element.label}"` : ''}${probability !== null ? ` · ${percent(probability)}` : ''}`;
        rect.append(tooltip);
        group.append(rect);
        if (isPick || (scored && probability !== null && probability >= 0.1)) {
            const label = document.createElementNS(SVG, 'text');
            label.setAttribute('x', String(x + 6));
            label.setAttribute('y', String(Math.max(14, y - 6)));
            label.setAttribute('class', 'jev-box-label');
            label.textContent = isPick ? `#${element.i} · ${percent(probability)} · pick` : `#${element.i} · ${percent(probability)}`;
            group.append(label);
        }
        if (isPick && !pickEscalated) {
            const dot = document.createElementNS(SVG, 'circle');
            dot.setAttribute('class', 'jev-tap-dot');
            dot.setAttribute('cx', String(x + w / 2));
            dot.setAttribute('cy', String(y + h / 2));
            dot.setAttribute('r', '9');
            group.append(dot);
        }
        overlay.append(group);
    }
    // Keep the banner off the pick: top by default, bottom when the pick is in the upper third.
    const picked = chosenIndex !== null ? decision.elements.find((element) => element.i === chosenIndex) : undefined;
    const pickNearTop = picked ? picked.rect[1] + picked.rect[3] / 2 < screen.height * 0.34 : false;
    banner.hidden = false;
    banner.className = `jev-banner ${decision.escalated ? 'is-escalated' : 'is-ok'} ${pickNearTop ? 'at-bottom' : 'at-top'}`;
    banner.innerHTML = bannerHtml(decision);
}
function bannerHtml(decision) {
    const head = decision.escalated
        ? `<strong>Escalate</strong><span>${escapeHtml(decision.escalationReason ?? 'unknown reason')} · nothing tapped</span>`
        : decision.kind === 'screen'
            ? `<strong>Screen: ${escapeHtml(decision.chosen)}</strong><span>${percent(decision.confidence)} confidence · fits ${percent(decision.fits)}</span>`
            : decision.kind === 'element'
                ? `<strong>Tap #${escapeHtml(decision.chosen)}</strong><span>${percent(decision.confidence)} confidence · fits ${percent(decision.fits)}</span>`
                : `<strong>Asked</strong><span>${Object.entries(decision.probabilities).map(([id, p]) => `${escapeHtml(id)} ${percent(p)}`).join(' · ')}</span>`;
    return `${head}<em>${decision.latencyMs} ms</em>`;
}
// --- side panel ----------------------------------------------------------------
/** The plain-English question the workflow asked, reconstructed from what was stored. */
function questionText(decision) {
    const q = decision.questions;
    if (decision.kind === 'element')
        return `Which element should be tapped to: ${String(q.goal ?? '')}`;
    if (decision.kind === 'screen') {
        const pick = q.pick;
        const names = Object.keys(pick?.criteria ?? {}).filter((name) => name !== 'unknown');
        return `Which screen is showing? Options: ${names.join(', ') || '—'}`;
    }
    return Object.entries(q).map(([id, text]) => `${id}: ${String(text)}`).join(' · ');
}
function optionLabel(decision, key) {
    if (decision.kind === 'element') {
        const options = decision.questions.options;
        if (key === 'unknown')
            return 'unknown — no listed element fits';
        return `#${key} ${options?.[key] ?? ''}`.trim();
    }
    if (decision.kind === 'screen') {
        const pick = decision.questions.pick;
        const description = pick?.criteria?.[key];
        return description ? `${key} — ${description}` : key;
    }
    return key;
}
function renderPanel(decision) {
    if (!decision) {
        title.textContent = 'Waiting for a decision';
        meta.textContent = 'Pick a phone. The overlay updates the moment a workflow asks Jev something.';
        questionEl.textContent = '—';
        verdictEl.hidden = true;
        for (const el of [statConfidence, statFits, statLatency, statTokens])
            el.textContent = '—';
        probabilitiesEl.innerHTML = '<li class="jev-empty">No decision selected.</li>';
        elementsEl.innerHTML = '';
        elementsCount.textContent = '';
        caption.textContent = '';
        return;
    }
    const kindLabel = decision.kind === 'screen' ? 'Which screen is this?' : decision.kind === 'element' ? 'Which element do I tap?' : 'Yes / no check';
    title.textContent = kindLabel;
    meta.textContent = `${deviceLabel(decision.deviceUdid)} · ${decision.source ?? 'unknown source'} · ${decision.model} · ${timeAgo(decision.createdAt)}${decision.executionId ? ` · execution ${decision.executionId.slice(0, 8)}` : ''}`;
    questionEl.textContent = questionText(decision);
    verdictEl.hidden = false;
    verdictEl.className = `agent-action-chip ${decision.escalated ? 'error' : 'ok'}`;
    const verdictText = decision.escalated
        ? `ESCALATE · ${decision.escalationReason ?? 'unknown'}${decision.chosen ? ` (winner was ${decision.chosen})` : ''}`
        : decision.kind === 'ask'
            ? 'Answered'
            : `${decision.kind === 'element' ? 'Tap element' : 'Screen'} ${decision.chosen ?? '—'}`;
    verdictEl.innerHTML = `<span class="agent-action-icon" aria-hidden="true">${decision.escalated ? '↗' : '✓'}</span><span>${escapeHtml(verdictText)}</span>`;
    statConfidence.textContent = percent(decision.confidence);
    statFits.textContent = percent(decision.fits);
    statLatency.textContent = `${decision.latencyMs} ms`;
    statTokens.textContent = `${formatTokens(decision.inputTokens)} in · ${formatTokens(decision.outputTokens)} out`;
    const entries = Object.entries(decision.probabilities).sort((a, b) => b[1] - a[1]);
    const shown = decision.kind === 'element' ? entries.filter(([key, p], index) => p >= 0.01 || key === decision.chosen || index < 3) : entries;
    probabilitiesEl.innerHTML = shown.length
        ? shown.map(([key, p]) => `<li class="jev-prob${key === decision.chosen ? ' is-chosen' : ''}${key === 'unknown' ? ' is-unknown' : ''}"><span class="jev-prob-bar" style="--p:${p}"></span><span class="jev-prob-label">${escapeHtml(optionLabel(decision, key))}</span><span class="jev-prob-value">${percent(p)}</span></li>`).join('')
            + (decision.kind === 'element' && entries.length > shown.length ? `<li class="jev-empty">${entries.length - shown.length} more at 0%</li>` : '')
        : '<li class="jev-empty">No probabilities recorded.</li>';
    elementsCount.textContent = `(${decision.elements.length})`;
    elementsEl.innerHTML = decision.elements.map((element) => {
        const p = probabilityFor(decision, element);
        return `<li class="${String(element.i) === decision.chosen ? 'is-chosen' : ''}"><code>#${element.i}</code> ${escapeHtml(element.role)}${element.label ? ` <strong>${escapeHtml(element.label)}</strong>` : ''}${element.value ? ` <em>${escapeHtml(element.value)}</em>` : ''}<span class="jev-el-rect">${element.rect.join(', ')}</span>${p !== null && p >= 0.01 ? `<span class="jev-el-p">${percent(p)}</span>` : ''}</li>`;
    }).join('');
    caption.textContent = `${decision.elements.length} elements · ${screenSizeFor(decision).width}×${screenSizeFor(decision).height} pt · ${new Date(decision.createdAt).toLocaleTimeString()}`;
}
function renderHistory() {
    if (!decisions.length) {
        historyEl.className = 'agent-history jev-history';
        historyEl.innerHTML = '<li class="jev-empty">No decisions yet. Run a workflow with decisions enabled — e.g. <code>open-app</code> with <code>OPEN_APP_USE_DECISIONS=true</code>.</li>';
        return;
    }
    historyEl.className = 'agent-history jev-history';
    historyEl.innerHTML = decisions.map((decision) => {
        const icon = decision.kind === 'screen' ? '▣' : decision.kind === 'element' ? '⊙' : '?';
        const summary = decision.kind === 'ask'
            ? Object.entries(decision.probabilities).map(([id, p]) => `${id} ${percent(p)}`).join(' · ')
            : `${decision.chosen ?? '—'} · ${percent(decision.confidence)}`;
        return `<li class="agent-history-item jev-history-item${decision.id === selectedId ? ' is-active' : ''}${decision.escalated ? ' is-escalated' : ''}" data-id="${escapeHtml(decision.id)}">
            <span class="jev-history-icon" aria-hidden="true">${icon}</span>
            <span class="jev-history-body"><strong>${escapeHtml(summary)}</strong><span>${escapeHtml(deviceLabel(decision.deviceUdid))} · ${escapeHtml(decision.source ?? '')} · ${decision.latencyMs} ms · ${timeAgo(decision.createdAt)}</span></span>
            <span class="jev-history-flag">${decision.escalated ? 'ESC' : ''}</span>
        </li>`;
    }).join('');
}
function currentDecision() {
    return decisions.find((decision) => decision.id === selectedId) ?? null;
}
function select(id, options = {}) {
    selectedId = id;
    const decision = currentDecision();
    renderPanel(decision);
    drawOverlay(decision);
    renderHistory();
    if (decision) {
        void ensureScreenSize(decision.deviceUdid);
        showLiveStream(decision.deviceUdid);
        if (options.animate) {
            frame.classList.remove('is-fresh');
            void frame.offsetWidth;
            frame.classList.add('is-fresh');
        }
    }
}
// --- data ----------------------------------------------------------------------
async function loadDevices() {
    try {
        devices = await api('/api/devices');
        const previous = deviceSelect.value;
        deviceSelect.innerHTML = '<option value="">All phones</option>' + devices.filter((device) => !device.disabled)
            .map((device) => `<option value="${escapeHtml(device.udid)}">${escapeHtml(device.name)}${device.connected ? '' : ' · offline'}</option>`).join('');
        deviceSelect.value = previous && devices.some((device) => device.udid === previous) ? previous : '';
    }
    catch {
        deviceSelect.innerHTML = '<option value="">Could not load phones</option>';
    }
}
async function loadMetrics() {
    try {
        const metrics = await api('/api/decisions/metrics?weeks=8');
        unconfigured.hidden = metrics.enabled;
        modelBadge.hidden = false;
        modelName.textContent = metrics.enabled ? `${metrics.model} · live` : `${metrics.model} · off`;
        $('#jev-metric-total').textContent = String(metrics.totals.decisions);
        $('#jev-metric-rate').textContent = metrics.totals.decisions ? percent(metrics.totals.rate) : '—';
        const [thisWeek, lastWeek] = metrics.byWeek;
        $('#jev-metric-week').textContent = thisWeek ? `${percent(thisWeek.rate)} of ${thisWeek.decisions}` : '—';
        $('#jev-metric-prev').textContent = lastWeek ? `${percent(lastWeek.rate)} of ${lastWeek.decisions}` : '—';
        $('#jev-metric-latency').textContent = thisWeek ? `${thisWeek.avgLatencyMs} ms` : '—';
        $('#jev-metric-model').textContent = metrics.model;
    }
    catch (error) {
        modelBadge.hidden = false;
        modelName.textContent = error instanceof Error ? error.message : 'metrics unavailable';
    }
}
async function loadDecisions() {
    const udid = deviceSelect.value;
    try {
        const body = await api(`/api/decisions/recent?limit=40${udid ? `&deviceUdid=${encodeURIComponent(udid)}` : ''}`);
        const newestBefore = decisions[0]?.id;
        decisions = body.decisions;
        const newest = decisions[0];
        if (following && newest && newest.id !== newestBefore) {
            select(newest.id, { animate: newestBefore !== undefined });
            if (newestBefore !== undefined)
                void loadMetrics();
        }
        else if (!selectedId && newest) {
            select(newest.id);
        }
        else {
            renderHistory();
            if (!currentDecision())
                select(newest?.id ?? null);
        }
        if (!decisions.length) {
            select(null);
            showLiveStream(udid || null);
        }
    }
    catch (error) {
        historyEl.className = 'agent-history jev-history';
        historyEl.innerHTML = `<li class="jev-empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load decisions')}</li>`;
    }
}
function schedulePoll() {
    if (pollTimer !== null)
        window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(async () => {
        if (!document.hidden)
            await loadDecisions();
        schedulePoll();
    }, 1_500);
}
function setFollowing(next) {
    following = next;
    followButton.classList.toggle('is-on', following);
    followButton.setAttribute('aria-pressed', String(following));
    followLabel.textContent = following ? 'Following' : 'Paused';
    if (following && decisions[0])
        select(decisions[0].id);
}
// --- probe -----------------------------------------------------------------------
/** The phone a probe should look at: the filter if set, else the phone of the shown decision, else the first online one. */
function probeTarget() {
    if (deviceSelect.value)
        return deviceSelect.value;
    const current = currentDecision();
    if (current)
        return current.deviceUdid;
    return devices.find((device) => device.connected && !device.disabled)?.udid ?? null;
}
async function probe(kind) {
    const udid = probeTarget();
    const goal = probeGoal.value.trim();
    if (!udid) {
        probeStatus.hidden = false;
        probeStatus.textContent = 'No phone to ask about — pick one above.';
        return;
    }
    if (kind === 'element' && !goal) {
        probeGoal.focus();
        return;
    }
    probeElementButton.disabled = true;
    probeScreenButton.disabled = true;
    probeStatus.hidden = false;
    probeStatus.className = 'jev-probe-status';
    probeStatus.textContent = `Reading ${deviceLabel(udid)}'s screen and asking Jev…`;
    try {
        const result = await api('/api/decisions/probe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(kind === 'element' ? { deviceUdid: udid, goal } : { deviceUdid: udid }),
        });
        const verdict = result.verdict;
        probeStatus.textContent = verdict.escalate
            ? `Jev would escalate (${verdict.reason}) · ${result.elements} elements · ${verdict.latencyMs} ms`
            : `Jev says ${kind === 'element' ? `tap #${String(verdict.value)}` : `screen "${String(verdict.value)}"`} · ${percent(verdict.confidence)} confidence${verdict.fits === undefined ? '' : ` · fits ${percent(verdict.fits)}`} · ${result.elements} elements (~${result.tokenEstimate} tokens) · ${verdict.latencyMs} ms`;
        setFollowing(true);
        // The row is written asynchronously; a second poll catches it if the first is early.
        await loadDecisions();
        window.setTimeout(() => { void loadDecisions(); }, 900);
    }
    catch (error) {
        probeStatus.className = 'jev-probe-status is-error';
        probeStatus.textContent = error instanceof Error ? error.message : 'Probe failed';
    }
    finally {
        probeElementButton.disabled = false;
        probeScreenButton.disabled = false;
    }
}
probeForm.addEventListener('submit', (event) => { event.preventDefault(); void probe('element'); });
probeScreenButton.addEventListener('click', () => { void probe('screen'); });
// --- wiring --------------------------------------------------------------------
historyEl.addEventListener('click', (event) => {
    const item = event.target.closest('.jev-history-item');
    if (!item?.dataset.id)
        return;
    setFollowing(false);
    select(item.dataset.id);
});
followButton.addEventListener('click', () => setFollowing(!following));
refreshButton.addEventListener('click', () => { void loadDecisions(); void loadMetrics(); void loadDevices(); });
deviceSelect.addEventListener('change', () => {
    selectedId = null;
    void loadDecisions();
    if (deviceSelect.value)
        showLiveStream(deviceSelect.value);
});
for (const button of layerButtons) {
    button.addEventListener('click', () => {
        layer = button.dataset.layer ?? 'all';
        for (const other of layerButtons)
            other.classList.toggle('is-active', other === button);
        drawOverlay(currentDecision());
    });
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden)
        stopLiveStream();
    else {
        const current = currentDecision();
        showLiveStream(current?.deviceUdid ?? deviceSelect.value ?? null, true);
    }
});
window.addEventListener('beforeunload', () => {
    stopLiveStream();
    if (pollTimer !== null)
        window.clearTimeout(pollTimer);
});
void (async () => {
    await loadDevices();
    await Promise.all([loadMetrics(), loadDecisions()]);
    schedulePoll();
})();
