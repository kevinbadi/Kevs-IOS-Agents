import assert from 'node:assert/strict';
import test from 'node:test';

import { createDecisions, describeElement } from '../src/decisions/client.js';
import { DEFAULT_JEV_MODEL, decisionsConfigFromEnv, type DecisionsConfig } from '../src/decisions/config.js';
import { JevClient, JevError, JevTimeoutError } from '../src/decisions/jev-client.js';
import { MemoryDecisionSink } from '../src/decisions/telemetry.js';
import type { DecisionBackend, SystemOneQuestion, SystemOneResponse } from '../src/decisions/types.js';
import { elementCentre, type IndexedElement } from '../src/devices/elements.js';
import { createOpenAppTask, OPEN_APP_SCREENS, openAppUsesDecisions } from '../src/example-plugin.js';
import type { DeviceAutomation, TaskExecutionContext } from '../src/plugin.js';

const ELEMENTS: IndexedElement[] = [
    { index: 0, role: 'StaticText', label: '“Instagram” Would Like to Send You Notifications', rect: { x: 40, y: 300, w: 310, h: 60 } },
    { index: 1, role: 'Button', label: 'Don’t Allow', rect: { x: 40, y: 420, w: 150, h: 44 } },
    { index: 2, role: 'Button', label: 'Allow', rect: { x: 200, y: 420, w: 150, h: 44 } },
    { index: 3, role: 'Button', label: 'Home', rect: { x: 10, y: 790, w: 60, h: 50 } },
];

const CONFIG: DecisionsConfig = {
    apiKey: 'k', model: DEFAULT_JEV_MODEL, baseUrl: 'https://api.test', confidenceThreshold: 0.75, fitThreshold: 0.5, timeoutMs: 3_000, maxAttempts: 3,
};

interface Captured { state: unknown; questions: Record<string, SystemOneQuestion> }

/** A backend that records what it was asked and replies from a script. */
function scriptedBackend(replies: Array<SystemOneResponse | Error>): DecisionBackend & { captured: Captured[] } {
    const captured: Captured[] = [];
    return {
        model: DEFAULT_JEV_MODEL,
        captured,
        async systemone(state, questions) {
            captured.push({ state, questions });
            const reply = replies.shift();
            if (!reply) throw new Error('script exhausted');
            if (reply instanceof Error) throw reply;
            return reply;
        },
    };
}

const choice = (pick: string, confidence: number, probabilities: Record<string, number>, fits?: number): SystemOneResponse => ({
    model: DEFAULT_JEV_MODEL,
    answers: {
        pick: { type: 'choice', choice: pick, confidence, probabilities },
        ...(fits === undefined ? {} : { fits: { type: 'noul', noul: fits } }),
    },
    usage: { input_tokens: 400, output_tokens: 50 },
});

test('the model never produces a coordinate: it returns an index and our code maps it to the rect centre', async () => {
    const backend = scriptedBackend([choice('1', 0.97, { '0': 0.01, '1': 0.97, '2': 0.02, '3': 0, unknown: 0 }, 0.95)]);
    const sink = new MemoryDecisionSink();
    const decisions = createDecisions({ executionId: 'exec-1', deviceUdid: 'udid-1', source: 'test' }, { config: CONFIG, backend, sink });

    const verdict = await decisions.chooseElement(ELEMENTS, 'Dismiss the notification prompt without allowing');

    // What went over the wire: options are keyed by index and described by role + words only.
    const sent = backend.captured[0]!;
    const pick = sent.questions.pick;
    assert.equal(pick?.type, 'choice');
    assert.deepEqual(Object.keys((pick as { criteria: Record<string, string> }).criteria), ['0', '1', '2', '3', 'unknown']);
    const wire = JSON.stringify(sent.questions);
    assert.ok(!/\bx\b|\by\b|coordinate|tap\(/i.test(wire), 'the questions never mention coordinates or ask for them');
    assert.equal((pick as { criteria: Record<string, string> }).criteria['1'], 'Button "Don’t Allow"');

    // What came back was the string "1" — the geometry is derived on our side.
    assert.equal(verdict.escalate, false);
    assert.equal(verdict.value, 1);
    assert.equal(verdict.element, ELEMENTS[1]);
    assert.deepEqual(verdict.tapPoint, elementCentre(ELEMENTS[1]!));
    assert.deepEqual(verdict.tapPoint, { x: 115, y: 442 });
    assert.equal(verdict.confidence, 0.97);
    assert.equal(verdict.fits, 0.95);

    // A reply that is not an index we offered is never acted on, even if it looks like a point.
    const smuggled = scriptedBackend([choice('x=115,y=442', 0.99, { 'x=115,y=442': 0.99 }, 0.9)]);
    const bad = await createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend: smuggled, sink: null }).chooseElement(ELEMENTS, 'anything');
    assert.equal(bad.escalate, true);
    assert.equal(bad.reason, 'invalid-choice');
    assert.equal(bad.tapPoint, null);
    assert.equal(bad.element, null);

    const outOfRange = scriptedBackend([choice('9', 0.99, { '9': 0.99 }, 0.9)]);
    const missing = await createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend: outOfRange, sink: null }).chooseElement(ELEMENTS, 'anything');
    assert.equal(missing.reason, 'invalid-choice');

    // Telemetry carries everything needed for the escalation-rate number.
    assert.equal(sink.records.length, 1);
    const row = sink.records[0]!;
    assert.equal(row.executionId, 'exec-1');
    assert.equal(row.deviceUdid, 'udid-1');
    assert.equal(row.kind, 'element');
    assert.equal(row.chosen, '1');
    assert.equal(row.confidence, 0.97);
    assert.equal(row.fits, 0.95);
    assert.equal(row.escalated, false);
    assert.equal(row.inputTokens, 400);
    assert.equal(row.outputTokens, 50);
    assert.deepEqual(row.probabilities, { '0': 0.01, '1': 0.97, '2': 0.02, '3': 0, unknown: 0 });
    assert.ok(typeof row.latencyMs === 'number');
    // …and the element list it chose from, so the dashboard can draw the decision back onto the screen.
    assert.deepEqual(row.elements.map((element) => [element.i, element.rect]), ELEMENTS.map((element) => [element.index, [element.rect.x, element.rect.y, element.rect.w, element.rect.h]]));
    assert.equal(row.elements[1]?.label, 'Don’t Allow');
});

test('nothing fits: a confident Choice winner still escalates when the paired Noul says no option is right', async () => {
    // Choice is relative — it crowns a winner even when every option is wrong.
    const backend = scriptedBackend([
        choice('feed', 0.92, { feed: 0.92, profile: 0.05, unknown: 0.03 }, 0.12),
    ]);
    const sink = new MemoryDecisionSink();
    const decisions = createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend, sink });
    const verdict = await decisions.decideScreen(ELEMENTS, { feed: 'The main feed', profile: 'A profile page' });
    assert.equal(verdict.value, 'feed', 'the winner is still reported…');
    assert.equal(verdict.confidence, 0.92);
    assert.equal(verdict.escalate, true, '…but must not be acted on');
    assert.equal(verdict.reason, 'nothing-fits');
    assert.equal(verdict.fits, 0.12);
    assert.equal(sink.records[0]?.escalated, true);
    assert.equal(sink.records[0]?.escalationReason, 'nothing-fits');

    // Both questions travel in the same request, and the screen descriptions are in the state.
    const sent = backend.captured[0]!;
    assert.deepEqual(Object.keys(sent.questions), ['pick', 'fits']);
    assert.equal(sent.questions.fits?.type, 'noul');
    assert.deepEqual((sent.state as { screens: unknown }).screens, { feed: 'The main feed', profile: 'A profile page' });
    assert.ok(Array.isArray((sent.state as { elements: unknown[] }).elements));
});

test('escalation rule: unknown, low confidence, and invalid choices all escalate; a good answer does not', async () => {
    const backend = scriptedBackend([
        choice('unknown', 0.8, { unknown: 0.8, feed: 0.2 }, 0.9),
        choice('feed', 0.6, { feed: 0.6, profile: 0.4 }, 0.9),
        choice('somewhere-else', 0.99, { 'somewhere-else': 0.99 }, 0.9),
        choice('feed', 0.9, { feed: 0.9, profile: 0.1 }, 0.9),
    ]);
    const decisions = createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend, sink: null });
    const screens = { feed: 'feed', profile: 'profile' };
    assert.equal((await decisions.decideScreen(ELEMENTS, screens)).reason, 'unknown');
    assert.equal((await decisions.decideScreen(ELEMENTS, screens)).reason, 'low-confidence');
    assert.equal((await decisions.decideScreen(ELEMENTS, screens)).reason, 'invalid-choice');
    const good = await decisions.decideScreen(ELEMENTS, screens);
    assert.equal(good.escalate, false);
    assert.equal(good.reason, undefined);
    assert.equal(good.value, 'feed');
});

test('a timeout is an escalation, never a verdict; other errors too', async () => {
    const backend = scriptedBackend([new JevTimeoutError('slow'), new JevError('boom', 500), new JevTimeoutError('slow')]);
    const sink = new MemoryDecisionSink();
    const decisions = createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend, sink });
    const screen = await decisions.decideScreen(ELEMENTS, { feed: 'feed' });
    assert.deepEqual([screen.escalate, screen.reason, screen.value, screen.confidence], [true, 'timeout', 'unknown', 0]);
    const element = await decisions.chooseElement(ELEMENTS, 'tap Home');
    assert.deepEqual([element.escalate, element.reason, element.tapPoint], [true, 'error', null]);
    const asked = await decisions.ask(ELEMENTS, { ok: 'Is it fine?' });
    assert.deepEqual([asked.escalate, asked.reason, asked.answers], [true, 'timeout', {}]);
    assert.deepEqual(sink.records.map((record) => record.escalationReason), ['timeout', 'error', 'timeout']);
});

test('no API key: decisions are unavailable, nothing is sent, nothing crashes', async () => {
    const config = decisionsConfigFromEnv({});
    assert.equal(config.apiKey, null);
    assert.equal(config.model, DEFAULT_JEV_MODEL);
    assert.equal(config.model, 'jev-1.13.0', 'pinned, not jev-latest');
    const sink = new MemoryDecisionSink();
    const decisions = createDecisions({ deviceUdid: 'udid-1' }, { config, sink });
    assert.equal(decisions.available, false);
    const screen = await decisions.decideScreen(ELEMENTS, { feed: 'feed' });
    assert.deepEqual([screen.escalate, screen.reason, screen.value], [true, 'unavailable', 'unknown']);
    const element = await decisions.chooseElement(ELEMENTS, 'tap Home');
    assert.deepEqual([element.escalate, element.reason, element.tapPoint, element.element], [true, 'unavailable', null, null]);
    const asked = await decisions.ask(ELEMENTS, { ok: 'Is it fine?' });
    assert.deepEqual([asked.escalate, asked.reason], [true, 'unavailable']);
    assert.equal(sink.records.length, 0, 'unavailable calls are not telemetry — they would pollute the escalation rate');

    const withKey = decisionsConfigFromEnv({ TYPESAFE_API_KEY: ' k ', JEV_MODEL: 'jev-1.13.0', DECISIONS_CONFIDENCE_THRESHOLD: '0.9', DECISIONS_TIMEOUT_MS: 'nope' });
    assert.equal(withKey.apiKey, 'k');
    assert.equal(withKey.confidenceThreshold, 0.9);
    assert.equal(withKey.timeoutMs, 3_000, 'garbage falls back to the default');
});

test('ask() batches Nouls into one request and returns a probability per question', async () => {
    const backend = scriptedBackend([{
        model: DEFAULT_JEV_MODEL,
        answers: { appeared: { type: 'noul', noul: 0.91 }, promptGone: { type: 'noul', noul: 0.88 } },
        usage: { input_tokens: 300, output_tokens: 20 },
    }]);
    const decisions = createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend, sink: null });
    const answers = await decisions.ask(ELEMENTS, { appeared: 'Did the app appear?', promptGone: 'Is the prompt gone?' });
    assert.equal(answers.escalate, false);
    assert.deepEqual(answers.answers, { appeared: 0.91, promptGone: 0.88 });
    assert.equal(backend.captured.length, 1, 'one round trip for both questions');
    assert.deepEqual(Object.keys(backend.captured[0]!.questions), ['appeared', 'promptGone']);
});

test('JevClient posts to /v1/systemone with the pinned model, retries 429/529 with backoff, and times out into escalation', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const statuses = [429, 529, 200];
    const sleeps: number[] = [];
    const client = new JevClient({
        apiKey: 'secret', baseUrl: 'https://api.test/', model: 'jev-1.13.0', timeoutMs: 3_000,
        sleep: async (ms) => { sleeps.push(ms); },
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
            requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: new Headers(init?.headers).get('authorization') });
            const status = statuses.shift() ?? 200;
            if (status !== 200) return new Response('{}', { status });
            return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { pick: { type: 'choice', choice: '0', confidence: 1, probabilities: { '0': 1 } } }, usage: { input_tokens: 1, output_tokens: 1 } }));
        }) as typeof fetch,
    });
    const response = await client.systemone({ elements: [] }, { pick: { type: 'choice', instructions: 'q', criteria: { '0': 'a' } } });
    assert.equal(response.answers.pick?.type, 'choice');
    assert.equal(requests.length, 3);
    assert.deepEqual(sleeps, [300, 600], 'exponential backoff between retries');
    assert.equal(requests[0]?.url, 'https://api.test/v1/systemone');
    assert.equal(requests[0]?.auth, 'Bearer secret');
    assert.equal(requests[0]?.body.model, 'jev-1.13.0');
    assert.deepEqual(Object.keys(requests[0]!.body), ['model', 'state', 'questions']);

    // A 4xx that is not rate limiting is not retried and surfaces the API's message.
    const failing = new JevClient({
        apiKey: 'k', fetchImpl: (async () => new Response(JSON.stringify({ detail: { message: 'Unknown model: jev-1.13' } }), { status: 422 })) as typeof fetch,
    });
    await assert.rejects(failing.systemone({}, {}), /Jev returned 422: Unknown model: jev-1.13/);

    // Exhausted retries return the last status as an error rather than looping forever.
    const exhausted = new JevClient({ apiKey: 'k', maxAttempts: 2, sleep: async () => {}, fetchImpl: (async () => new Response('{}', { status: 429 })) as typeof fetch });
    await assert.rejects(exhausted.systemone({}, {}), (error: unknown) => error instanceof JevError && error.status === 429);

    // Timeouts come back as their own error type so the caller can escalate.
    const slow = new JevClient({
        apiKey: 'k', timeoutMs: 20,
        fetchImpl: ((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        })) as typeof fetch,
    });
    await assert.rejects(slow.systemone({}, {}), (error: unknown) => error instanceof JevTimeoutError);
    assert.throws(() => new JevClient({ apiKey: '' }), /TYPESAFE_API_KEY is required/);
});

test('GET /api/decisions/metrics reports the weekly escalation rate (503 without a database)', async (context) => {
    const { createApp } = await import('../src/api/app.js');
    const { PluginRegistry } = await import('../src/registry.js');
    const { defaultDashboardTheme } = await import('../src/dashboard-theme.js');
    const { inject } = await import('./support.js');
    const rows = [
        { week_start: '2026-09-14', decisions: '40', escalated: '10', avg_latency_ms: '210', input_tokens: '16000' },
        { week_start: '2026-09-07', decisions: '20', escalated: '12', avg_latency_ms: '250', input_tokens: '8000' },
    ];
    const scheduler = { connection: { db: { async execute() { return { rows }; } } } } as unknown as import('../src/scheduler/repository.js').SchedulerRepository;
    const app = await createApp({ plugins: new PluginRegistry([]), scheduler, dashboardTheme: defaultDashboardTheme, agentRunner: null, localAgentRunner: null });
    context.after(() => app.close());
    const res = await inject(app, { method: 'GET', url: '/api/decisions/metrics?weeks=4' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { model: string; totals: { decisions: number; escalated: number; rate: number }; byWeek: Array<{ weekStart: string; rate: number }> };
    assert.equal(body.model, 'jev-1.13.0');
    assert.deepEqual(body.totals, { decisions: 60, escalated: 22, rate: 22 / 60 });
    assert.deepEqual(body.byWeek.map((bucket) => [bucket.weekStart, bucket.rate]), [['2026-09-14', 0.25], ['2026-09-07', 0.6]]);

    const bare = await createApp({ plugins: new PluginRegistry([]), scheduler: {} as import('../src/scheduler/repository.js').SchedulerRepository, dashboardTheme: defaultDashboardTheme, agentRunner: null, localAgentRunner: null });
    context.after(() => bare.close());
    assert.equal((await inject(bare, { method: 'GET', url: '/api/decisions/metrics' })).statusCode, 503);
});

test('GET /api/decisions/recent returns decisions with the elements they were drawn from, and the Jev page is served', async (context) => {
    const { createApp } = await import('../src/api/app.js');
    const { PluginRegistry } = await import('../src/registry.js');
    const { defaultDashboardTheme } = await import('../src/dashboard-theme.js');
    const { inject } = await import('./support.js');
    const params: unknown[] = [];
    const row = {
        id: 'd1', created_at: new Date('2026-09-20T20:00:00Z'), execution_id: 'e1', device_udid: 'udid-1', kind: 'element', source: 'example/open-app',
        model: 'jev-1.13.0', questions: { goal: 'dismiss', options: { '1': 'Button "Don’t Allow"' } },
        elements: [{ i: 1, role: 'Button', label: 'Don’t Allow', rect: [40, 420, 150, 44] }],
        chosen: '1', probabilities: { '1': 0.97, unknown: 0 }, confidence: 0.97, fits: 0.95, escalated: false, escalation_reason: null,
        latency_ms: 210, input_tokens: 400, output_tokens: 50,
    };
    // Bound values sit directly in the SQL chunks (nested for sub-fragments); collect them to check the filters.
    const collect = (chunk: unknown): void => {
        if (Array.isArray(chunk)) chunk.forEach(collect);
        else if (chunk && typeof chunk === 'object') {
            if ('queryChunks' in chunk) collect((chunk as { queryChunks: unknown[] }).queryChunks);
            else if ('value' in chunk) params.push((chunk as { value: unknown }).value);
        } else if (typeof chunk === 'string' || typeof chunk === 'number') params.push(chunk);
    };
    const scheduler = { connection: { db: { async execute(query: unknown) { collect(query); return { rows: [row] }; } } } } as unknown as import('../src/scheduler/repository.js').SchedulerRepository;
    const app = await createApp({ plugins: new PluginRegistry([]), scheduler, dashboardTheme: defaultDashboardTheme, agentRunner: null, localAgentRunner: null });
    context.after(() => app.close());

    const res = await inject(app, { method: 'GET', url: '/api/decisions/recent?deviceUdid=udid-1&limit=5' });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { decisions: Array<{ id: string; createdAt: string; deviceUdid: string; elements: Array<{ i: number; rect: number[] }>; chosen: string; latencyMs: number }> };
    assert.equal(body.decisions.length, 1);
    assert.equal(body.decisions[0]?.createdAt, '2026-09-20T20:00:00.000Z');
    assert.equal(body.decisions[0]?.chosen, '1');
    assert.equal(body.decisions[0]?.latencyMs, 210);
    assert.deepEqual(body.decisions[0]?.elements, [{ i: 1, role: 'Button', label: 'Don’t Allow', rect: [40, 420, 150, 44] }]);
    assert.ok(params.includes('udid-1'), 'the device filter reaches the query');
    assert.ok(params.includes(5), 'the limit reaches the query');

    const page = await inject(app, { method: 'GET', url: '/decisions' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /jev-overlay/);
    assert.match(page.body, /\/assets\/decisions\.js\?v=/);
    assert.equal((await inject(app, { method: 'GET', url: '/assets/decisions.js' })).statusCode, 200);
});

test('describeElement is words only', () => {
    assert.equal(describeElement(ELEMENTS[1]!), 'Button "Don’t Allow"');
    assert.equal(describeElement({ index: 4, role: 'TextField', value: 'kevin', rect: { x: 1, y: 2, w: 3, h: 4 } }), 'TextField (kevin)');
    assert.ok(!/\d/.test(describeElement(ELEMENTS[3]!)), 'no numbers leak from the rect');
});

// --- Task 3: the example plugin runs both paths ------------------------------

function fakeContext(log: string[], elementsByCall: IndexedElement[][], taps: Array<{ x: number; y: number }>): TaskExecutionContext {
    const automation: DeviceAutomation = {
        async activateApp(bundleId) { log.push(`activate:${bundleId}`); },
        async terminateApp() {},
        async pause(ms) { log.push(`pause:${ms}`); },
        async screenshot() { return Buffer.alloc(0); },
        async tap(x, y) { taps.push({ x, y }); },
        async swipe() {},
        async elements() { log.push('elements'); return elementsByCall.shift() ?? []; },
    };
    return {
        executionId: 'exec-42', attempt: 1, workspaceDirectory: '/tmp', device: { udid: 'udid-1', name: 'Phone' },
        devicePluginData: {}, automation, assets: [], signal: new AbortController().signal,
        async log(line) { log.push(`log:${line}`); },
        async runProcess() { return { exitCode: 0, stopped: false }; },
        async claimPipelineItem() { return null; },
        async completePipelineItem() {},
        async failPipelineItem() {},
    };
}

test('open-app@1 with the flag off is the original path: activate, wait, done', async () => {
    assert.equal(openAppUsesDecisions({}), false);
    assert.equal(openAppUsesDecisions({ OPEN_APP_USE_DECISIONS: 'true' }), true);
    assert.equal(openAppUsesDecisions({ OPEN_APP_USE_DECISIONS: '1' }), true);
    assert.equal(openAppUsesDecisions({ OPEN_APP_USE_DECISIONS: 'false' }), false);

    const log: string[] = [];
    const task = createOpenAppTask({
        env: {},
        decisions: () => { throw new Error('decisions must not be consulted when the flag is off'); },
    });
    const result = await task.execute(fakeContext(log, [], []), { bundleId: 'com.burbn.instagram', waitSeconds: 3 });
    assert.deepEqual(result, { exitCode: 0, stopped: false });
    assert.deepEqual(log, ['log:Opening com.burbn.instagram', 'activate:com.burbn.instagram', 'pause:3000']);
});

test('open-app@1 with the flag on identifies the screen, clears a prompt by index, and verifies the result', async () => {
    const backend = scriptedBackend([
        choice('system-prompt', 0.96, { 'system-prompt': 0.96, app: 0.03, 'sign-in': 0.01, 'home-screen': 0, unknown: 0 }, 0.94),
        choice('1', 0.93, { '1': 0.93, '2': 0.05, '0': 0.01, '3': 0.01, unknown: 0 }, 0.9),
        { model: DEFAULT_JEV_MODEL, answers: { appeared: { type: 'noul', noul: 0.9 }, promptGone: { type: 'noul', noul: 0.95 } }, usage: { input_tokens: 200, output_tokens: 10 } },
    ]);
    const sink = new MemoryDecisionSink();
    const log: string[] = [];
    const taps: Array<{ x: number; y: number }> = [];
    const afterTap = ELEMENTS.filter((element) => element.index === 3);
    const task = createOpenAppTask({
        env: { OPEN_APP_USE_DECISIONS: 'true' },
        decisions: (context) => createDecisions({ executionId: context.executionId, deviceUdid: context.device.udid, source: 'example/open-app' }, { config: CONFIG, backend, sink }),
    });
    const result = await task.execute(fakeContext(log, [ELEMENTS, afterTap], taps), { bundleId: 'com.burbn.instagram', waitSeconds: 5 });
    assert.deepEqual(result, { exitCode: 0, stopped: false });
    assert.deepEqual(taps, [{ x: 115, y: 442 }], 'tapped the centre of element 1 (Don’t Allow), computed by us');
    assert.equal(log.filter((line) => line === 'elements').length, 2, 're-read elements after the tap');
    assert.ok(log.some((line) => /Decision · screen=system-prompt confidence=96% fits=94%/.test(line)));
    assert.ok(log.some((line) => /Decision · element=1 \(Button "Don’t Allow"\)/.test(line)));
    assert.ok(log.some((line) => /Verification · app screen appeared: 90% · prompt gone: 95%/.test(line)));
    assert.deepEqual(sink.records.map((record) => [record.kind, record.escalated, record.executionId]), [
        ['screen', false, 'exec-42'], ['element', false, 'exec-42'], ['ask', false, 'exec-42'],
    ]);
    assert.deepEqual(Object.keys(OPEN_APP_SCREENS), ['app', 'system-prompt', 'sign-in', 'home-screen']);
    assert.deepEqual((backend.captured[0]!.state as { screens: unknown }).screens, OPEN_APP_SCREENS);
});

test('open-app@1 with the flag on but an escalating verdict never taps and falls back to the plain wait', async () => {
    const backend = scriptedBackend([
        choice('system-prompt', 0.96, { 'system-prompt': 0.96 }, 0.2), // confident but nothing fits
    ]);
    const log: string[] = [];
    const taps: Array<{ x: number; y: number }> = [];
    const task = createOpenAppTask({
        env: { OPEN_APP_USE_DECISIONS: '1' },
        decisions: () => createDecisions({ deviceUdid: 'udid-1' }, { config: CONFIG, backend, sink: null }),
    });
    await task.execute(fakeContext(log, [ELEMENTS], taps), { bundleId: 'com.apple.AppStore', waitSeconds: 2 });
    assert.deepEqual(taps, []);
    assert.ok(log.some((line) => /ESCALATE \(nothing-fits\)/.test(line)));
    assert.ok(log.some((line) => /falling back to the plain wait/.test(line)));

    // No key at all: the flag is honoured but harmless.
    const quiet: string[] = [];
    const unconfigured = createOpenAppTask({
        env: { OPEN_APP_USE_DECISIONS: '1' },
        decisions: () => createDecisions({ deviceUdid: 'udid-1' }, { config: decisionsConfigFromEnv({}), sink: null }),
    });
    const result = await unconfigured.execute(fakeContext(quiet, [], []), { bundleId: 'com.apple.AppStore', waitSeconds: 2 });
    assert.deepEqual(result, { exitCode: 0, stopped: false });
    assert.ok(quiet.some((line) => /Decisions unavailable \(TYPESAFE_API_KEY unset\)/.test(line)));
    assert.ok(!quiet.includes('elements'), 'no element read without a backend');
});
