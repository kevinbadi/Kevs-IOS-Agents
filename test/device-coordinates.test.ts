import { inject } from './support.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PluginRegistry } from '../src/registry.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

const configPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'pf-coords-')), 'devices.json');
process.env.DEVICES_CONFIG_PATH = configPath;
const seed = () => writeFile(configPath, JSON.stringify([
    { name: 'Phone', udid: 'u1', coordinateProfile: 'iphone8', pluginData: {} },
]));
    const onDisk = async () => JSON.parse(await readFile(configPath, 'utf8')) as Array<{
        coordinates?: Record<string, unknown>;
        linkedinCoordinates?: Record<string, unknown>;
    }>;

const scheduler = { async activeExecution() { return null; }, async listSchedules() { return []; } } as unknown as SchedulerRepository;

test('calibrate: GET reports points, PATCH stores and clears overrides', async (context) => {
    await seed();
    const { createApp } = await import('../src/api/app.js');
    const app = await createApp({ plugins: new PluginRegistry([]), scheduler });
    context.after(() => app.close());

    const list = await inject(app, { method: 'GET', url: '/api/devices/u1/coordinates' });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().screenSize.width, 375);
    const like = list.json().points.find((p: { name: string }) => p.name === 'like');
    assert.equal(like.overridden, false);
    assert.deepEqual(like.current, like.default);

    const linkedin = await inject(app, { method: 'GET', url: '/api/devices/u1/coordinates?app=linkedin' });
    assert.equal(linkedin.statusCode, 200);
    assert.equal(linkedin.json().app, 'linkedin');
    assert.equal(linkedin.json().workflow, 'all');
    const connect = linkedin.json().points.find((p: { name: string }) => p.name === 'connect');
    assert.ok(connect, 'LinkedIn connect point is listed');
    assert.match(connect.label, /LinkedIn/);
    assert.equal(connect.overridden, false);

    const cold = await inject(app, { method: 'GET', url: '/api/devices/u1/coordinates?app=linkedin&workflow=cold-connect' });
    assert.equal(cold.statusCode, 200);
    assert.equal(cold.json().workflow, 'cold-connect');
    assert.deepEqual(cold.json().points.map((p: { name: string }) => p.name), [
        'homeTab', 'searchField', 'searchPeopleFilter', 'searchFirstResult',
        'profileMenu', 'connect', 'addANote', 'noteComposer', 'sendInvitation',
    ]);
    assert.match(cold.json().points[1].label, /Search bar/);

    const plain = await inject(app, { method: 'GET', url: '/api/devices/u1/coordinates?app=linkedin&workflow=connect' });
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.json().workflow, 'connect');
    assert.deepEqual(plain.json().points.map((p: { name: string }) => p.name), [
        'homeTab', 'searchField', 'searchPeopleFilter', 'searchFirstResult',
        'profileMenu', 'connect', 'sendWithoutNote',
    ]);
    assert.match(plain.json().points[6].label, /without note/i);

    const badWorkflow = await inject(app, { method: 'GET', url: '/api/devices/u1/coordinates?app=linkedin&workflow=pymk' });
    assert.equal(badWorkflow.statusCode, 400);

    const set = await inject(app, {
        method: 'PATCH', url: '/api/devices/u1',
        payload: { coordinates: { like: { x: 350, y: 320 } } }, headers: { 'content-type': 'application/json' },
    });
    assert.equal(set.statusCode, 200);
    assert.deepEqual((await onDisk())[0]!.coordinates, { like: { x: 350, y: 320 } });

    const after = await inject(app, { method: 'GET', url: '/api/devices/u1/coordinates' });
    const like2 = after.json().points.find((p: { name: string }) => p.name === 'like');
    assert.equal(like2.overridden, true);
    assert.deepEqual(like2.current, { x: 350, y: 320 });

    const bad = await inject(app, {
        method: 'PATCH', url: '/api/devices/u1',
        payload: { coordinates: { like: { x: 1, y: 9999 } } }, headers: { 'content-type': 'application/json' },
    });
    assert.equal(bad.statusCode, 400);

    const linkedinPatch = await inject(app, {
        method: 'PATCH', url: '/api/devices/u1',
        payload: { linkedinCoordinates: { connect: { x: 80, y: 300 } } },
        headers: { 'content-type': 'application/json' },
    });
    assert.equal(linkedinPatch.statusCode, 200);
    assert.deepEqual((await onDisk())[0]!.linkedinCoordinates, { connect: { x: 80, y: 300 } });

    const clear = await inject(app, {
        method: 'PATCH', url: '/api/devices/u1',
        payload: { coordinates: {} }, headers: { 'content-type': 'application/json' },
    });
    assert.equal(clear.statusCode, 200);
    assert.equal((await onDisk())[0]!.coordinates, undefined);
});
