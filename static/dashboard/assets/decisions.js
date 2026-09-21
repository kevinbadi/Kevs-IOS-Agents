"use strict";
/**
 * Jev on screen. Left: the live phone with every semantic decision
 * (src/decisions) drawn back over it — the element list the model saw as
 * boxes weighted by probability, the pick glowing, escalations in red.
 * Right: a HUD in the style of a game-playing demo — the lanes it chose
 * between with big percentages, the keys the workflow can press (and which
 * one this verdict pressed), and a live feed of decisions as they land.
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
const enabledPill = $('#jev-enabled-pill');
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
const elementsDetails = $('#jev-elements-details');
const elementsEl = $('#jev-elements');
const elementsCount = $('#jev-elements-count');
const whatSeesButton = $('#jev-what-sees');
const layerButtons = [...document.querySelectorAll('.agent-screen-mode[data-layer]')];
const probeForm = $('#jev-probe');
const probeGoal = $('#jev-probe-goal');
const probeElementButton = $('#jev-probe-element');
const probeScreenButton = $('#jev-probe-screen');
const probeStatus = $('#jev-probe-status');
// HUD
const hudBrand = $('#jev-hud-brand');
const hudState = $('#jev-hud-state');
const hudModel = $('#jev-hud-model');
const hudLatency = $('#jev-hud-latency');
const lanesTitle = $('#jev-lanes-title');
const lanesWhen = $('#jev-lanes-when');
const lanesEl = $('#jev-lanes');
const verdictEl = $('#jev-verdict');
const verdictMain = $('#jev-verdict-main');
const verdictSub = $('#jev-verdict-sub');
const keyButtons = [...document.querySelectorAll('.jev-key[data-key]')];
const keyNote = $('#jev-key-note');
const feedEl = $('#jev-feed');
const refreshButton = $('#jev-refresh');
const hudStats = $('#jev-hud-stats');
const unconfigured = $('#jev-unconfigured');
let devices = [];
let decisions = [];
let selectedId = null;
let following = true;
let layer = 'all';
let liveUdid = null;
let liveRetryTimer = null;
let pollTimer = null;
let metrics = null;
/** A probe in flight — the feed shows an "asking…" row and the brand card says "is deciding". */
let asking = null;
/** Points size of each phone's screen, for scaling rects onto the stream. */
const screenSizes = new Map();
const sizeLookups = new Set();
const SVG = 'http://www.w3.org/2000/svg';
/** How long after a decision lands the brand card keeps saying "is deciding". */
const DECIDING_GLOW_MS = 6_000;
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
const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
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
function shortSource(source) {
    if (!source)
        return 'unknown';
    return source.replace(/^example\//, '').replace(/^dashboard\//, '');
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
            renderCaption(current);
        }
    }
    catch {
        // Offline phone: the 390×844 default stays in effect; retry on the next selection.
        sizeLookups.delete(udid);
    }
}
/**
 * Screen size in points. The phone reports it when connected; until then
 * assume 390×844. Element extents are not a good guide because partly
 * visible cells extend past the screen edge.
 */
function screenSizeFor(decision) {
    return screenSizes.get(decision.deviceUdid) ?? { width: 390, height: 844 };
}
// --- decision semantics ----------------------------------------------------------
function probabilityFor(decision, element) {
    if (decision.kind !== 'element')
        return null;
    return decision.probabilities[String(element.i)] ?? 0;
}
function chosenElement(decision) {
    if (decision.kind !== 'element' || !decision.chosen || !/^\d+$/.test(decision.chosen))
        return undefined;
    const index = Number(decision.chosen);
    return decision.elements.find((element) => element.i === index);
}
function elementName(element, index) {
    if (!element)
        return `#${index}`;
    return element.label ?? element.value ?? element.role;
}
function kindTitle(kind) {
    return kind === 'screen' ? 'Which screen is this?' : kind === 'element' ? 'Which element do I tap?' : 'Yes / no check';
}
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
/**
 * Which key this verdict presses. Jev only answers; the workflow acts. For
 * the known callers the mapping is deterministic, so the HUD can light it up.
 */
function keyFor(decision) {
    const probe = decision.source === 'dashboard/probe';
    if (decision.escalated) {
        return { key: 'escalate', note: `Escalated (${decision.escalationReason ?? 'unknown'}) — the workflow falls back to its plain path. Nothing tapped.` };
    }
    if (probe) {
        return { key: null, note: 'Probe from this page — keys locked, nothing was pressed. A workflow would act on this verdict.' };
    }
    if (decision.kind === 'element') {
        const element = chosenElement(decision);
        if (!element)
            return { key: null, note: 'No element resolved.' };
        const [x, y, w, h] = element.rect;
        return { key: 'tap', note: `Tap at (${Math.round(x + w / 2)}, ${Math.round(y + h / 2)}) — the centre of #${element.i} ${elementName(element, String(element.i))}. Jev returned the index; the point is ours.` };
    }
    if (decision.kind === 'screen') {
        switch (decision.chosen) {
            case 'system-prompt': return { key: 'tap', note: 'System prompt on top — next Jev is asked which button dismisses it, then that element is tapped.' };
            case 'home-screen': return { key: 'launch', note: 'App is not in the foreground — launched once more.' };
            case 'sign-in': return { key: 'wait', note: 'Sign-in screen — left for the operator, plain wait.' };
            default: return { key: 'wait', note: "App's own interface is up — nothing to do, plain wait." };
        }
    }
    return { key: null, note: 'Yes/no check — informs the workflow, no key of its own.' };
}
// --- overlay -------------------------------------------------------------------------
function drawOverlay(decision) {
    overlay.replaceChildren();
    frame.classList.toggle('is-escalated', Boolean(decision?.escalated));
    if (!decision) {
        banner.hidden = true;
        return;
    }
    const screen = screenSizeFor(decision);
    overlay.setAttribute('viewBox', `0 0 ${screen.width} ${screen.height}`);
    frame.style.aspectRatio = `${screen.width} / ${screen.height}`;
    const picked = chosenElement(decision);
    const pickEscalated = decision.kind === 'element' && decision.escalated;
    const shade = document.createElementNS(SVG, 'rect');
    shade.setAttribute('class', 'jev-shade');
    shade.setAttribute('width', String(screen.width));
    shade.setAttribute('height', String(screen.height));
    overlay.append(shade);
    const sorted = [...decision.elements].sort((a, b) => (probabilityFor(decision, a) ?? 0) - (probabilityFor(decision, b) ?? 0));
    for (const element of sorted) {
        const probability = probabilityFor(decision, element);
        const isPick = picked?.i === element.i;
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
    const pickNearTop = picked ? picked.rect[1] + picked.rect[3] / 2 < screen.height * 0.34 : false;
    banner.hidden = false;
    banner.className = `jev-banner ${decision.escalated ? 'is-escalated' : 'is-ok'} ${pickNearTop ? 'at-bottom' : 'at-top'}`;
    banner.innerHTML = bannerHtml(decision, picked);
}
function bannerHtml(decision, picked) {
    const head = decision.escalated
        ? `<strong>Escalate</strong><span>${escapeHtml(decision.escalationReason ?? 'unknown reason')} · nothing tapped</span>`
        : decision.kind === 'screen'
            ? `<strong>Screen: ${escapeHtml(decision.chosen)}</strong><span>${percent(decision.confidence)} confidence · fits ${percent(decision.fits)}</span>`
            : decision.kind === 'element'
                ? `<strong>Tap #${escapeHtml(decision.chosen)} · ${escapeHtml(elementName(picked, decision.chosen ?? ''))}</strong><span>${percent(decision.confidence)} confidence · fits ${percent(decision.fits)}</span>`
                : `<strong>Asked</strong><span>${Object.entries(decision.probabilities).map(([id, p]) => `${escapeHtml(id)} ${percent(p)}`).join(' · ')}</span>`;
    return `${head}<em>${decision.latencyMs} ms</em>`;
}
// --- HUD: brand -------------------------------------------------------------------------
function renderBrand() {
    const newest = decisions[0];
    const enabled = metrics?.enabled ?? true;
    const recentlyDecided = newest ? Date.now() - new Date(newest.createdAt).getTime() < DECIDING_GLOW_MS : false;
    const state = !enabled ? 'off' : asking || recentlyDecided ? 'deciding' : 'watching';
    hudBrand.className = `jev-hud-card jev-hud-brand is-${state}`;
    hudState.textContent = state === 'off' ? 'is off' : state === 'deciding' ? 'is deciding' : 'is watching';
    hudModel.textContent = `System One · ${metrics?.model ?? newest?.model ?? '—'}`;
    const shown = currentDecision();
    hudLatency.textContent = asking ? `${Math.round((Date.now() - asking.startedAt) / 100) / 10}s` : shown ? `${shown.latencyMs} ms` : '— ms';
    enabledPill.textContent = enabled ? 'Decisions · on' : 'Decisions · off';
    enabledPill.classList.toggle('is-off', !enabled);
    document.querySelector('.jev-header h1 em').textContent = state === 'off' ? 'is off' : state === 'deciding' ? 'is deciding' : 'is watching';
}
/** The options Jev chose between, as lane cards. Element picks show the top three plus "none". */
function lanesFor(decision) {
    const entries = Object.entries(decision.probabilities);
    const tone = (key, p) => {
        if (key === decision.chosen)
            return decision.escalated ? 'danger' : 'win';
        if (key === 'unknown' && p >= 0.2)
            return 'danger';
        return 'plain';
    };
    if (decision.kind === 'element') {
        const options = (decision.questions.options ?? {});
        const ranked = entries.filter(([key]) => key !== 'unknown').sort((a, b) => b[1] - a[1]);
        const top = ranked.slice(0, 3);
        if (decision.chosen && !top.some(([key]) => key === decision.chosen) && decision.chosen !== 'unknown') {
            const chosen = ranked.find(([key]) => key === decision.chosen);
            if (chosen)
                top.splice(2, 1, chosen);
        }
        const lanes = top.map(([key, p]) => {
            const element = decision.elements.find((candidate) => String(candidate.i) === key);
            return { key, name: `#${key}`, sub: element ? `${elementName(element, key)} · ${element.role}` : options[key] ?? '', probability: p, tone: tone(key, p) };
        });
        const unknown = decision.probabilities.unknown ?? 0;
        lanes.push({ key: 'unknown', name: 'None', sub: 'nothing fits', probability: unknown, tone: tone('unknown', unknown) });
        return lanes;
    }
    if (decision.kind === 'screen') {
        const pick = decision.questions.pick;
        const order = Object.keys(pick?.criteria ?? decision.probabilities);
        return order.map((key) => {
            const p = decision.probabilities[key] ?? 0;
            return { key, name: key === 'unknown' ? 'None' : key.replace(/-/g, ' '), sub: key === 'unknown' ? 'nothing fits' : (pick?.criteria?.[key] ?? '').split(/[:—(]/)[0].trim(), probability: p, tone: tone(key, p) };
        });
    }
    return entries.map(([key, p]) => ({ key, name: key, sub: String(decision.questions[key] ?? ''), probability: p, tone: p >= 0.5 ? 'win' : 'plain' }));
}
function renderLanes(decision) {
    if (!decision) {
        lanesTitle.textContent = 'This decision';
        lanesWhen.textContent = '';
        lanesEl.innerHTML = '<p class="jev-empty">No decision yet.</p>';
        verdictEl.className = 'jev-verdict is-idle';
        verdictMain.textContent = '—';
        verdictSub.textContent = '';
        return;
    }
    lanesTitle.textContent = kindTitle(decision.kind);
    lanesWhen.textContent = `${shortSource(decision.source)} · ${timeAgo(decision.createdAt)}`;
    const lanes = lanesFor(decision);
    lanesEl.className = `jev-lanes cols-${Math.min(lanes.length, 5)}`;
    lanesEl.innerHTML = lanes.map((lane) => `
        <div class="jev-lane is-${lane.tone}" style="--p:${lane.probability}" title="${escapeHtml(lane.sub)}">
            <span class="jev-lane-name">${escapeHtml(lane.name)}</span>
            <span class="jev-lane-sub">${escapeHtml(lane.sub)}</span>
            <span class="jev-lane-bar" aria-hidden="true"></span>
            <strong class="jev-lane-p">${percent(lane.probability)}</strong>
        </div>`).join('');
    const picked = chosenElement(decision);
    verdictEl.className = `jev-verdict ${decision.escalated ? 'is-escalated' : 'is-ok'}`;
    if (decision.escalated) {
        verdictMain.textContent = `Escalate · ${decision.escalationReason ?? 'unknown'}`;
        verdictSub.textContent = `${decision.chosen ? `winner was ${decision.chosen} at ${percent(decision.confidence)}` : percent(decision.confidence)} · fits ${percent(decision.fits)} · ${decision.latencyMs} ms`;
    }
    else if (decision.kind === 'element') {
        verdictMain.textContent = `Tap #${decision.chosen} · ${elementName(picked, decision.chosen ?? '')}`;
        verdictSub.textContent = `${percent(decision.confidence)} of choice · fits ${percent(decision.fits)} · ${decision.latencyMs} ms`;
    }
    else if (decision.kind === 'screen') {
        verdictMain.textContent = `Screen · ${decision.chosen}`;
        verdictSub.textContent = `${percent(decision.confidence)} of choice · fits ${percent(decision.fits)} · ${decision.latencyMs} ms`;
    }
    else {
        verdictMain.textContent = 'Answered';
        verdictSub.textContent = `${Object.entries(decision.probabilities).map(([id, p]) => `${id} ${percent(p)}`).join(' · ')} · ${decision.latencyMs} ms`;
    }
}
// --- HUD: keys ------------------------------------------------------------------------------
function renderKeys(decision) {
    const pressed = decision ? keyFor(decision) : { key: null, note: 'Jev never presses a key itself — it answers with an index and the workflow decides.' };
    for (const button of keyButtons) {
        const isPressed = button.dataset.key === pressed.key;
        button.classList.toggle('is-pressed', isPressed);
        button.classList.toggle('is-danger', isPressed && pressed.key === 'escalate');
    }
    keyNote.textContent = pressed.note;
}
// --- HUD: feed --------------------------------------------------------------------------------
function feedChip(decision) {
    if (decision.escalated)
        return `<span class="jev-chip is-escalated">Escalate · ${escapeHtml(decision.escalationReason ?? '')}</span>`;
    if (decision.kind === 'element')
        return `<span class="jev-chip is-ok">Tap #${escapeHtml(decision.chosen)} · ${percent(decision.confidence)}</span>`;
    if (decision.kind === 'screen')
        return `<span class="jev-chip is-ok">${escapeHtml(decision.chosen)} · ${percent(decision.confidence)}</span>`;
    return `<span class="jev-chip is-ok">${Object.entries(decision.probabilities).map(([id, p]) => `${escapeHtml(id)} ${percent(p)}`).join(' · ')}</span>`;
}
function renderFeed() {
    const rows = [];
    if (asking) {
        rows.push(`<li class="jev-feed-row is-asking"><time>${clock(new Date(asking.startedAt).toISOString())}</time><span class="jev-feed-what">${escapeHtml(asking.kind === 'element' ? asking.goal ?? '' : 'which screen?')}</span><span class="jev-chip is-asking">asking<i>…</i></span></li>`);
    }
    for (const decision of decisions) {
        rows.push(`<li class="jev-feed-row${decision.id === selectedId ? ' is-active' : ''}${decision.escalated ? ' is-escalated' : ''}" data-id="${escapeHtml(decision.id)}">
            <time>${clock(decision.createdAt)}</time>
            <span class="jev-feed-what" title="${escapeHtml(questionText(decision))}">${escapeHtml(decision.kind === 'element' ? String(decision.questions.goal ?? 'which element?') : decision.kind === 'screen' ? 'which screen?' : 'yes / no')} <em>${decision.elements.length} el · ${escapeHtml(shortSource(decision.source))} · ${decision.latencyMs} ms</em></span>
            ${feedChip(decision)}
        </li>`);
    }
    feedEl.innerHTML = rows.length ? rows.join('') : '<li class="jev-empty">No decisions yet. Ask Jev something on the left, or run a workflow with decisions enabled (e.g. <code>open-app</code> with <code>OPEN_APP_USE_DECISIONS=true</code>).</li>';
}
function renderStats() {
    const parts = [];
    if (metrics) {
        parts.push(`${metrics.totals.decisions} decisions`);
        parts.push(`${percent(metrics.totals.rate)} escalated`);
        const [thisWeek, lastWeek] = metrics.byWeek;
        if (thisWeek)
            parts.push(`this week ${percent(thisWeek.rate)}${lastWeek ? ` (last ${percent(lastWeek.rate)})` : ''}`);
    }
    if (decisions.length) {
        const avg = Math.round(decisions.reduce((sum, decision) => sum + decision.latencyMs, 0) / decisions.length);
        const tokens = decisions.reduce((sum, decision) => sum + decision.inputTokens + decision.outputTokens, 0);
        parts.push(`avg ${avg} ms`, `${formatTokens(tokens)} tokens in view`);
    }
    hudStats.textContent = parts.join(' · ') || '—';
}
// --- stage text -------------------------------------------------------------------------------
function renderCaption(decision) {
    if (!decision) {
        caption.textContent = '';
        return;
    }
    const screen = screenSizeFor(decision);
    caption.textContent = `${decision.elements.length} elements · ${screen.width}×${screen.height} pt · ${clock(decision.createdAt)}`;
}
function renderStage(decision) {
    renderCaption(decision);
    if (!decision) {
        title.textContent = 'Waiting for a decision';
        meta.textContent = 'Pick a phone. The overlay updates the moment a workflow asks Jev something.';
        questionEl.textContent = '—';
        elementsEl.innerHTML = '';
        elementsCount.textContent = '';
        return;
    }
    title.textContent = kindTitle(decision.kind);
    meta.textContent = `${deviceLabel(decision.deviceUdid)} · ${decision.source ?? 'unknown source'} · ${decision.model} · ${timeAgo(decision.createdAt)}${decision.executionId ? ` · execution ${decision.executionId.slice(0, 8)}` : ''}`;
    questionEl.textContent = questionText(decision);
    elementsCount.textContent = `(${decision.elements.length})`;
    elementsEl.innerHTML = decision.elements.map((element) => {
        const p = probabilityFor(decision, element);
        return `<li class="${String(element.i) === decision.chosen ? 'is-chosen' : ''}"><code>#${element.i}</code> ${escapeHtml(element.role)}${element.label ? ` <strong>${escapeHtml(element.label)}</strong>` : ''}${element.value ? ` <em>${escapeHtml(element.value)}</em>` : ''}<span class="jev-el-rect">${element.rect.join(', ')}</span>${p !== null && p >= 0.01 ? `<span class="jev-el-p">${percent(p)}</span>` : ''}</li>`;
    }).join('');
}
// --- selection ---------------------------------------------------------------------------------
function currentDecision() {
    return decisions.find((decision) => decision.id === selectedId) ?? null;
}
function renderAll() {
    const decision = currentDecision();
    renderStage(decision);
    drawOverlay(decision);
    renderLanes(decision);
    renderKeys(decision);
    renderFeed();
    renderBrand();
    renderStats();
}
function select(id, options = {}) {
    selectedId = id;
    renderAll();
    const decision = currentDecision();
    if (decision) {
        void ensureScreenSize(decision.deviceUdid);
        showLiveStream(decision.deviceUdid);
        if (options.animate) {
            for (const el of [frame, lanesEl, verdictEl]) {
                el.classList.remove('is-fresh');
                void el.offsetWidth;
                el.classList.add('is-fresh');
            }
        }
    }
}
// --- data -------------------------------------------------------------------------------------
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
        metrics = await api('/api/decisions/metrics?weeks=8');
        unconfigured.hidden = metrics.enabled;
    }
    catch {
        metrics = null;
    }
    renderBrand();
    renderStats();
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
        else if (!currentDecision()) {
            select(newest?.id ?? null);
        }
        else {
            renderAll();
        }
        if (!decisions.length)
            showLiveStream(udid || null);
    }
    catch (error) {
        feedEl.innerHTML = `<li class="jev-empty">${escapeHtml(error instanceof Error ? error.message : 'Could not load decisions')}</li>`;
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
// --- probe -------------------------------------------------------------------------------------
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
    asking = { kind, goal, startedAt: Date.now() };
    renderFeed();
    renderBrand();
    const ticker = window.setInterval(renderBrand, 100);
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
        window.clearInterval(ticker);
        asking = null;
        probeElementButton.disabled = false;
        probeScreenButton.disabled = false;
        renderFeed();
        renderBrand();
    }
}
// --- wiring --------------------------------------------------------------------------------------
probeForm.addEventListener('submit', (event) => { event.preventDefault(); void probe('element'); });
probeScreenButton.addEventListener('click', () => { void probe('screen'); });
feedEl.addEventListener('click', (event) => {
    const item = event.target.closest('.jev-feed-row[data-id]');
    if (!item?.dataset.id)
        return;
    setFollowing(false);
    select(item.dataset.id);
});
followButton.addEventListener('click', () => setFollowing(!following));
refreshButton.addEventListener('click', () => { void loadDecisions(); void loadMetrics(); void loadDevices(); });
whatSeesButton.addEventListener('click', () => {
    elementsDetails.open = !elementsDetails.open;
    if (elementsDetails.open)
        elementsDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
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
// "just now" → "12s ago", and the deciding glow fading back to watching.
window.setInterval(() => { renderBrand(); if (currentDecision())
    lanesWhen.textContent = `${shortSource(currentDecision().source)} · ${timeAgo(currentDecision().createdAt)}`; }, 2_000);
void (async () => {
    await loadDevices();
    await Promise.all([loadMetrics(), loadDecisions()]);
    schedulePoll();
})();
