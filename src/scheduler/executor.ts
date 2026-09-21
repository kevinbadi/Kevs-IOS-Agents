import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

import type { DeviceAutomation, PluginProcessSpecification, TaskExecutionContext } from '../plugin.js';
import { discoverConnectedDevices, type Device } from '../devices/discovery.js';
import { loadRegisteredDevices, type RegisteredDevice } from '../devices/registry.js';
import { passcodeForDevice } from '../devices/secrets.js';
import { WdaRemoteControl } from '../devices/wda-remote.js';
import type { ExecutionRow } from '../database/schema.js';
import type { PluginRegistry } from '../registry.js';
import type { TaskExecutionResult } from '../types.js';
import type { SchedulerRepository } from './repository.js';

async function endpointReady(url: string): Promise<boolean> {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(3_000) })).ok;
    } catch {
        return false;
    }
}

/** Why the worker cannot start the task yet — logged so the dashboard is not stuck on “Waiting for worker output…”. */
export function deviceWaitProblem(options: {
    deviceFound: boolean;
    wdaReady: boolean;
    appiumReady: boolean;
    wdaPort: number;
    appiumPort: number;
}): string | undefined {
    if (!options.deviceFound) return 'device is offline';
    if (!options.wdaReady) return `WDA is unavailable on port ${options.wdaPort}`;
    if (!options.appiumReady) return `Appium is unavailable on port ${options.appiumPort}`;
    return undefined;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('Execution stopped while waiting for the device'));
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('Execution stopped while waiting for the device'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

async function waitForDevice(
    execution: ExecutionRow,
    registered: RegisteredDevice,
    signal: AbortSignal,
    onWait: (problem: string) => Promise<void>,
): Promise<Device> {
    const wdaPort = registered.wdaLocalPort ?? Number(process.env.WDA_LOCAL_PORT ?? 8100);
    const appiumHost = process.env.APPIUM_HOST ?? '127.0.0.1';
    const appiumPort = Number(process.env.APPIUM_PORT ?? 4725);
    let lastProblem = 'device is offline';
    let lastReported = '';
    while (Date.now() <= execution.deadlineAt.getTime()) {
        if (signal.aborted) throw new Error('Execution stopped while waiting for the device');
        const device = (await discoverConnectedDevices()).find(({ udid }) => udid === execution.deviceUdid);
        const problem = deviceWaitProblem({
            deviceFound: Boolean(device),
            wdaReady: Boolean(device) && await endpointReady(`http://127.0.0.1:${wdaPort}/status`),
            appiumReady: Boolean(device) && await endpointReady(`http://${appiumHost}:${appiumPort}/status`),
            wdaPort,
            appiumPort,
        });
        if (device && !problem) return device;
        lastProblem = problem ?? lastProblem;
        await onWait(lastProblem === lastReported ? '' : lastProblem);
        lastReported = lastProblem;
        await delay(5_000, signal);
    }
    throw new Error(`Execution window expired: ${lastProblem}`);
}

function deviceAutomation(
    registered: RegisteredDevice,
    passcode: string | undefined,
    log: (line: string) => Promise<void> = async () => {},
): DeviceAutomation {
    const udid = registered.udid;
    const remote = new WdaRemoteControl({
        deviceUdid: udid,
        wdaUrl: `http://127.0.0.1:${registered.wdaLocalPort ?? Number(process.env.WDA_LOCAL_PORT ?? 8100)}`,
        passcode,
    });
    return {
        // Some WDA builds only mount /wda/apps/* inside a session; these fall back to one.
        activateApp: (bundleId) => remote.launchApp(udid, bundleId),
        terminateApp: (bundleId) => remote.terminateApp(udid, bundleId),
        pause: (milliseconds, signal) => new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason);
            const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
            const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, milliseconds);
            signal?.addEventListener('abort', onAbort, { once: true });
        }),
        screenshot: () => remote.getScreenshot(udid),
        tap: (x, y) => remote.performAction(udid, { type: 'tap', x, y }),
        swipe: (startX, startY, endX, endY, durationMs) => remote.performAction(udid, {
            type: 'swipe', startX, startY, endX, endY, durationMs,
        }),
        elements: async () => {
            const report = await remote.getIndexedElements(udid);
            // Logged so the pruner can be tuned against real screens; the budget is ~4000 tokens.
            await log(`elements: kept ${report.elements.length} of ${report.candidates} candidates (${report.total} nodes) · ~${report.tokenEstimate} tokens`);
            return report.elements;
        },
    };
}

async function runPluginProcess(
    specification: PluginProcessSpecification,
    environment: NodeJS.ProcessEnv,
    signal: AbortSignal,
    onLines: (lines: string[]) => Promise<void>,
): Promise<TaskExecutionResult> {
    const child = spawn(process.execPath, [
        '--env-file-if-exists=.env', '--env-file-if-exists=.env.devices', '--import', 'tsx',
        specification.entrypoint, ...(specification.args ?? []),
    ], { cwd: process.cwd(), env: { ...environment, ...specification.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending: string[] = [];
    const append = (chunk: Buffer | string) => { pending.push(...chunk.toString().split(/\r?\n/).filter(Boolean)); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const flush = async () => {
        if (!pending.length) return;
        const lines = pending;
        pending = [];
        await onLines(lines);
    };
    const timer = setInterval(() => void flush().catch(console.error), 3_000);
    let stopped = false;
    const stop = () => {
        stopped = true;
        if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
        const result = await new Promise<TaskExecutionResult>((resolve) => {
            child.once('error', (error) => resolve({ exitCode: null, stopped, error: error.message }));
            child.once('exit', (exitCode, childSignal) => resolve({
                exitCode,
                stopped,
                ...(exitCode === 0 ? {} : {
                    error: childSignal ? `Plugin process stopped by ${childSignal}` : `Plugin process exited with ${exitCode}`,
                }),
            }));
        });
        await flush();
        return result;
    } finally {
        clearInterval(timer);
        signal.removeEventListener('abort', stop);
    }
}

export async function executeAutomation(
    repository: SchedulerRepository,
    plugins: PluginRegistry,
    execution: ExecutionRow,
    attempt: number,
    signal: AbortSignal,
): Promise<TaskExecutionResult> {
    const registered = (await loadRegisteredDevices()).find(({ udid }) => udid === execution.deviceUdid);
    if (!registered) return { exitCode: null, stopped: false, error: 'Device is not registered' };
    if (Date.now() > execution.deadlineAt.getTime()) {
        return { exitCode: null, stopped: false, error: 'Execution window expired before the worker claimed the task' };
    }
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    if (signal.aborted) forwardAbort();
    signal.addEventListener('abort', forwardAbort, { once: true });
    const stopPoll = setInterval(() => void repository.stopRequested(execution.id).then((requested) => {
        if (requested) controller.abort(new Error('Stop requested'));
    }).catch(console.error), 1_000);
    let device: Device;
    try {
        await repository.appendLogs(execution.id, attempt, ['Checking that the device, WDA, and Appium are ready']);
        device = await waitForDevice(execution, registered, controller.signal, async (problem) => {
            if (problem) await repository.appendLogs(execution.id, attempt, [`Waiting for the device: ${problem}`]);
            else await repository.touchRunning(execution.id);
        });
    } catch (error) {
        clearInterval(stopPoll);
        signal.removeEventListener('abort', forwardAbort);
        return { exitCode: null, stopped: controller.signal.aborted, error: error instanceof Error ? error.message : String(error) };
    }
    const workspaceDirectory = await mkdtemp(`${os.tmpdir()}/phone-farm-${execution.id}-`);
    const task = { pluginId: execution.pluginId, taskType: execution.taskType, taskVersion: execution.taskVersion, payload: execution.payload };
    try {
        const definition = plugins.task(task);
        const passcode = await passcodeForDevice(device.udid);
        const environment: NodeJS.ProcessEnv = {
            ...process.env,
            IOS_UDID: device.udid,
            WDA_URL: `http://127.0.0.1:${registered.wdaLocalPort ?? Number(process.env.WDA_LOCAL_PORT ?? 8100)}`,
            ...(passcode ? { IOS_PASSCODE: passcode } : {}),
        };
        const log = (line: string) => repository.appendLogs(execution.id, attempt, [line]);
        const context: TaskExecutionContext = {
            executionId: execution.id,
            attempt,
            workspaceDirectory,
            device,
            devicePluginData: registered.pluginData[execution.pluginId] ?? {},
            automation: deviceAutomation(registered, passcode, log),
            assets: await repository.executionAssets(execution),
            signal: controller.signal,
            log,
            runProcess: (specification) => runPluginProcess(specification, environment, controller.signal, (lines) => repository.appendLogs(execution.id, attempt, lines)),
            claimPipelineItem: () => repository.claimNextPipelineItem(execution.deviceUdid, execution.id),
            completePipelineItem: (id) => repository.completePipelineItem(id),
            failPipelineItem: (id, error) => repository.failPipelineItem(id, error),
        };
        return await definition.execute(context, execution.payload);
    } catch (error) {
        return { exitCode: null, stopped: controller.signal.aborted, error: error instanceof Error ? error.message : String(error) };
    } finally {
        clearInterval(stopPoll);
        signal.removeEventListener('abort', forwardAbort);
        await rm(workspaceDirectory, { recursive: true, force: true });
    }
}
