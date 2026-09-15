/**
 * Walk LinkedIn's mapped chrome on a live phone: launch the app, tap each
 * bottom tab, open Search / Messaging / My Network, then return Home.
 * Never sends a connection request.
 *
 *   IOS_UDID=00008110-000E403E1AC2401E WDA_URL=http://127.0.0.1:8101 npm run linkedin:tour
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import { coordinateProfile } from '../instagram/runtime-settings.js';
import { recognizeWords } from '../instagram/ocr.js';
import { LINKEDIN_BUNDLE_ID, type LinkedInCalibratablePoint } from './coordinates.js';
import { classifyLinkedInScreen } from './screen.js';

const deviceUdid = process.env.IOS_UDID;
if (!deviceUdid) throw new Error('IOS_UDID is required');
const udid: string = deviceUdid;
const wdaUrl = process.env.WDA_URL;
const pauseMs = Number(process.env.LINKEDIN_TOUR_PAUSE_MS ?? 1400);
const outRoot = process.env.LINKEDIN_TOUR_DIR ?? path.resolve('data', 'linkedin', 'tour');

const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === udid);
const resolved = resolveDeviceCoordinates(
    coordinateProfile(registeredDevice),
    registeredDevice?.linkedinCoordinates,
    'linkedin',
);
const li = resolved.linkedin;
const remote = new WdaRemoteControl({
    deviceUdid: udid,
    ...(wdaUrl ? { wdaUrl } : {}),
    passcodeKeypadLayout: resolved.passcodeKeypad,
});

const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
const sessionDir = path.join(outRoot, sessionId);
await mkdir(sessionDir, { recursive: true });

async function pause(ms = pauseMs): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchLinkedIn(): Promise<string | undefined> {
    const response = await remote.request('/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            capabilities: { alwaysMatch: { bundleId: LINKEDIN_BUNDLE_ID } },
        }),
    });
    const payload = await response.json() as { sessionId?: string; value?: { sessionId?: string } };
    return payload.sessionId ?? payload.value?.sessionId;
}

async function snapshot(label: string): Promise<string> {
    const image = await remote.getScreenshot(udid);
    const { scale } = await remote.getScreenInfo(udid);
    const words = await recognizeWords(image);
    const screen = classifyLinkedInScreen(words, { scale });
    const file = `${label}.png`;
    await writeFile(path.join(sessionDir, file), image);
    const line = `${label} → ${screen.kind}`;
    console.log(line);
    return line;
}

async function tap(name: LinkedInCalibratablePoint, label: string): Promise<void> {
    const point = li[name];
    console.log(`Tap ${label} (${point.x}, ${point.y})`);
    await remote.performAction(udid, { type: 'tap', x: point.x, y: point.y });
    await pause();
}

console.log(`LinkedIn tour ${sessionId} → ${sessionDir}`);
console.log(`Device ${udid} · ${resolved.displayName} · ${li.screenSize.width}×${li.screenSize.height}`);

let wdaSession: string | undefined;
try {
    await remote.unlock(udid);
} catch (error) {
    console.log(`Unlock skipped: ${error instanceof Error ? error.message : String(error)}`);
}

wdaSession = await launchLinkedIn();
await pause(2500);
const log: string[] = [];
try {
    log.push(await snapshot('01-launch'));

    await tap('homeTab', 'Home');
    log.push(await snapshot('02-home'));

    await tap('networkTab', 'My Network');
    log.push(await snapshot('03-network'));

    await tap('notificationsTab', 'Notifications');
    log.push(await snapshot('04-notifications'));

    await tap('jobsTab', 'Jobs');
    log.push(await snapshot('05-jobs'));

    await tap('homeTab', 'Home');
    await tap('searchField', 'Search');
    log.push(await snapshot('06-search'));

    await tap('back', 'Back from search');
    await tap('messaging', 'Messaging');
    log.push(await snapshot('07-messaging'));

    await tap('threadBack', 'Back from messaging');
    await tap('homeTab', 'Home');
    log.push(await snapshot('08-home-return'));
} finally {
    if (wdaSession) {
        await remote.request(`/session/${wdaSession}`, { method: 'DELETE' }).catch(() => {});
    }
}

await writeFile(path.join(sessionDir, 'tour.json'), JSON.stringify({
    udid, sessionId, profile: registeredDevice?.coordinateProfile ?? 'iphone13', log,
}, null, 2));
console.log('Tour finished. No connection requests were sent.');
