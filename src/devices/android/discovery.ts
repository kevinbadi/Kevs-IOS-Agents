import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AndroidDevice {
    name: string;
    osVersion: string;
    udid: string;
    platform: 'android';
    modelName?: string;
}

export interface AndroidCommandRunner {
    (file: string, args: string[]): Promise<{ stdout: string }>;
}

const defaultRunner: AndroidCommandRunner = async (file, args) => {
    const result = await execFileAsync(file, args, { maxBuffer: 1_000_000 });
    return { stdout: result.stdout };
};

function parseDevices(stdout: string): string[] {
    return stdout.split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter(([udid, state]) => Boolean(udid) && state === 'device')
        .map(([udid]) => udid!);
}

async function adbGet(runner: AndroidCommandRunner, udid: string, property: string): Promise<string> {
    const { stdout } = await runner('adb', ['-s', udid, 'shell', 'getprop', property]);
    return stdout.trim();
}

export async function discoverConnectedAndroidDeviceUdids(
    runner: AndroidCommandRunner = defaultRunner,
): Promise<string[]> {
    const { stdout } = await runner('adb', ['devices']);
    return parseDevices(stdout);
}

export async function discoverConnectedAndroidDevices(
    runner: AndroidCommandRunner = defaultRunner,
): Promise<AndroidDevice[]> {
    const udids = await discoverConnectedAndroidDeviceUdids(runner);
    return Promise.all(udids.map(async (udid) => {
        const [modelName, osVersion] = await Promise.all([
            adbGet(runner, udid, 'ro.product.model'),
            adbGet(runner, udid, 'ro.build.version.release'),
        ]);
        return {
            name: modelName || udid,
            modelName: modelName || undefined,
            osVersion,
            udid,
            platform: 'android' as const,
        };
    }));
}