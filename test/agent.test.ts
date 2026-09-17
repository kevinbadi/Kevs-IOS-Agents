import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { describeAction, normalizeCoordinates, parseAgentAction, toolCallForAction } from '../src/agent/actions.js';
import { AgentDevice, annotateScreenshot, describeForegroundApp, scrollGesture, type AgentRemote } from '../src/agent/device.js';
import { appHintsFor, bundleIdFromLabel } from '../src/agent/playbook.js';
import { compactHierarchy } from '../src/agent/hierarchy.js';
import { AgentRunner, repeatedTapGuard, type AgentStep } from '../src/agent/runner.js';
import { AnthropicVisionModel, actionTally, buildMessages, type PriorTurn, type VisionModel, type VlmDecision, type VlmStepRequest } from '../src/agent/vlm.js';
import { OllamaVisionModel, buildLocalMessages, decisionFromJson, extractJsonObject } from '../src/agent/local-vlm.js';
import { createApp } from '../src/api/app.js';
import { defaultDashboardTheme } from '../src/dashboard-theme.js';
import type { RemoteAction } from '../src/devices/wda-remote.js';
import { PluginRegistry } from '../src/registry.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';
import { inject } from './support.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Instagram" label="Instagram" enabled="true" visible="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="create-tab" label="Create &amp; share" enabled="true" visible="true" x="165" y="780" width="60" height="50"/>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="hidden" label="Hidden" enabled="true" visible="false" x="0" y="0" width="60" height="50"/>
      <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Feed" label="Feed" enabled="true" visible="true" x="20" y="60" width="100" height="24"/>
      <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="search" value="Search" enabled="false" visible="true" x="20" y="100" width="350" height="40"/>
      <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" x="0" y="200" width="390" height="400"/>
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="offscreen" label="Offscreen" enabled="true" visible="true" x="0" y="900" width="60" height="50"/>
    </XCUIElementTypeOther>
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`;

test('compactHierarchy keeps visible labelled or interactive elements with centre points', () => {
    const result = compactHierarchy(SAMPLE_XML, { screen: { width: 390, height: 844 } });
    const labels = result.elements.map((element) => element.label);
    assert.ok(labels.includes('Create & share'), 'decodes entities in labels');
    assert.ok(labels.includes('Feed'));
    assert.ok(!labels.includes('Hidden'), 'drops invisible elements');
    assert.ok(!labels.includes('Offscreen'), 'drops elements outside the screen');
    assert.ok(!labels.includes('Instagram'), 'drops the full-screen application wrapper');
    assert.equal(result.app, 'Instagram');
    assert.match(result.text, /^Foreground app: Instagram\n/);
    assert.match(result.text, /Button "Create & share" @\(195,805\) 60x50/);
    assert.match(result.text, /TextField "search" value="Search" @\(195,120\) 350x40 disabled/);
    assert.ok(result.text.indexOf('Button') < result.text.indexOf('StaticText'), 'interactive elements listed first');
    assert.equal(result.truncated, false);
});

test('compactHierarchy truncates long trees and reports it', () => {
    const many = Array.from({ length: 300 }, (_, index) => (
        `<XCUIElementTypeButton type="XCUIElementTypeButton" label="Button ${index}" enabled="true" visible="true" x="10" y="${index * 2}" width="50" height="20"/>`
    )).join('');
    const result = compactHierarchy(`<XCUIElementTypeApplication>${many}</XCUIElementTypeApplication>`, { maxElements: 25 });
    assert.equal(result.elements.length, 25);
    assert.equal(result.truncated, true);
    assert.equal(result.total, 300);
});

test('parseAgentAction validates and normalises tool calls', () => {
    assert.deepEqual(parseAgentAction('tap', { x: 10.4, y: '20', target: 'Post' }), { type: 'tap', x: 10, y: 20, target: 'Post' });
    assert.deepEqual(parseAgentAction('swipe', { start_x: 200, start_y: 700, end_x: 200, end_y: 300 }), {
        type: 'swipe', startX: 200, startY: 700, endX: 200, endY: 300, durationMs: 350,
    });
    assert.deepEqual(parseAgentAction('long_press', { x: 1, y: 2, duration_ms: 99_999 }), { type: 'long_press', x: 1, y: 2, durationMs: 5_000 });
    assert.deepEqual(parseAgentAction('wait', { seconds: 60 }), { type: 'wait', seconds: 10 });
    assert.deepEqual(parseAgentAction('scroll', { direction: ' Down ' }), { type: 'scroll', direction: 'down' });
    assert.throws(() => parseAgentAction('scroll', { direction: 'sideways' }), /direction must be one of/);
    assert.equal(describeAction({ type: 'scroll', direction: 'down' }), 'scroll down');
    assert.deepEqual(toolCallForAction({ type: 'scroll', direction: 'left' }, 'r'), { name: 'scroll', input: { reasoning: 'r', direction: 'left' } });
    assert.deepEqual(parseAgentAction('done', {}), { type: 'done', summary: 'Goal complete.' });
    assert.throws(() => parseAgentAction('tap', { x: 'abc', y: 1 }), /x must be a number/);
    assert.throws(() => parseAgentAction('type_text', { text: '' }), /text must be a non-empty string/);
    assert.throws(() => parseAgentAction('teleport', {}), /Unknown tool/);
    assert.equal(describeAction({ type: 'tap', x: 5, y: 6, target: 'Like' }), 'tap (5, 6) — Like');
});

test('normalizeCoordinates rescales targets given in screenshot pixels back to points', () => {
    const screen = { width: 390, height: 844 };
    const image = { width: 585, height: 1266 };
    assert.deepEqual(normalizeCoordinates({ type: 'tap', x: 362, y: 1175 }, screen, image), {
        action: { type: 'tap', x: 241, y: 783 }, rescaled: true,
    });
    assert.deepEqual(normalizeCoordinates({ type: 'tap', x: 195, y: 805 }, screen, image), {
        action: { type: 'tap', x: 195, y: 805 }, rescaled: false,
    });
    assert.equal(normalizeCoordinates({ type: 'tap', x: 9_999, y: 5 }, screen, image).rescaled, false, 'garbage stays garbage');
    assert.deepEqual(normalizeCoordinates(
        { type: 'swipe', startX: 292, startY: 1000, endX: 292, endY: 400, durationMs: 350 }, screen, image,
    ).action, { type: 'swipe', startX: 195, startY: 667, endX: 195, endY: 267, durationMs: 350 });
    assert.equal(normalizeCoordinates({ type: 'press_home' }, screen, image).rescaled, false);
});

test('annotateScreenshot scales to 1.5× points and draws the grid', async () => {
    const png = await sharp({ create: { width: 780, height: 1688, channels: 3, background: '#202020' } }).png().toBuffer();
    const { image, size } = await annotateScreenshot(png, { width: 390, height: 844 });
    assert.deepEqual(size, { width: 585, height: 1266 });
    const meta = await sharp(image).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 585);
    assert.equal(meta.height, 1266);
});

test('AnthropicVisionModel sends a tool-use request and parses the action', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const model = new AnthropicVisionModel({
        apiKey: 'test-key',
        model: 'claude-haiku-4-5',
        fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
            captured = { url: String(url), init: init ?? {} };
            return new Response(JSON.stringify({
                content: [
                    { type: 'tool_use', id: 't1', name: 'tap', input: { reasoning: 'The + button is at the bottom centre.', x: 195, y: 805, target: 'Create' } },
                ],
                usage: { input_tokens: 1200, output_tokens: 40 },
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as typeof fetch,
    });
    const decision = await model.decide({
        goal: 'Post a story', stepIndex: 0, maxSteps: 10, screen: { width: 390, height: 844 },
        screenshot: Buffer.from('jpeg'), hierarchy: 'Button "Create" @(195,805) 60x50', hierarchyTruncated: false,
        history: [], locked: false,
    });
    assert.deepEqual(decision.action, { type: 'tap', x: 195, y: 805, target: 'Create' });
    assert.equal(decision.reasoning, 'The + button is at the bottom centre.');
    assert.deepEqual(decision.usage, { inputTokens: 1200, outputTokens: 40 });
    assert.ok(captured);
    const request = captured as { url: string; init: RequestInit };
    assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
    const headers = request.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'test-key');
    const body = JSON.parse(String(request.init.body)) as { model: string; tools: Array<{ name: string }>; tool_choice: { type: string }; messages: Array<{ content: Array<{ type: string }> }> };
    assert.equal(body.model, 'claude-haiku-4-5');
    assert.equal(body.tool_choice.type, 'any');
    assert.ok(body.tools.some((tool) => tool.name === 'done'));
    assert.deepEqual(body.messages[0]?.content.map((block) => block.type), ['text', 'text', 'image']);
});

test('buildMessages replays earlier turns as tool_use / tool_result pairs with one image', () => {
    const messages = buildMessages({
        goal: 'Open Settings, then go home', stepIndex: 2, maxSteps: 6, screen: { width: 390, height: 844 },
        screenshot: Buffer.from('img'), hierarchy: 'Foreground app: Home screen (SpringBoard)', hierarchyTruncated: false, locked: false,
        history: [
            { app: 'Settings (com.apple.Preferences)', elementCount: 41, reasoning: 'Settings is open.', action: { type: 'press_home' }, outcome: 'Executed.' },
            { app: 'Home screen (SpringBoard)', elementCount: 60, reasoning: 'Try a tap.', action: { type: 'tap', x: 1, y: 1 }, outcome: 'FAILED: nope' },
        ],
    });
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant', 'user']);
    assert.match(String(messages[0]?.content[0]?.text), /^GOAL: Open Settings/);
    assert.deepEqual(messages[1]?.content[0], {
        type: 'tool_use', id: 'toolu_turn_1', name: 'press_home', input: { reasoning: 'Settings is open.' },
    });
    assert.deepEqual(messages[2]?.content[0], { type: 'tool_result', tool_use_id: 'toolu_turn_1', content: 'Executed.' });
    assert.deepEqual(messages[3]?.content[0], {
        type: 'tool_use', id: 'toolu_turn_2', name: 'tap', input: { reasoning: 'Try a tap.', x: 1, y: 1 },
    });
    assert.deepEqual(messages[4]?.content[0], { type: 'tool_result', tool_use_id: 'toolu_turn_2', content: 'FAILED: nope' });
    const images = messages.flatMap((message) => message.content).filter((block) => block.type === 'image');
    assert.equal(images.length, 1, 'only the current screenshot is sent');
    assert.match(String(messages[4]?.content[1]?.text), /TURN 3 of at most 6/);
});

test('describeForegroundApp names the home screen and falls back to the tree', () => {
    assert.equal(describeForegroundApp({ bundleId: 'com.apple.springboard', name: 'SpringBoard' }, null), 'Home screen (SpringBoard)');
    assert.equal(describeForegroundApp({ bundleId: 'com.apple.Preferences', name: 'Settings' }, null), 'Settings (com.apple.Preferences)');
    assert.equal(describeForegroundApp({ bundleId: 'com.burbn.instagram', name: '' }, 'Instagram'), 'Instagram (com.burbn.instagram)');
    assert.equal(describeForegroundApp(null, 'Instagram'), 'Instagram');
    assert.equal(describeForegroundApp(null, null), null);
});

test('AnthropicVisionModel surfaces API errors', async () => {
    const model = new AnthropicVisionModel({
        apiKey: 'k',
        fetchImpl: (async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })) as typeof fetch,
    });
    await assert.rejects(model.decide({
        goal: 'x', stepIndex: 0, maxSteps: 1, screen: { width: 1, height: 1 }, screenshot: Buffer.alloc(0),
        hierarchy: '', hierarchyTruncated: false, history: [], locked: false,
    }), /Model returned 401: invalid x-api-key/);
});

test('scroll becomes a screen-sized flick and app playbooks reach the model', async () => {
    // "down" = see what is below, so the finger travels from low to high.
    assert.deepEqual(scrollGesture('down', { width: 390, height: 844 }), { startX: 195, startY: 608, endX: 195, endY: 236 });
    assert.deepEqual(scrollGesture('up', { width: 390, height: 844 }), { startX: 195, startY: 236, endX: 195, endY: 608 });
    assert.deepEqual(scrollGesture('left', { width: 390, height: 844 }), { startX: 332, startY: 422, endX: 59, endY: 422 });

    assert.equal(bundleIdFromLabel('Instagram (com.burbn.instagram)'), 'com.burbn.instagram');
    assert.equal(bundleIdFromLabel('Home screen (SpringBoard)'), 'com.apple.springboard');
    assert.match(appHintsFor('Home screen (SpringBoard)') ?? '', /call open_app/);
    assert.equal(bundleIdFromLabel(null), null);
    const instagram = appHintsFor('Instagram (com.burbn.instagram)') ?? '';
    assert.match(instagram, /ONE video is on screen at a time/);
    assert.match(instagram, /scroll with direction "down"/);
    assert.match(instagram, /toggles/);
    assert.equal(appHintsFor('Calculator (com.apple.calculator)'), null);

    const request: VlmStepRequest = {
        goal: 'like 5 reels', stepIndex: 0, maxSteps: 5, screen: { width: 390, height: 844 }, screenshot: Buffer.from('x'),
        hierarchy: 'Button "ufi-like-button" @(360,375) 40x40', hierarchyTruncated: false, history: [], locked: false,
        appHints: instagram,
    };
    const cloud = buildMessages(request);
    const cloudText = cloud.at(-1)!.content.filter((block) => block.type === 'text').map((block) => (block as { text: string }).text).join('\n');
    assert.match(cloudText, /APP HINTS:\n- Instagram: the bottom tab bar/);
    const local = buildLocalMessages(request);
    assert.match(local.at(-1)!.content, /APP HINTS \(follow these\):\n- Instagram/);
    // A step with no hints stays free of the section.
    assert.doesNotMatch(buildLocalMessages({ ...request, appHints: null }).at(-1)!.content, /APP HINTS/);

    // The tally is ground truth the model cannot lose count of.
    assert.equal(actionTally([]), 'ACTIONS SO FAR: none executed — nothing has happened yet.');
    const history: PriorTurn[] = [
        { app: 'Instagram', elementCount: 1, reasoning: '', action: { type: 'scroll', direction: 'down' }, outcome: 'Executed.' },
        { app: 'Instagram', elementCount: 1, reasoning: '', action: { type: 'tap', x: 360, y: 375, target: 'Like' }, outcome: 'Executed.' },
        { app: 'Instagram', elementCount: 1, reasoning: '', action: { type: 'tap', x: 360, y: 375, target: 'Like' }, outcome: 'FAILED: Blocked: repeat tap' },
        { app: 'Instagram', elementCount: 1, reasoning: '', action: { type: 'scroll', direction: 'down' }, outcome: 'Executed.' },
    ];
    assert.equal(actionTally(history), 'ACTIONS SO FAR: scroll down ×2, tap (Like) ×1 (1 attempted action was blocked or failed and did nothing). Last executed action: scroll down.');
    assert.equal(actionTally(history.slice(0, 3)), 'ACTIONS SO FAR: scroll down ×1, tap (Like) ×1 (1 attempted action was blocked or failed and did nothing). Last executed action: tap (Like).');
    assert.match(buildLocalMessages({ ...request, history }).at(-1)!.content, /ACTIONS SO FAR: scroll down ×2/);
});

test('AgentDevice performs scroll as a swipe sized to the screen', async () => {
    const log: string[] = [];
    const remote = fakeRemote(log);
    const device = new AgentDevice(remote, 'udid-scroll');
    await device.perform({ type: 'scroll', direction: 'down' });
    const performed = log.filter((entry) => entry.startsWith('perform:')).map((entry) => JSON.parse(entry.slice('perform:'.length)) as RemoteAction);
    assert.deepEqual(performed, [{ type: 'swipe', startX: 195, startY: 608, endX: 195, endY: 236, durationMs: 280 }]);
});

test('OllamaVisionModel asks for structured JSON and maps it onto an action', async () => {
    let captured: { url: string; body: Record<string, unknown> } | null = null;
    const model = new OllamaVisionModel({
        model: 'qwen3-vl:8b',
        baseUrl: 'http://ollama.test/',
        fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
            captured = { url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> };
            return new Response(JSON.stringify({
                message: { role: 'assistant', content: '{"reasoning":"The Create button is at the bottom.","tool":"tap","x":195,"y":805,"target":"Create"}' },
                prompt_eval_count: 2100,
                eval_count: 40,
            }), { status: 200 });
        }) as typeof fetch,
    });
    const decision = await model.decide({
        goal: 'Post a story',
        stepIndex: 1,
        maxSteps: 10,
        screen: { width: 390, height: 844 },
        screenshot: Buffer.from('jpeg'),
        hierarchy: 'Button "Create" @(195,805) 60x50',
        hierarchyTruncated: false,
        history: [{ app: 'Instagram', elementCount: 12, reasoning: 'Open it first.', action: { type: 'open_app', bundleId: 'com.burbn.instagram' }, outcome: 'Executed.' }],
        locked: false,
    });
    assert.deepEqual(decision.action, { type: 'tap', x: 195, y: 805, target: 'Create' });
    assert.equal(decision.reasoning, 'The Create button is at the bottom.');
    assert.deepEqual(decision.usage, { inputTokens: 2100, outputTokens: 40 });

    const sent = captured as { url: string; body: Record<string, unknown> } | null;
    assert.ok(sent, 'a request was sent');
    assert.equal(sent.url, 'http://ollama.test/api/chat');
    assert.equal(sent.body.model, 'qwen3-vl:8b');
    assert.equal(sent.body.stream, false);
    assert.equal(sent.body.think, false, 'hidden chain-of-thought is disabled so the reply is the JSON action');
    assert.equal((sent.body.format as { type: string }).type, 'object', 'structured output schema is enforced');
    const messages = sent.body.messages as Array<{ role: string; content: string; images?: string[] }>;
    assert.deepEqual(messages.map((message) => message.role), ['system', 'user', 'assistant', 'user']);
    assert.match(messages[0]!.content, /OUTPUT FORMAT: respond with exactly one JSON object/);
    assert.match(messages[1]!.content, /GOAL: Post a story/);
    assert.deepEqual(JSON.parse(messages[2]!.content), { reasoning: 'Open it first.', tool: 'open_app', bundle_id: 'com.burbn.instagram' });
    assert.match(messages[3]!.content, /RESULT OF TURN 1: Executed\./);
    assert.match(messages[3]!.content, /TURN 2 of at most 10/);
    assert.equal(messages[3]!.images?.length, 1, 'only the current screenshot is attached');
    assert.equal(messages[1]!.images, undefined);
});

test('OllamaVisionModel tolerates fenced JSON, rejects bad tools, and explains a missing server', async () => {
    assert.deepEqual(extractJsonObject('```json\n{"reasoning":"r","tool":"press_home"}\n```'), { reasoning: 'r', tool: 'press_home' });
    assert.deepEqual(extractJsonObject('Sure! {"reasoning":"r","tool":"wait","seconds":2} done'), { reasoning: 'r', tool: 'wait', seconds: 2 });
    assert.throws(() => extractJsonObject('no json here'), /not JSON/);

    assert.deepEqual(decisionFromJson({ reasoning: 'r', tool: 'swipe', start_x: 195, start_y: 700, end_x: 195, end_y: 300, text: '' }).action, {
        type: 'swipe', startX: 195, startY: 700, endX: 195, endY: 300, durationMs: 350,
    });
    assert.throws(() => decisionFromJson({ reasoning: 'r', tool: 'teleport' }), /unknown tool "teleport"/);
    assert.throws(() => decisionFromJson({ reasoning: 'r', tool: 'tap', x: 'left' }), /invalid tap/);

    const down = new OllamaVisionModel({ fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    const request = {
        goal: 'x', stepIndex: 0, maxSteps: 1, screen: { width: 390, height: 844 }, screenshot: Buffer.alloc(0),
        hierarchy: '', hierarchyTruncated: false, history: [], locked: false,
    };
    await assert.rejects(down.decide(request), /Ollama is not reachable/);

    const thoughtOnly = new OllamaVisionModel({
        fetchImpl: (async () => new Response(JSON.stringify({ message: { role: 'assistant', content: '', thinking: 'Let me look at the screen…' } }))) as typeof fetch,
    });
    await assert.rejects(thoughtOnly.decide(request), /spent its whole reply thinking/);
    assert.deepEqual(await down.health(), { reachable: false, version: null, models: [], hasModel: false, error: 'fetch failed' });

    const missing = new OllamaVisionModel({
        model: 'qwen3-vl:8b',
        fetchImpl: (async (url: string | URL | Request) => {
            if (String(url).endsWith('/api/version')) return new Response(JSON.stringify({ version: '0.12.0' }));
            if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }));
            return new Response(JSON.stringify({ error: 'model "qwen3-vl:8b" not found, try pulling it first' }), { status: 404 });
        }) as typeof fetch,
    });
    await assert.rejects(missing.decide(request), /ollama pull qwen3-vl:8b/);
    assert.deepEqual(await missing.health(), { reachable: true, version: '0.12.0', models: ['llama3.2:latest'], hasModel: false, error: null });

    // Local runs are free regardless of token counts.
    const messages = buildLocalMessages(request);
    assert.equal(messages.at(-1)?.images?.length, 1);
});

test('the runner refuses a repeat tap on the spot it just tapped and tells the model why', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const okStep = { index: 0, startedAt: '', durationMs: 0, screen: { width: 390, height: 844 }, screenshot: '', elementCount: 1, app: null, locked: false, reasoning: '', actionLabel: '', result: 'ok' as const, usage: { inputTokens: 0, outputTokens: 0 } };
    const previous: AgentStep = { ...okStep, action: { type: 'tap', x: 360, y: 374, target: 'Like' } };
    const blocked: AgentStep = { ...previous, result: 'error', error: 'Blocked' };
    assert.match(repeatedTapGuard({ type: 'tap', x: 362, y: 371 }, [previous]) ?? '', /already tapped Like/);
    assert.equal(repeatedTapGuard({ type: 'tap', x: 360, y: 500 }, [previous]), null, 'a different spot is fine');
    assert.equal(repeatedTapGuard({ type: 'tap', x: 360, y: 374 }, [{ ...previous, action: { type: 'scroll', direction: 'down' } }]), null, 'only tap-after-tap is a flap');
    assert.equal(repeatedTapGuard({ type: 'tap', x: 360, y: 374 }, [{ ...previous, result: 'error' }]), null, 'a failed tap may be retried');
    assert.match(repeatedTapGuard({ type: 'tap', x: 360, y: 374 }, [previous, blocked]) ?? '', /Blocked/, 'a blocked turn in between does not reset the guard');
    assert.equal(repeatedTapGuard({ type: 'tap', x: 360, y: 374 }, [previous, { ...okStep, action: { type: 'wait', seconds: 1 } }]), null, 'wait is the escape hatch');
    assert.equal(repeatedTapGuard({ type: 'tap', x: 360, y: 374 }, []), null);

    const log: string[] = [];
    const usage = { inputTokens: 1, outputTokens: 1 };
    const model = scriptedModel([
        () => ({ action: { type: 'tap', x: 360, y: 374, target: 'Like' }, reasoning: 'like', usage }),
        () => ({ action: { type: 'tap', x: 360, y: 374, target: 'Like' }, reasoning: 'like again', usage }),
        (request) => {
            assert.match(request.history[1]?.outcome ?? '', /FAILED: Blocked: your last executed action already tapped Like/);
            return { action: { type: 'tap', x: 360, y: 374, target: 'Like' }, reasoning: 'stubborn', usage };
        },
        (request) => {
            assert.equal(request.history.filter((turn) => /^FAILED/.test(turn.outcome)).length, 2, 'both repeat taps were blocked');
            return { action: { type: 'scroll', direction: 'down' }, reasoning: 'move on', usage };
        },
        () => ({ action: { type: 'done', summary: 'ok' }, reasoning: '', usage }),
    ]);
    const runner = new AgentRunner({ remote: fakeRemote(log), model, dataDir, settleMs: 0 });
    const run = await runner.start({ deviceUdid: 'udid-flap', goal: 'like one reel', maxSteps: 8 });
    const finished = await finishedRun(runner, run.id);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.steps[1]?.result, 'error');
    assert.equal(finished.steps[2]?.result, 'error');
    assert.match(finished.steps[1]?.error ?? '', /Blocked/);
    const taps = log.filter((entry) => entry.startsWith('perform:') && entry.includes('"tap"'));
    assert.equal(taps.length, 1, 'the second tap never reached the phone');
    assert.ok(finished.log.some((line) => /Blocked ✕/.test(line)));
});

test('local AgentRunner reports zero cost and blocks a phone the cloud runner is using', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const usage = { inputTokens: 5000, outputTokens: 100 };
    const model = scriptedModel([() => ({ action: { type: 'done', summary: 'ok' }, reasoning: 'done', usage })]);
    const cloud = new AgentRunner({ remote: fakeRemote([]), model: scriptedModel([]), dataDir: path.join(dataDir, 'cloud') });
    const local = new AgentRunner({
        remote: fakeRemote([]), model, flavor: 'local', dataDir: path.join(dataDir, 'local'), settleMs: 0,
        isDeviceBusy: async (udid) => cloud.isActiveOn(udid),
    });
    assert.equal(local.flavor, 'local');
    const run = await local.start({ deviceUdid: 'udid-9', goal: 'Free run', maxSteps: 3 });
    const finished = await finishedRun(local, run.id);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.usage.inputTokens, 5000);
    assert.equal(finished.estimatedCostUsd, 0);
    assert.match(finished.log.at(-1) ?? '', /local · \$0/);
    assert.equal(local.isActiveOn('udid-9'), false);
});

function fakeRemote(log: string[], options: { locked?: boolean } = {}) {
    const pngPromise = sharp({ create: { width: 780, height: 1688, channels: 3, background: '#101010' } }).png().toBuffer();
    let screenshots = 0;
    const remote: AgentRemote = {
        async getScreenInfo() { return { screenSize: { width: 390, height: 844 }, scale: 2 }; },
        async getScreenshot() {
            screenshots += 1;
            // Vary pixels so each observation has a distinct fingerprint.
            return sharp(await pngPromise).modulate({ brightness: 1 + screenshots / 10 }).png().toBuffer();
        },
        async getSource() { return SAMPLE_XML; },
        async performAction(_udid: string, action: RemoteAction) { log.push(`perform:${JSON.stringify(action)}`); },
        async isLocked() { return options.locked ?? false; },
        async unlock() { log.push('unlock'); },
        async typeText(_udid: string, text: string) { log.push(`type:${text}`); },
        async launchApp(_udid: string, bundleId: string) { log.push(`launch:${bundleId}`); },
        async releaseSession() { log.push('release'); },
    };
    return remote;
}

function scriptedModel(script: Array<(request: VlmStepRequest) => VlmDecision>): VisionModel & { requests: VlmStepRequest[] } {
    const requests: VlmStepRequest[] = [];
    return {
        model: 'fake-vlm',
        requests,
        async decide(request) {
            requests.push(request);
            const next = script[requests.length - 1] ?? script.at(-1);
            if (!next) throw new Error('script exhausted');
            return next(request);
        },
    };
}

async function finishedRun(runner: AgentRunner, id: string, timeoutMs = 5_000) {
    const started = Date.now();
    for (;;) {
        const run = await runner.get(id);
        // finishedAt is stamped in the runner's finally block, after the terminal status.
        if (run && run.status !== 'running' && run.finishedAt) return run;
        if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the run to finish');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

test('AgentRunner runs observe → reason → act until the model says done', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const log: string[] = [];
    const usage = { inputTokens: 1000, outputTokens: 50 };
    const model = scriptedModel([
        () => ({ action: { type: 'open_app', bundleId: 'com.burbn.instagram' }, reasoning: 'Instagram is not open yet.', usage }),
        () => ({ action: { type: 'tap', x: 195, y: 805, target: 'Create' }, reasoning: 'Tap the + button.', usage }),
        () => ({ action: { type: 'type_text', text: 'hello' }, reasoning: 'Type the caption.', usage }),
        () => ({ action: { type: 'done', summary: 'Story posted.' }, reasoning: 'The story is live.', usage }),
    ]);
    const runner = new AgentRunner({ remote: fakeRemote(log), model, dataDir, settleMs: 0, deviceName: async () => 'Farm #1' });
    const started = await runner.start({ deviceUdid: 'udid-1', goal: 'Post a story on Instagram', maxSteps: 10 });
    assert.equal(started.status, 'running');
    assert.equal(started.deviceName, 'Farm #1');

    const finished = await finishedRun(runner, started.id);
    assert.equal(finished.status, 'succeeded');
    assert.equal(finished.summary, 'Story posted.');
    assert.equal(finished.steps.length, 4);
    assert.deepEqual(finished.steps.map((step) => step.actionLabel), [
        'open com.burbn.instagram', 'tap (195, 805) — Create', 'type "hello"', 'done — Story posted.',
    ]);
    assert.ok(finished.steps.every((step) => step.result === 'ok'));
    assert.deepEqual(log.filter((entry) => entry !== 'release'), [
        'launch:com.burbn.instagram',
        'perform:{"type":"tap","x":195,"y":805}',
        'type:hello',
    ]);
    assert.ok(log.includes('release'), 'WDA session is released at the end');
    assert.equal(finished.usage.inputTokens, 4000);
    assert.ok(finished.estimatedCostUsd > 0);

    // The run relays a readable log like the static workflows do.
    const relay = finished.log.map((line) => line.replace(/^\d\d:\d\d:\d\d\s+/, ''));
    assert.equal(relay[0], 'Agent run started on Farm #1');
    assert.ok(relay.includes('Step 1/10 · Observe — screenshot + accessibility tree'));
    assert.ok(relay.includes('Step 1/10 · Reason — Instagram is not open yet.'));
    assert.ok(relay.includes('Step 1/10 · Act — open com.burbn.instagram'));
    assert.ok(relay.includes('Step 1/10 · Executed ✓'));
    assert.ok(relay.includes('✓ Goal reached — Story posted.'));
    assert.match(relay.at(-1) ?? '', /^Finished · succeeded · 4 steps/);
    // History listings stay light: the full log only comes with the single-run endpoint.
    assert.deepEqual((await runner.list())[0]?.log, []);

    // The model saw the goal, compact hierarchy, and running history.
    assert.equal(model.requests[0]?.goal, 'Post a story on Instagram');
    assert.match(model.requests[0]?.hierarchy ?? '', /Button "Create & share" @\(195,805\)/);
    assert.deepEqual(model.requests[2]?.history.map((turn) => [turn.app, turn.action.type, turn.outcome]), [
        ['Instagram', 'open_app', 'Executed.'],
        ['Instagram', 'tap', 'Executed.'],
    ]);

    const persisted = JSON.parse(await readFile(path.join(dataDir, started.id, 'run.json'), 'utf8')) as { status: string };
    assert.equal(persisted.status, 'succeeded');
    assert.ok(runner.screenshotPath(started.id, 0)?.endsWith('step-01.jpg'));
});

test('AgentRunner records failed actions, unlocks locked phones, and enforces limits', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const log: string[] = [];
    const usage = { inputTokens: 10, outputTokens: 1 };
    const remote = fakeRemote(log, { locked: true });
    remote.performAction = async () => { throw new Error('Touch coordinates are outside the device screen'); };
    const model = scriptedModel([() => ({ action: { type: 'tap', x: 9_999, y: 9_999 }, reasoning: 'Try a tap.', usage })]);
    const runner = new AgentRunner({ remote, model, dataDir, settleMs: 0 });
    const run = await runner.start({ deviceUdid: 'udid-2', goal: 'Do a thing', maxSteps: 2 });
    const finished = await finishedRun(runner, run.id);
    assert.equal(finished.status, 'failed');
    assert.match(finished.error ?? '', /2-step limit/);
    assert.equal(finished.steps.length, 2);
    assert.equal(finished.steps[0]?.result, 'error');
    assert.match(finished.steps[0]?.error ?? '', /outside the device screen/);
    assert.equal(log[0], 'unlock');
    assert.match(finished.notes[0] ?? '', /unlocked with the stored passcode/);
    assert.match(model.requests[1]?.history[0]?.outcome ?? '', /FAILED: Touch coordinates/);
});

test('AgentRunner refuses to start without a model or on a busy phone', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const unconfigured = new AgentRunner({ remote: fakeRemote([]), model: null, dataDir });
    assert.equal(unconfigured.configured, false);
    await assert.rejects(unconfigured.start({ deviceUdid: 'u', goal: 'x' }), /ANTHROPIC_API_KEY/);

    const model = scriptedModel([() => ({ action: { type: 'wait', seconds: 0.5 }, reasoning: '', usage: { inputTokens: 1, outputTokens: 1 } })]);
    const busy = new AgentRunner({ remote: fakeRemote([]), model, dataDir, isDeviceBusy: async () => true });
    await assert.rejects(busy.start({ deviceUdid: 'u', goal: 'x' }), /scheduled automation/);
    await assert.rejects(busy.start({ deviceUdid: 'u', goal: '   ' }), /Describe the goal/);
});

test('AgentRunner stop ends the loop before the next action', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const log: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const model: VisionModel = {
        model: 'fake',
        async decide() {
            await gate;
            return { action: { type: 'tap', x: 1, y: 1 }, reasoning: 'tap', usage: { inputTokens: 1, outputTokens: 1 } };
        },
    };
    const runner = new AgentRunner({ remote: fakeRemote(log), model, dataDir, settleMs: 0 });
    const run = await runner.start({ deviceUdid: 'udid-3', goal: 'Loop forever', maxSteps: 50 });
    await runner.stop(run.id);
    release();
    const finished = await finishedRun(runner, run.id);
    assert.equal(finished.status, 'stopped');
    assert.ok(!log.some((entry) => entry.startsWith('perform:')), 'the pending tap was not executed');
    // A new run on the same phone is allowed once the previous one finished.
    const again = await runner.start({ deviceUdid: 'udid-3', goal: 'Again', maxSteps: 1 });
    assert.equal(again.status, 'running');
});

test('agent page and API are wired into the app', async (context) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'agent-run-'));
    context.after(() => rm(dataDir, { recursive: true, force: true }));
    const runner = new AgentRunner({ remote: fakeRemote([]), model: null, dataDir });
    const localModel = new OllamaVisionModel({ model: 'qwen3-vl:8b', fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch });
    const localRunner = new AgentRunner({ remote: fakeRemote([]), model: localModel, flavor: 'local', dataDir: path.join(dataDir, 'local') });
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        dashboardTheme: defaultDashboardTheme,
        agentRunner: runner,
        localAgentRunner: localRunner,
    });
    context.after(() => app.close());

    const page = await inject(app, { method: 'GET', url: '/agent' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Agent <em>\(Cloud\)<\/em>/);
    assert.match(page.body, /data-agent-api="\/api\/agent"/);
    assert.match(page.body, /\/assets\/agent\.js\?v=[\w-]+/);
    assert.doesNotMatch(page.body, /__FOOTER__/);

    const localPage = await inject(app, { method: 'GET', url: '/agent-local' });
    assert.equal(localPage.statusCode, 200);
    assert.match(localPage.body, /Agent <em>\(Local\)<\/em>/);
    assert.match(localPage.body, /data-agent-api="\/api\/agent-local"/);
    assert.match(localPage.body, /data-agent-flavor="local"/);

    const home = await inject(app, { method: 'GET', url: '/results' });
    assert.match(home.body, /href="\/agent"/, 'nav links to the cloud agent page');
    assert.match(home.body, /href="\/agent-local"/, 'nav links to the local agent page');

    const script = await inject(app, { method: 'GET', url: '/assets/agent.js' });
    assert.equal(script.statusCode, 200);

    const status = await inject(app, { method: 'GET', url: '/api/agent/status' });
    assert.deepEqual(status.json(), { configured: false, model: null, flavor: 'cloud', defaultMaxSteps: runner.defaultMaxSteps });

    // The local status reports the runtime's health so the page can explain what to install.
    const localStatus = await inject(app, { method: 'GET', url: '/api/agent-local/status' });
    const localBody = localStatus.json<{ configured: boolean; model: string; flavor: string; ollama: { reachable: boolean; hasModel: boolean } }>();
    assert.equal(localBody.configured, true);
    assert.equal(localBody.model, 'qwen3-vl:8b');
    assert.equal(localBody.flavor, 'local');
    assert.equal(localBody.ollama.reachable, false);
    assert.equal(localBody.ollama.hasModel, false);
    const localList = await inject(app, { method: 'GET', url: '/api/agent-local/runs' });
    assert.deepEqual(localList.json(), { runs: [] });

    const start = await inject(app, { method: 'POST', url: '/api/agent/runs', payload: { deviceUdid: 'x', goal: 'y' } });
    assert.equal(start.statusCode, 409);
    assert.match(start.json<{ error: string }>().error, /ANTHROPIC_API_KEY/);

    const list = await inject(app, { method: 'GET', url: '/api/agent/runs' });
    assert.deepEqual(list.json(), { runs: [] });

    const missing = await inject(app, { method: 'GET', url: '/api/agent/runs/00000000-0000-0000-0000-000000000000' });
    assert.equal(missing.statusCode, 404);
    const shot = await inject(app, { method: 'GET', url: '/api/agent/runs/00000000-0000-0000-0000-000000000000/steps/0/screenshot' });
    assert.equal(shot.statusCode, 404);
});
