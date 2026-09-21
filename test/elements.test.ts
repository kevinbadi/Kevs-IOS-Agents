import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_MAX_ELEMENTS, compactElements, elementCentre, estimateTokens, indexElements, indexElementsReport, serializeElements,
} from '../src/devices/elements.js';
import { WdaRemoteControl } from '../src/devices/wda-remote.js';

const SCREEN = { width: 390, height: 844 };

function node(type: string, attrs: Record<string, string | number>): string {
    const rendered = Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(' ');
    return `<XCUIElementType${type} type="XCUIElementType${type}" ${rendered}/>`;
}

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="Instagram" label="Instagram" enabled="true" visible="true" x="0" y="0" width="390" height="844">
  <XCUIElementTypeWindow enabled="true" visible="true" x="0" y="0" width="390" height="844">
    ${node('Other', { enabled: 'true', visible: 'true', x: 0, y: 0, width: 390, height: 844 })}
    ${node('StatusBar', { enabled: 'true', visible: 'true', x: 0, y: 0, width: 390, height: 54 })}
    ${node('StaticText', { label: '9:41', enabled: 'true', visible: 'true', x: 20, y: 14, width: 40, height: 20 })}
    ${node('Button', { label: 'Like', enabled: 'true', visible: 'true', x: 340, y: 360, width: 40, height: 40 })}
    ${node('StaticText', { label: 'Like', enabled: 'true', visible: 'true', x: 342, y: 362, width: 36, height: 36 })}
    ${node('Button', { label: 'Hidden', enabled: 'true', visible: 'false', x: 10, y: 400, width: 40, height: 40 })}
    ${node('Button', { label: 'Unhittable', enabled: 'true', visible: 'true', hittable: 'false', x: 10, y: 450, width: 40, height: 40 })}
    ${node('Button', { label: 'Disabled', enabled: 'false', visible: 'true', x: 10, y: 500, width: 40, height: 40 })}
    ${node('Button', { label: 'Zero', enabled: 'true', visible: 'true', x: 10, y: 550, width: 0, height: 40 })}
    ${node('Button', { label: 'Offscreen', enabled: 'true', visible: 'true', x: 400, y: 600, width: 40, height: 40 })}
    ${node('Other', { enabled: 'true', visible: 'true', x: 0, y: 700, width: 390, height: 60 })}
    ${node('Other', { label: 'Labelled group', enabled: 'true', visible: 'true', x: 0, y: 640, width: 390, height: 30 })}
    ${node('TextField', { value: 'hello &amp; welcome', enabled: 'true', visible: 'true', x: 20, y: 120, width: 300, height: 40 })}
    ${node('Button', { label: 'Home', enabled: 'true', visible: 'true', x: 10, y: 790, width: 60, height: 50 })}
    ${node('Button', { label: 'Profile', enabled: 'true', visible: 'true', x: 320, y: 790, width: 60, height: 50 })}
  </XCUIElementTypeWindow>
</XCUIElementTypeApplication>`;

test('indexElements keeps visible hittable meaningful elements and drops the rest', () => {
    const report = indexElementsReport(FIXTURE, { screen: SCREEN });
    const labels = report.elements.map((element) => element.label ?? element.value);
    assert.deepEqual(labels, ['hello & welcome', 'Like', 'Labelled group', 'Home', 'Profile'], 'reading order, pruned');
    for (const gone of ['9:41', 'Hidden', 'Unhittable', 'Disabled', 'Zero', 'Offscreen']) {
        assert.ok(!labels.includes(gone), `${gone} should be pruned`);
    }
    assert.equal(report.elements.filter((element) => element.label === 'Like').length, 1, 'button wins over its own static text');
    assert.equal(report.elements.find((element) => element.label === 'Like')?.role, 'Button');
    assert.deepEqual(report.elements.map((element) => element.index), [0, 1, 2, 3, 4], 'indices are dense and ordered');
    assert.ok(report.total > report.candidates && report.candidates >= report.elements.length);
    assert.equal(report.tokenEstimate, estimateTokens(serializeElements(report.elements)));
});

test('indexElements caps at 120, keeping the elements nearest the screen centre', () => {
    const buttons: string[] = [];
    // 200 buttons on a grid; the centre-most 120 must survive.
    for (let row = 0; row < 20; row += 1) {
        for (let column = 0; column < 10; column += 1) {
            buttons.push(node('Button', { label: `b${row}-${column}`, enabled: 'true', visible: 'true', x: column * 39, y: 60 + row * 39, width: 30, height: 30 }));
        }
    }
    const xml = `<XCUIElementTypeApplication visible="true" x="0" y="0" width="390" height="844">${buttons.join('')}</XCUIElementTypeApplication>`;
    const elements = indexElements(xml, { screen: SCREEN });
    assert.equal(elements.length, DEFAULT_MAX_ELEMENTS);
    const centre = elements.find((element) => element.label === 'b10-5');
    const corner = elements.find((element) => element.label === 'b0-0');
    assert.ok(centre, 'centre-most element survives');
    assert.equal(corner, undefined, 'corner element is pruned first');
    for (let i = 1; i < elements.length; i += 1) {
        const previous = elements[i - 1]!;
        const current = elements[i]!;
        assert.ok(previous.rect.y < current.rect.y || (previous.rect.y === current.rect.y && previous.rect.x <= current.rect.x), 'reading order');
    }
    const tokens = estimateTokens(serializeElements(elements));
    assert.ok(tokens < 4_000, `serialised list should stay under ~4000 tokens, got ${tokens}`);
    assert.equal(indexElements(xml, { screen: SCREEN, max: 7 }).length, 7);
});

test('compactElements and elementCentre are the only bridge from index to geometry', () => {
    const [field] = indexElements(FIXTURE, { screen: SCREEN });
    assert.ok(field);
    assert.deepEqual(compactElements([field])[0], { i: 0, role: 'TextField', value: 'hello & welcome', rect: [20, 120, 300, 40] });
    assert.deepEqual(elementCentre(field), { x: 170, y: 140 });
    assert.ok(!('label' in compactElements([field])[0]!), 'absent label is omitted, not null');
});

test('WdaRemoteControl.getIndexedElements builds the list from /source with the cached screen size', async () => {
    const calls: string[] = [];
    const remote = new WdaRemoteControl({
        deviceUdid: 'udid-1',
        wdaUrl: 'http://wda.test',
        fetchImpl: (async (input: string | URL | Request) => {
            const url = String(input);
            calls.push(url);
            if (url.endsWith('/wda/screen')) return new Response(JSON.stringify({ value: { screenSize: SCREEN, scale: 3 } }));
            if (url.includes('/source')) return new Response(JSON.stringify({ value: FIXTURE }));
            return new Response('not found', { status: 404 });
        }) as typeof fetch,
    });
    const report = await remote.getIndexedElements('udid-1');
    assert.equal(report.elements.length, 5);
    assert.ok(calls.some((url) => url.endsWith('/source?format=xml')));
    assert.equal(calls.filter((url) => url.endsWith('/wda/screen')).length, 1);
    await remote.getIndexedElements('udid-1');
    assert.equal(calls.filter((url) => url.endsWith('/wda/screen')).length, 1, 'screen size is cached');
    await assert.rejects(remote.getIndexedElements('other'), /not configured for this device/);
});
