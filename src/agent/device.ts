import crypto from 'node:crypto';

import sharp from 'sharp';

import type { RemoteAction, ScreenInfo } from '../devices/wda-remote.js';
import type { AgentAction } from './actions.js';
import { compactHierarchy, type CompactHierarchy } from './hierarchy.js';

/** The slice of WDA control the agent needs. RegistryWdaRemoteControl satisfies this. */
export interface AgentRemote {
    getScreenInfo(udid: string): Promise<ScreenInfo>;
    getScreenshot(udid: string): Promise<Buffer>;
    getSource(udid: string): Promise<string>;
    getActiveApp?(udid: string): Promise<{ bundleId: string; name: string } | null>;
    pressHome?(udid: string): Promise<void>;
    performAction(udid: string, action: RemoteAction): Promise<void>;
    isLocked(udid: string): Promise<boolean>;
    unlock(udid: string): Promise<void>;
    typeText(udid: string, text: string): Promise<void>;
    launchApp(udid: string, bundleId: string): Promise<void>;
    releaseSession?(udid: string): Promise<void>;
}

export interface Observation {
    screen: { width: number; height: number };
    /** Annotated JPEG shown to the model and stored for the UI. */
    image: Buffer;
    imageSize: { width: number; height: number };
    hierarchy: CompactHierarchy;
    /** Human label for what is in the foreground, e.g. "Settings" or "Home screen (SpringBoard)". */
    app: string | null;
    locked: boolean;
    /** Hash of the raw screenshot, used to detect "nothing changed". */
    fingerprint: string;
}

const SPRINGBOARD = 'com.apple.springboard';

export function describeForegroundApp(
    active: { bundleId: string; name: string } | null,
    fromTree: string | null,
): string | null {
    if (active?.bundleId === SPRINGBOARD) return 'Home screen (SpringBoard)';
    if (active?.bundleId) {
        const name = active.name || fromTree;
        return name ? `${name} (${active.bundleId})` : active.bundleId;
    }
    return fromTree;
}

const MAX_LONG_SIDE = 1568;
const GRID_STEP_POINTS = 100;

function gridOverlay(points: { width: number; height: number }, scale: number, size: { width: number; height: number }): Buffer {
    const lines: string[] = [];
    const labels: string[] = [];
    for (let x = GRID_STEP_POINTS; x < points.width; x += GRID_STEP_POINTS) {
        const px = Math.round(x * scale);
        lines.push(`<line x1="${px}" y1="0" x2="${px}" y2="${size.height}"/>`);
        labels.push(`<text x="${px + 3}" y="14">${x}</text>`);
    }
    for (let y = GRID_STEP_POINTS; y < points.height; y += GRID_STEP_POINTS) {
        const py = Math.round(y * scale);
        lines.push(`<line x1="0" y1="${py}" x2="${size.width}" y2="${py}"/>`);
        labels.push(`<text x="3" y="${py - 4}">${y}</text>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
<g stroke="rgba(255,64,128,0.55)" stroke-width="1" stroke-dasharray="4 6">${lines.join('')}</g>
<g font-family="Menlo, monospace" font-size="12" font-weight="700" fill="#ff4b8b" stroke="#000" stroke-width="2.5" paint-order="stroke">${labels.join('')}</g>
</svg>`;
    return Buffer.from(svg);
}

export async function annotateScreenshot(
    png: Buffer,
    screen: { width: number; height: number },
): Promise<{ image: Buffer; size: { width: number; height: number } }> {
    const longSide = Math.max(screen.width, screen.height);
    // 1.5× points keeps small UI text legible while staying inside the model's
    // preferred image budget; clamp for very tall devices.
    const scale = Math.min(1.5, MAX_LONG_SIDE / longSide);
    const size = { width: Math.round(screen.width * scale), height: Math.round(screen.height * scale) };
    const image = await sharp(png)
        .resize(size.width, size.height, { fit: 'fill' })
        .composite([{ input: gridOverlay(screen, scale, size), top: 0, left: 0 }])
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
    return { image, size };
}

export class AgentDevice {
    private screen: ScreenInfo | undefined;

    constructor(private readonly remote: AgentRemote, readonly udid: string) {}

    async screenInfo(): Promise<ScreenInfo> {
        if (!this.screen) this.screen = await this.remote.getScreenInfo(this.udid);
        return this.screen;
    }

    async ensureUnlocked(): Promise<{ locked: boolean; note?: string }> {
        let locked = false;
        try {
            locked = await this.remote.isLocked(this.udid);
        } catch {
            return { locked: false };
        }
        if (!locked) return { locked: false };
        try {
            await this.remote.unlock(this.udid);
            return { locked: false, note: 'Device was locked; unlocked with the stored passcode.' };
        } catch (error) {
            return { locked: true, note: `Device is locked and could not be unlocked: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    async observe(): Promise<Observation> {
        const info = await this.screenInfo();
        const screen = { width: info.screenSize.width, height: info.screenSize.height };
        const [png, source, locked, active] = await Promise.all([
            this.remote.getScreenshot(this.udid),
            this.remote.getSource(this.udid).catch(() => ''),
            this.remote.isLocked(this.udid).catch(() => false),
            this.remote.getActiveApp ? this.remote.getActiveApp(this.udid).catch(() => null) : Promise.resolve(null),
        ]);
        const { image, size } = await annotateScreenshot(png, screen);
        const hierarchy = compactHierarchy(source, { screen });
        const app = describeForegroundApp(active, hierarchy.app);
        if (app && app !== hierarchy.app) {
            hierarchy.text = hierarchy.text.replace(/^Foreground app: .*\n/, '');
            hierarchy.text = `Foreground app: ${app}\n${hierarchy.text}`;
        }
        return {
            screen,
            image,
            imageSize: size,
            hierarchy,
            app,
            locked,
            fingerprint: crypto.createHash('sha1').update(png).digest('hex').slice(0, 16),
        };
    }

    async perform(action: AgentAction): Promise<void> {
        switch (action.type) {
            case 'tap':
                await this.remote.performAction(this.udid, { type: 'tap', x: action.x, y: action.y });
                return;
            case 'long_press':
                await this.remote.performAction(this.udid, {
                    type: 'swipe', startX: action.x, startY: action.y, endX: action.x, endY: action.y, durationMs: action.durationMs,
                });
                return;
            case 'swipe':
                await this.remote.performAction(this.udid, {
                    type: 'swipe',
                    startX: action.startX, startY: action.startY, endX: action.endX, endY: action.endY,
                    durationMs: action.durationMs,
                });
                return;
            case 'type_text':
                await this.remote.typeText(this.udid, action.text);
                return;
            case 'press_home':
                if (this.remote.pressHome) {
                    await this.remote.pressHome(this.udid);
                    return;
                }
                try {
                    await this.remote.performAction(this.udid, { type: 'home' });
                } catch (error) {
                    // The press happened; WDA only timed out waiting for SpringBoard.
                    if (!/home screen is visible/i.test(error instanceof Error ? error.message : String(error))) throw error;
                }
                return;
            case 'open_app':
                await this.remote.launchApp(this.udid, action.bundleId);
                return;
            case 'wait':
                await new Promise((resolve) => setTimeout(resolve, action.seconds * 1000));
                return;
            case 'done':
            case 'fail':
                return;
        }
    }

    async release(): Promise<void> {
        await this.remote.releaseSession?.(this.udid).catch(() => {});
    }
}
