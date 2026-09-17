import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateResults, type ExecutionOutcomeRow } from '../src/results/aggregate.js';
import {
    parseOutcomeLine, workflowLabel, dayKey, emptyTotals, addTotals,
} from '../src/results/metrics.js';
import type { ExecutionRow } from '../src/database/schema.js';

test('parseOutcomeLine reads doomscroll finish stats', () => {
    const parsed = parseOutcomeLine(
        'Finished doomscroll: videosViewed=9 swipes=8 likes=4 saves=2 comments=1 livesSkipped=0 recoveries=1 elapsedMs=120000 reason=completed',
    );
    assert.deepEqual(parsed, { videos: 9, swipes: 8, likes: 4, saves: 2, comments: 1 });
});

test('parseOutcomeLine reads LinkedIn send totals', () => {
    const parsed = parseOutcomeLine('Finished. sent=3/5 skipped=1 failed=1');
    assert.equal(parsed.sent, 3);
    assert.equal(parsed.skipped, 1);
});

test('parseOutcomeLine counts a submitted TikTok post', () => {
    assert.equal(parseOutcomeLine('TikTok post submitted').posts, 1);
});

test('workflowLabel names built-in automations', () => {
    assert.equal(workflowLabel('com.git-agni.tiktok', 'doomscroll-following'), 'TikTok · Engagement');
    assert.equal(workflowLabel('com.git-agni.linkedin', 'connect'), 'LinkedIn · Connection request');
});

function execution(overrides: Partial<ExecutionRow> & Pick<ExecutionRow, 'pluginId' | 'taskType' | 'status'>): ExecutionRow {
    const now = new Date('2026-09-15T20:00:00.000Z');
    return {
        id: '11111111-1111-1111-1111-111111111111',
        scheduleId: null,
        deviceUdid: 'device-1',
        taskVersion: 1,
        payload: {},
        scheduledFor: now,
        deadlineAt: now,
        queueJobId: null,
        startedAt: now,
        finishedAt: now,
        exitCode: 0,
        error: null,
        stopRequestedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

test('aggregateResults buckets likes by workflow and day', () => {
    const rows: ExecutionOutcomeRow[] = [{
        execution: execution({ pluginId: 'com.git-agni.tiktok', taskType: 'doomscroll', status: 'succeeded' }),
        summaryLine: 'Finished doomscroll: videosViewed=5 swipes=5 likes=3 saves=1 comments=0',
    }, {
        execution: execution({
            id: '22222222-2222-2222-2222-222222222222',
            pluginId: 'com.git-agni.linkedin', taskType: 'connect', status: 'succeeded',
        }),
        summaryLine: 'Finished. sent=4/5 skipped=1 failed=0',
    }];
    const snapshot = aggregateResults(rows, {
        now: new Date('2026-09-15T21:00:00.000Z'),
        days: 7,
        timezone: 'UTC',
        platform: 'all',
        deviceNames: new Map([['device-1', 'Phone Farm #1']]),
    });
    assert.equal(snapshot.today, '2026-09-15');
    assert.equal(snapshot.todayTotals.likes, 3);
    assert.equal(snapshot.todayTotals.sent, 4);
    assert.equal(snapshot.range.succeeded, 2);
    const tiktok = snapshot.workflows.find((item) => item.taskType === 'doomscroll');
    assert.equal(tiktok?.likes, 3);
    assert.equal(snapshot.devices[0]?.name, 'Phone Farm #1');
    assert.equal(dayKey(new Date('2026-09-15T21:00:00.000Z'), 'UTC'), '2026-09-15');
});

test('aggregateResults can hide other platforms', () => {
    const rows: ExecutionOutcomeRow[] = [{
        execution: execution({ pluginId: 'com.git-agni.tiktok', taskType: 'doomscroll', status: 'succeeded' }),
        summaryLine: 'Finished doomscroll: likes=2 saves=0 comments=0 videosViewed=1 swipes=1',
    }, {
        execution: execution({
            id: '22222222-2222-2222-2222-222222222222',
            pluginId: 'com.git-agni.instagram', taskType: 'cold-dms', status: 'succeeded',
        }),
        summaryLine: 'Cold DMs finished: sent=6 failed=1 total=7',
    }];
    const snapshot = aggregateResults(rows, {
        now: new Date('2026-09-15T21:00:00.000Z'),
        days: 7,
        timezone: 'UTC',
        platform: 'instagram',
    });
    assert.equal(snapshot.range.runs, 1);
    assert.equal(snapshot.range.sent, 6);
    assert.equal(snapshot.range.likes, 0);
});

test('addTotals mutates in place', () => {
    const totals = emptyTotals();
    addTotals(totals, { runs: 2, likes: 5 });
    assert.equal(totals.runs, 2);
    assert.equal(totals.likes, 5);
});
