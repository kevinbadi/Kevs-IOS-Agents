import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PluginRegistry } from '../src/registry.js';
import { createLinkedInPlugin } from '../src/linkedin-plugin.js';
import { summarizeLinkedInLeadCsvs } from '../src/linkedin/leads.js';

const plugin = createLinkedInPlugin({ connectEntrypoint: '/example/linkedin-connect.js' });

test('LinkedIn connection request validates a CSV run', () => {
    assert.equal(plugin.id, 'com.git-agni.linkedin');
    const registry = new PluginRegistry([plugin]);
    const value = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'connect', taskVersion: 1,
            payload: { mode: 'plain', leadCsv: 'hormozi', leadLimit: 5 },
        },
        timing: { kind: 'now' },
    });
    assert.equal(value.task.payload.mode, 'plain');
    assert.equal(value.task.payload.leadCsv, 'hormozi');
    const task = plugin.tasks.find((entry) => entry.type === 'connect' && entry.version === 1)!;
    assert.equal(task.summarize(value.task.payload as never), 'Connection request · 5 from hormozi');
});

test('LinkedIn cold connect requires a note', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'cold-connect', taskVersion: 1,
            payload: { mode: 'note', leadCsv: 'result', leadLimit: 5, note: '   ' },
        },
        timing: { kind: 'now' },
    }), /Connection note is required/);
    const ok = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'cold-connect', taskVersion: 1,
            payload: { mode: 'note', leadCsv: 'result', leadLimit: 3, note: 'Hi {firstName}' },
        },
        timing: { kind: 'now' },
    });
    assert.equal(ok.task.payload.note, 'Hi {firstName}');
    const task = plugin.tasks.find((entry) => entry.type === 'cold-connect' && entry.version === 1)!;
    assert.equal(task.summarize(ok.task.payload as never), 'Cold connect · 3 from result');
});

test('summarizeLinkedInLeadCsvs counts remaining against shared state', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'li-leads-'));
    const previous = process.env.LINKEDIN_LEADS_DIR;
    process.env.LINKEDIN_LEADS_DIR = directory;
    try {
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'demo.csv'), [
            'profileLink,firstName,lastName,fullName',
            'https://www.linkedin.com/in/jane-doe/,Jane,Doe,Jane Doe',
            'https://www.linkedin.com/in/nicolo-ricci/,Nicolo,Ricci,Nicolo Ricci',
            '',
        ].join('\n'));
        await writeFile(path.join(directory, 'state.json'), JSON.stringify({
            'jane-doe': { status: 'sent', at: '2026-09-15T00:00:00.000Z', fullName: 'Jane Doe' },
        }));
        const lists = await summarizeLinkedInLeadCsvs();
        assert.equal(lists.length, 1);
        assert.equal(lists[0]?.name, 'demo');
        assert.equal(lists[0]?.total, 2);
        assert.equal(lists[0]?.sent, 1);
        assert.equal(lists[0]?.remaining, 1);
    } finally {
        if (previous === undefined) delete process.env.LINKEDIN_LEADS_DIR;
        else process.env.LINKEDIN_LEADS_DIR = previous;
    }
});
