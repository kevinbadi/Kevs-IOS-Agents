const rangeEl = document.querySelector('#results-range');
const dailyEl = document.querySelector('#results-daily');
const chartMeta = document.querySelector('#results-chart-meta');
const workflowsEl = document.querySelector('#results-workflows');
const devicesEl = document.querySelector('#results-devices');
const todayCaption = document.querySelector('#results-today-caption');
const rangeHeading = document.querySelector('#results-range-heading');
const linkedinPanel = document.querySelector('#results-linkedin');
const linkedinStats = document.querySelector('#results-linkedin-stats');
const linkedinCaption = document.querySelector('#results-linkedin-caption');
const linkedinBar = document.querySelector('#results-linkedin-bar');
const platformButtons = Array.from(document.querySelectorAll('.platform-switch-btn[data-platform]'));
const rangeButtons = Array.from(document.querySelectorAll('.results-range-btn[data-days]'));
const params = new URLSearchParams(location.search);
let platform = isPlatform(params.get('platform')) ? params.get('platform') : 'all';
let days = Number.parseInt(params.get('days') ?? '14', 10);
if (![7, 14, 30].includes(days))
    days = 14;
function isPlatform(value) {
    return value === 'all' || value === 'tiktok' || value === 'instagram' || value === 'linkedin';
}
function sentLabel(current) {
    if (current === 'instagram')
        return 'DMs';
    if (current === 'linkedin')
        return 'Connects';
    return 'Sent';
}
function formatDay(isoDate, style = 'short') {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (style === 'day')
        return String(day);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function persist() {
    const url = new URL(location.href);
    url.searchParams.set('platform', platform);
    url.searchParams.set('days', String(days));
    history.replaceState(null, '', url);
}
function statCard(value, label) {
    const article = document.createElement('article');
    article.className = 'results-stat';
    const strong = document.createElement('strong');
    strong.className = 'results-stat-value';
    strong.textContent = value.toLocaleString();
    const caption = document.createElement('span');
    caption.className = 'results-stat-label';
    caption.textContent = label;
    article.append(strong, caption);
    return article;
}
function heroStats(totals, current) {
    const cards = [[totals.likes, 'Likes'], [totals.comments, 'Comments']];
    if (current === 'all' || current === 'tiktok')
        cards.push([totals.saves, 'Saves']);
    if (current === 'all' || current === 'instagram' || current === 'linkedin') {
        cards.push([totals.sent, sentLabel(current)]);
    }
    if (current === 'tiktok')
        cards.push([totals.posts, 'Posts']);
    cards.push([totals.runs, 'Runs']);
    return cards;
}
function compactStats(totals, current) {
    return heroStats(totals, current).filter(([value, label]) => value > 0 || label === 'Runs');
}
function renderStats(target, totals) {
    target.className = 'results-stats';
    target.replaceChildren(...heroStats(totals, platform).map(([value, label]) => statCard(value, label)));
}
function renderLinkedIn(funnel) {
    const onLinkedIn = platform === 'all' || platform === 'linkedin';
    if (!onLinkedIn) {
        linkedinPanel.hidden = true;
        return;
    }
    if (!funnel || funnel.total === 0) {
        if (platform !== 'linkedin') {
            linkedinPanel.hidden = true;
            return;
        }
        linkedinPanel.hidden = false;
        linkedinCaption.textContent = 'No LinkedIn lead lists yet.';
        linkedinStats.className = 'results-stats';
        linkedinStats.replaceChildren(statCard(0, 'Leads'), statCard(0, 'Sent'), statCard(0, 'Remaining'));
        linkedinBar.hidden = true;
        return;
    }
    linkedinPanel.hidden = false;
    const lists = funnel.lists.filter((list) => list.total > 0);
    linkedinCaption.textContent = lists.length > 1
        ? `Live across ${lists.length} lists · ${lists.map((list) => `${list.name} (${list.remaining.toLocaleString()} left)`).join(' · ')}`
        : `Live from ${lists[0]?.name ?? 'the lead list'} · remaining drops as requests send`;
    linkedinStats.className = 'results-stats';
    linkedinStats.replaceChildren(statCard(funnel.total, 'Leads'), statCard(funnel.sent, 'Sent'), statCard(funnel.remaining, 'Remaining'));
    const fill = linkedinBar.querySelector('span');
    if (fill)
        fill.style.width = `${Math.min(100, Math.round((funnel.sent / funnel.total) * 100))}%`;
    linkedinBar.hidden = false;
}
function renderDaily(daysRows) {
    if (!daysRows.length) {
        dailyEl.hidden = true;
        dailyEl.replaceChildren();
        chartMeta.textContent = '';
        return;
    }
    const max = Math.max(1, ...daysRows.map((row) => row.runs));
    const totalRuns = daysRows.reduce((sum, row) => sum + row.runs, 0);
    chartMeta.textContent = `${totalRuns.toLocaleString()} runs`;
    dailyEl.hidden = false;
    const labelEvery = daysRows.length > 14 ? 4 : daysRows.length > 8 ? 2 : 1;
    dailyEl.replaceChildren(...daysRows.map((row, index) => {
        const col = document.createElement('div');
        col.className = 'results-bar-col';
        const track = document.createElement('span');
        track.className = 'results-bar-track';
        const bar = document.createElement('span');
        bar.className = 'results-bar';
        if (row.runs === 0)
            bar.classList.add('is-empty');
        bar.style.height = `${Math.max(row.runs === 0 ? 0 : 8, Math.round((row.runs / max) * 100))}%`;
        bar.title = `${formatDay(row.date)} · ${row.runs} run${row.runs === 1 ? '' : 's'}`;
        track.append(bar);
        const showLabel = index === 0 || index === daysRows.length - 1 || index % labelEvery === 0;
        const label = document.createElement('span');
        label.className = 'results-bar-label';
        label.textContent = showLabel ? formatDay(row.date, 'day') : '';
        col.append(track, label);
        return col;
    }));
}
function renderList(target, items, empty) {
    if (!items.length) {
        target.className = 'results-cards empty-state';
        target.textContent = empty;
        return;
    }
    target.className = 'results-cards';
    target.replaceChildren(...items.map((item) => {
        const card = document.createElement('article');
        card.className = 'results-card';
        const title = document.createElement('h3');
        title.textContent = item.title;
        const meta = document.createElement('p');
        meta.textContent = item.meta;
        const metrics = document.createElement('div');
        metrics.className = 'results-metrics';
        for (const [value, label] of compactStats(item, platform)) {
            if (label === 'Runs')
                continue;
            const metric = document.createElement('div');
            metric.className = 'results-metric';
            const dt = document.createElement('span');
            dt.className = 'results-metric-label';
            dt.textContent = label;
            const dd = document.createElement('strong');
            dd.className = 'results-metric-value';
            dd.textContent = value.toLocaleString();
            metric.append(dd, dt);
            metrics.append(metric);
        }
        card.append(title, meta);
        if (metrics.childElementCount)
            card.append(metrics);
        return card;
    }));
}
function todayLine(snapshot) {
    const bits = compactStats(snapshot.todayTotals, platform)
        .filter(([value]) => value > 0)
        .map(([value, label]) => `${value.toLocaleString()} ${label.toLowerCase()}`);
    const health = snapshot.range.runs
        ? `${snapshot.range.succeeded.toLocaleString()} succeeded · ${snapshot.range.failed.toLocaleString()} failed`
        : 'No runs yet';
    const today = bits.length ? bits.join(' · ') : 'quiet so far';
    return `Today, ${formatDay(snapshot.today)} · ${today}. ${health} in this window.`;
}
async function load() {
    persist();
    for (const button of platformButtons) {
        button.setAttribute('aria-selected', button.dataset.platform === platform ? 'true' : 'false');
    }
    for (const button of rangeButtons) {
        button.classList.toggle('is-active', Number(button.dataset.days) === days);
    }
    rangeHeading.textContent = `Last ${days} days`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const query = new URLSearchParams({
        days: String(days),
        platform,
        timezone,
    });
    const response = await fetch(`/api/results?${query}`);
    const body = await response.json();
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    todayCaption.textContent = todayLine(body);
    renderLinkedIn(body.linkedinConnect);
    renderStats(rangeEl, body.range);
    renderDaily(body.daily);
    renderList(workflowsEl, body.workflows.map((item) => ({
        ...item,
        title: item.label,
        meta: `${item.runs.toLocaleString()} run${item.runs === 1 ? '' : 's'}`,
    })), 'No workflow output in this window yet.');
    renderList(devicesEl, body.devices.map((item) => ({
        ...item,
        title: item.name,
        meta: `${item.runs.toLocaleString()} run${item.runs === 1 ? '' : 's'}`,
    })), 'No device runs in this window yet.');
}
function fail(error) {
    rangeEl.className = 'results-stats';
    rangeEl.textContent = error instanceof Error ? error.message : String(error);
}
for (const button of platformButtons) {
    button.addEventListener('click', () => {
        const next = button.dataset.platform ?? '';
        if (!isPlatform(next))
            return;
        platform = next;
        void load().catch(fail);
    });
}
for (const button of rangeButtons) {
    button.addEventListener('click', () => {
        days = Number(button.dataset.days) || 14;
        void load().catch(fail);
    });
}
void load().catch(fail);
export {};
