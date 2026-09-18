import { access, constants } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';

const execFileAsync = promisify(execFile);

export interface AndroidEmulator {
    name: string;
    udid?: string;
    status: 'creating' | 'starting' | 'ready' | 'stopped' | 'error';
    systemImage: string;
    error?: string;
}

export interface CreateAndroidEmulatorOptions {
    name: string;
    systemImage?: string;
    device?: string;
    port?: number;
}

interface EmulatorRuntime {
    info: AndroidEmulator;
    process?: ChildProcess;
}

const runtimes = new Map<string, EmulatorRuntime>();
const defaultSystemImage = process.env.ANDROID_SYSTEM_IMAGE ?? 'system-images;android-35;google_apis;x86_64';
const commandTimeout = 10_000;

function sdkTool(relativePath: string): string {
    const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    return sdkRoot ? `${sdkRoot}/${relativePath}` : relativePath;
}

async function run(file: string, args: string[]): Promise<string> {
    try {
        const result = await execFileAsync(file, args, { timeout: commandTimeout, maxBuffer: 1_000_000 });
        return result.stdout.trim();
    } catch (error) {
        const detail = error as { stderr?: string; message?: string };
        throw new Error(detail.stderr?.trim() || detail.message || String(error));
    }
}

function runWithInput(file: string, args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`${file} did not finish within ${commandTimeout / 1_000} seconds`));
        }, commandTimeout);
        child.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('exit', (code) => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr.trim() || `${file} exited with ${code}`));
        });
        child.stdin.end(input);
    });
}

function validName(name: string): boolean {
    return /^[a-zA-Z0-9._-]{1,64}$/.test(name);
}

function validPort(port: number): boolean {
    return Number.isInteger(port) && port >= 5554 && port <= 5680 && port % 2 === 0;
}

async function waitForBoot(udid: string, timeoutMs = 120_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const value = await run(sdkTool('platform-tools/adb'), ['-s', udid, 'shell', 'getprop', 'sys.boot_completed']);
            if (value === '1') return;
        } catch { /* emulator is still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Android emulator ${udid} did not finish booting`);
}

async function hasKvmAccess(): Promise<boolean> {
    try {
        await access('/dev/kvm', constants.R_OK | constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

function emulatorCommand(emulatorPath: string, args: string[]): { file: string; args: string[] } {
    if (process.platform !== 'linux') return { file: emulatorPath, args };
    return {
        file: 'sg',
        args: ['kvm', '-c', [emulatorPath, ...args].map(shellQuote).join(' ')],
    };
}

export async function listAndroidEmulators(): Promise<AndroidEmulator[]> {
    let avds: string[];
    try {
        avds = (await run(sdkTool('emulator/emulator'), ['-list-avds'])).split(/\r?\n/).filter(Boolean);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
    const active = new Set<string>();
    try {
        const output = await run(sdkTool('platform-tools/adb'), ['devices']);
        for (const line of output.split(/\r?\n/).slice(1)) {
            const [udid, state] = line.trim().split(/\s+/);
            if (udid?.startsWith('emulator-') && state === 'device') active.add(udid);
        }
    } catch { /* adb is optional until an emulator is started */ }
    return avds.map((name) => runtimes.get(name)?.info ?? {
        name,
        status: 'stopped' as const,
        systemImage: defaultSystemImage,
        ...(Array.from(active).find((udid) => runtimes.get(name)?.info.udid === udid)
            ? { udid: Array.from(active).find((udid) => runtimes.get(name)?.info.udid === udid) }
            : {}),
    });
}

export async function createAndroidEmulator(options: CreateAndroidEmulatorOptions): Promise<AndroidEmulator> {
    const name = options.name.trim();
    const systemImage = options.systemImage?.trim() || defaultSystemImage;
    if (!validName(name)) throw new Error('Emulator name must use letters, numbers, dots, underscores, or hyphens');
    if (options.port !== undefined && !validPort(options.port)) throw new Error('Emulator port must be an even number from 5554 to 5680');
    if (runtimes.get(name)?.info.status === 'ready') throw new Error(`Emulator ${name} is already running`);

    const info: AndroidEmulator = { name, status: 'creating', systemImage };
    const runtime: EmulatorRuntime = { info };
    runtimes.set(name, runtime);
    try {
        if (!await hasKvmAccess()) {
            try {
                await run('getent', ['group', 'kvm']);
            } catch {
                throw new Error('Android Emulator requires read/write access to /dev/kvm. Add the container user to the kvm group and recreate the container with /dev/kvm exposed.');
            }
        }
        await runWithInput(sdkTool('cmdline-tools/latest/bin/avdmanager'), [
            'create', 'avd', '--name', name, '--package', systemImage, '--force',
            ...(options.device ? ['--device', options.device] : []),
        ], 'no\n');
        info.status = 'starting';
        const args = ['-avd', name, '-no-audio', '-no-boot-anim', '-no-snapshot'];
        if (options.port !== undefined) args.push('-port', String(options.port));
        const command = emulatorCommand(sdkTool('emulator/emulator'), args);
        runtime.process = spawn(command.file, command.args, { stdio: 'ignore' });
        const udid = `emulator-${options.port ?? 5554}`;
        info.udid = udid;
        await waitForBoot(udid);
        info.status = 'ready';
        return { ...info };
    } catch (error) {
        info.status = 'error';
        info.error = (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'Android SDK is not installed or emulator tools are not on PATH. Install cmdline-tools, emulator, platform-tools, and a system image.'
            : error instanceof Error ? error.message : String(error);
        runtime.process?.kill('SIGTERM');
        throw new Error(info.error);
    }
}

export async function stopAndroidEmulator(name: string): Promise<void> {
    const runtime = runtimes.get(name);
    if (!runtime) throw new Error(`Emulator ${name} is not managed by this process`);
    if (runtime.info.udid) await run(sdkTool('platform-tools/adb'), ['-s', runtime.info.udid, 'emu', 'kill']);
    runtime.process?.kill('SIGTERM');
    runtime.info.status = 'stopped';
    runtime.info.udid = undefined;
}

export async function getAndroidEmulatorScreenshot(name: string): Promise<Buffer> {
    const runtime = runtimes.get(name);
    const emulator = runtime?.info;
    if (!emulator?.udid || emulator.status !== 'ready') {
        throw new Error(`Emulator ${name} is not ready`);
    }
    const result = await execFileAsync(sdkTool('platform-tools/adb'), [
        '-s', emulator.udid, 'exec-out', 'screencap', '-p',
    ], { timeout: commandTimeout, maxBuffer: 20_000_000, encoding: 'buffer' });
    return result.stdout;
}