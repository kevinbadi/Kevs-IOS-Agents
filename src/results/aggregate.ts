import type { ExecutionRow } from '../database/schema.js';
import {
    addTotals, dayKey, emptyTotals, parseOutcomeLine, pluginPlatform, workflowLabel,
    type ResultsPlatform, type ResultsTotals,
} from './metrics.js';

export interface ExecutionOutcomeRow {
    execution: ExecutionRow;
    summaryLine: string | null;
}

export interface ResultsDay extends ResultsTotals {
    date: string;
}

export interface ResultsWorkflow extends ResultsTotals {
    pluginId: string;
    taskType: string;
    label: string;
    platform: Exclude<ResultsPlatform, 'all'> | 'other';
}

export interface ResultsDevice extends ResultsTotals {
    udid: string;
    name: string;
}

export interface ResultsSnapshot {
    timezone: string;
    days: number;
    platform: ResultsPlatform;
    today: string;
    range: ResultsTotals;
    todayTotals: ResultsTotals;
    daily: ResultsDay[];
    workflows: ResultsWorkflow[];
    devices: ResultsDevice[];
}

function runStatus(status: string): Pick<ResultsTotals, 'runs' | 'succeeded' | 'failed' | 'stopped'> {
    return {
        runs: 1,
        succeeded: status === 'succeeded' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        stopped: status === 'stopped' || status === 'cancelled' ? 1 : 0,
    };
}

function outcomesFor(row: ExecutionOutcomeRow): Partial<ResultsTotals> {
    const parsed = row.summaryLine ? parseOutcomeLine(row.summaryLine) : {};
    if (row.execution.taskType === 'post' && row.execution.status === 'succeeded' && !parsed.posts) {
        return { ...parsed, posts: 1 };
    }
    if (row.execution.taskType === 'pipeline-drain' && row.execution.status === 'succeeded' && !parsed.posts) {
        return { ...parsed, posts: 1 };
    }
    return parsed;
}

export function aggregateResults(
    rows: ExecutionOutcomeRow[],
    options: {
        now?: Date;
        days: number;
        timezone: string;
        platform: ResultsPlatform;
        deviceNames?: Map<string, string>;
    },
): ResultsSnapshot {
    const now = options.now ?? new Date();
    const today = dayKey(now, options.timezone);
    const dailyMap = new Map<string, ResultsTotals>();
    const [year, month, day] = today.split('-').map(Number);
    for (let offset = options.days - 1; offset >= 0; offset--) {
        const date = new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10);
        dailyMap.set(date, emptyTotals());
    }

    const workflowMap = new Map<string, ResultsWorkflow>();
    const deviceMap = new Map<string, ResultsDevice>();
    const range = emptyTotals();
    const todayTotals = emptyTotals();

    for (const row of rows) {
        const platform = pluginPlatform(row.execution.pluginId);
        if (options.platform !== 'all' && platform !== options.platform) continue;
        const when = row.execution.finishedAt ?? row.execution.startedAt ?? row.execution.createdAt;
        const date = dayKey(when, options.timezone);
        if (!dailyMap.has(date)) continue;

        const increment: ResultsTotals = { ...emptyTotals(), ...runStatus(row.execution.status) };
        addTotals(increment, outcomesFor(row));
        addTotals(range, increment);
        addTotals(dailyMap.get(date)!, increment);
        if (date === today) addTotals(todayTotals, increment);

        const workflowKey = `${row.execution.pluginId}/${row.execution.taskType}`;
        let workflow = workflowMap.get(workflowKey);
        if (!workflow) {
            workflow = {
                ...emptyTotals(),
                pluginId: row.execution.pluginId,
                taskType: row.execution.taskType,
                label: workflowLabel(row.execution.pluginId, row.execution.taskType),
                platform: platform ?? 'other',
            };
            workflowMap.set(workflowKey, workflow);
        }
        addTotals(workflow, increment);

        let device = deviceMap.get(row.execution.deviceUdid);
        if (!device) {
            device = {
                ...emptyTotals(),
                udid: row.execution.deviceUdid,
                name: options.deviceNames?.get(row.execution.deviceUdid) ?? row.execution.deviceUdid,
            };
            deviceMap.set(row.execution.deviceUdid, device);
        }
        addTotals(device, increment);
    }

    const daily = [...dailyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, totals]) => ({ date, ...totals }));
    const workflows = [...workflowMap.values()].sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));
    const devices = [...deviceMap.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));

    return {
        timezone: options.timezone,
        days: options.days,
        platform: options.platform,
        today,
        range,
        todayTotals,
        daily,
        workflows,
        devices,
    };
}
