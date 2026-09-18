import { remote, type Browser } from 'webdriverio';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import { appiumCapabilities } from '../devices/appium-capabilities.js';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchInstagramAccount, tapCoordinate, typeText } from './actions.js';
import { detectEngagementControls } from './engagement-controls.js';
import { identifyInstagramScreen } from './screen-identity.js';
import {
    PROFILES,
    clampToDeadline,
    decideComment,
    decideLike,
    decideLinger,
    hasTimeRemaining,
    isPersonality,
    pickWatchDurationMs,
} from './doomscroll-profile.js';

function positiveInteger(name: string, fallback: number): number {
    const rawValue = process.env[name] ?? String(fallback);
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer; received ${rawValue}`);
    }
    return value;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
    const value = positiveInteger(name, fallback);
    if (value < min || value > max) {
        throw new Error(`${name} must be between ${min} and ${max}; received ${value}`);
    }
    return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} must be 'true' or 'false'; received ${raw}`);
}

const udidEnv = process.env.IOS_UDID;
if (!udidEnv) {
    throw new Error('IOS_UDID is required. Copy .env.example to .env and set the connected device UDID.');
}
const udid: string = udidEnv;

const personalityRaw = process.env.DOOMSCROLL_PERSONALITY ?? 'casual';
if (!isPersonality(personalityRaw)) {
    throw new Error(`DOOMSCROLL_PERSONALITY must be one of skimmer, casual, engaged, dialed; received ${personalityRaw}`);
}
const personality = personalityRaw;
const profile = PROFILES[personality];

const durationMinutes = boundedInteger('DOOMSCROLL_DURATION_MINUTES', 5, 1, 180);
const likeEnabled = booleanEnv('DOOMSCROLL_LIKE_ENABLED', true);
const commentEnabled = booleanEnv('DOOMSCROLL_COMMENT_ENABLED', false);
const commentText = (process.env.DOOMSCROLL_COMMENT_TEXT ?? '').trim();
if (commentEnabled && !commentText) {
    throw new Error('DOOMSCROLL_COMMENT_TEXT is required when DOOMSCROLL_COMMENT_ENABLED=true');
}
const switchAccountName = process.env.INSTAGRAM_SWITCH_ACCOUNT?.trim() || undefined;
const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === udid);
const coordinates = resolveDeviceCoordinates(
    coordinateProfile(registeredDevice),
    registeredDevice?.instagramCoordinates,
    'instagram',
);
const instagramCoordinates = coordinates.instagram;
const accountSwitchCoords = {
    profileTabX: instagramCoordinates.profileTab.x,
    profileTabY: instagramCoordinates.profileTab.y,
    switcherTriggerX: instagramCoordinates.accountSwitcher.x,
    switcherTriggerY: instagramCoordinates.accountSwitcher.y,
};
const { x: reelsTabX, y: reelsTabY } = instagramCoordinates.reelsTab;

const allowedAccounts = switchAccountName
    ? registeredAccounts(registeredDevice)
    : [];
if (switchAccountName && !allowedAccounts.includes(switchAccountName)) {
    throw new Error(`Instagram account "${switchAccountName}" is not listed in devices.json for device ${udid}`);
}
let { x: likeX, y: likeY } = instagramCoordinates.like;
const { x: commentX, y: commentY } = instagramCoordinates.comment;
const { x: commentComposerX, y: commentComposerY } = instagramCoordinates.commentComposer;
const { x: commentSendX, y: commentSendY } = instagramCoordinates.commentSend;
const { startY: swipeStartY, endY: swipeEndY, durationMs: swipeDurationMs } = instagramCoordinates.swipe;
// Left-of-center vertical flick avoids the Reels engagement rail.
const swipeAxisX = Math.round(coordinates.screenSize.width * 0.38);
const wdaUrl = process.env.WDA_URL;
const instagramBundleId = process.env.INSTAGRAM_BUNDLE_ID ?? 'com.burbn.instagram';
const registeredPlatform = registeredDevice?.platform ?? 'ios';

const capabilities: WebdriverIO.Capabilities & Record<string, unknown> = {
    ...appiumCapabilities({ udid, platform: registeredPlatform }, {
        appId: instagramBundleId,
        forceAppLaunch: true,
    }),
    'appium:noReset': true,
    'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true,
    'appium:newCommandTimeout': 120,
    'appium:wdaLaunchTimeout': 120000,
    'appium:wdaConnectionTimeout': 120000,
    'appium:waitForIdleTimeout': 0,
    'appium:showXcodeLog': process.env.SHOW_XCODE_LOG === 'true',
};

if (registeredPlatform === 'android') delete capabilities['appium:waitForIdleTimeout'];

if (registeredPlatform !== 'android' && wdaUrl) {
    capabilities['appium:webDriverAgentUrl'] = wdaUrl;
    capabilities['appium:wdaRemotePort'] = positiveInteger('WDA_REMOTE_PORT', 8100);
} else if (registeredPlatform !== 'android' && process.env.XCODE_ORG_ID) {
    capabilities['appium:xcodeOrgId'] = process.env.XCODE_ORG_ID;
    capabilities['appium:xcodeSigningId'] = process.env.XCODE_SIGNING_ID ?? 'Apple Development';
}
if (registeredPlatform !== 'android' && !wdaUrl && process.env.WDA_BUNDLE_ID) {
    capabilities['appium:updatedWDABundleId'] = process.env.WDA_BUNDLE_ID;
}
if (registeredPlatform !== 'android' && !wdaUrl && process.env.ALLOW_PROVISIONING_DEVICE_REGISTRATION === 'true') {
    capabilities['appium:allowProvisioningDeviceRegistration'] = true;
}
if (registeredPlatform !== 'android' && !wdaUrl && process.env.WDA_BOOTSTRAP_PATH) {
    capabilities['appium:useXctestrunFile'] = true;
    capabilities['appium:bootstrapPath'] = process.env.WDA_BOOTSTRAP_PATH;
}

let stopRequested = false;
let resolveStop: () => void = () => {};
const stopPromise = new Promise<void>((resolve) => { resolveStop = resolve; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        stopRequested = true;
        resolveStop();
    });
}

function cancellableDelay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        void stopPromise.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function interactionPauseMs(): number {
    return Math.round(350 + Math.random() * 450);
}

function engagementSettleMs(): number {
    return Math.round(750 + Math.random() * 850);
}

let driver: Browser | undefined;
let videosViewed = 0;
let swipes = 0;
let likes = 0;
let comments = 0;
let recoveries = 0;
const runStartedAt = Date.now();

console.log(
    `Starting Instagram Reels doomscroll: profile=${personality} requestedDurationMinutes=${durationMinutes}`
    + ` likeEnabled=${likeEnabled} commentEnabled=${commentEnabled}`,
);

async function dismissCommentSheet(
    browser: Browser,
    isStillOpen?: () => Promise<boolean>,
): Promise<void> {
    const width = coordinates.screenSize.width;
    const height = coordinates.screenSize.height;
    // Instagram Reels comment sheet: X / dismiss first so scroll can continue.
    await tapCoordinate(
        browser,
        Math.round(width * 0.92),
        Math.round(height * 0.30),
        'Comment dismiss',
    );
    await browser.pause(600);
    if (!isStillOpen || !(await isStillOpen())) return;

    await tapCoordinate(
        browser,
        Math.round(width * 0.5),
        Math.round(height * 0.14),
        'Above comments sheet',
    );
    await browser.pause(550);
    if (!(await isStillOpen())) return;

    await tapCoordinate(
        browser,
        Math.round(width * 0.92),
        Math.round(height * 0.24),
        'Comment dismiss retry',
    );
    await browser.pause(550);
    if (!(await isStillOpen())) return;

    const grabX = Math.round(width * 0.5);
    const grabY = Math.round(height * 0.36);
    console.log('Comment sheet still open — dragging it closed');
    await browser.performActions([{
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
            { type: 'pointerMove', duration: 0, x: grabX, y: grabY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 80 },
            { type: 'pointerMove', duration: 320, x: grabX, y: Math.round(height * 0.92) },
            { type: 'pointerUp', button: 0 },
        ],
    }]);
    await browser.releaseActions();
    await browser.pause(500);
}

async function postComment(
    browser: Browser,
    text: string,
    isCommentSheetOpen?: () => Promise<boolean>,
): Promise<void> {
    await tapCoordinate(browser, commentX, commentY, 'Comment');
    await browser.pause(800);
    await tapCoordinate(browser, commentComposerX, commentComposerY, 'Comment composer');
    await browser.pause(400);
    await typeText(browser, text);
    await browser.pause(300);
    await tapCoordinate(browser, commentSendX, commentSendY, 'Comment send');
    await browser.pause(900);
    console.log('Dismissing comment sheet after send (dismiss button then fallbacks)');
    await dismissCommentSheet(browser, isCommentSheetOpen);
}

async function swipeNext(browser: Browser): Promise<void> {
    const startY = Math.max(swipeStartY, Math.round(coordinates.screenSize.height * 0.72));
    const endY = Math.min(swipeEndY, Math.round(coordinates.screenSize.height * 0.22));
    const duration = Math.min(swipeDurationMs, 420);
    await browser.performActions([{
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
            { type: 'pointerMove', duration: 0, x: swipeAxisX, y: startY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 40 },
            { type: 'pointerMove', duration: duration, x: swipeAxisX, y: endY },
            { type: 'pointerUp', button: 0 },
        ],
    }]);
    await browser.releaseActions();
}

try {
    const remoteControl = new WdaRemoteControl({
        deviceUdid: udid,
        wdaUrl,
        passcodeKeypadLayout: coordinates.passcodeKeypad,
    });
    console.log('Checking device lock state');
    await remoteControl.unlock(udid);

    console.log(`Opening Instagram on ${udid}`);
    driver = await remote({
        hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
        port: positiveInteger('APPIUM_PORT', 4725),
        path: '/',
        logLevel: 'info',
        connectionRetryCount: 0,
        connectionRetryTimeout: 180000,
        capabilities,
    });

    await driver.updateSettings({ defaultActiveApplication: instagramBundleId });
    await driver.pause(3000);

    if (switchAccountName) {
        console.log(`Switching to Instagram account "${switchAccountName}"`);
        await switchInstagramAccount(driver, remoteControl, udid, switchAccountName, accountSwitchCoords);
    }

    // Always land on Reels For You before the agentic loop.
    await tapCoordinate(driver, reelsTabX, reelsTabY, 'Reels tab');
    await driver.pause(1500);

    const seedLike = { x: likeX, y: likeY };
    // Engagement refine still expects a paired save seed; Reels has no save tap.
    const seedSaveAnchor = { x: likeX, y: Math.min(likeY + 170, coordinates.screenSize.height - 80) };
    console.log(
        `Instagram Reels engagement seeds: like=(${seedLike.x}, ${seedLike.y})`
            + ` comment=(${commentX}, ${commentY}) reelsTab=(${reelsTabX}, ${reelsTabY})`
            + ` profile=${coordinateProfile(registeredDevice)}`
            + `${registeredDevice?.instagramCoordinates?.like || registeredDevice?.instagramCoordinates?.comment || registeredDevice?.instagramCoordinates?.reelsTab ? ' (calibrated)' : ''}`,
    );

    function applyEngagementSeeds(): void {
        likeX = seedLike.x;
        likeY = seedLike.y;
    }

    function applyDetectedEngagement(detected: { like: { x: number; y: number }; save: { x: number; y: number }; confidence: number }): void {
        ({ x: likeX, y: likeY } = detected.like);
        seedLike.x = likeX;
        seedLike.y = likeY;
        console.log(
            `Refined Instagram like control: like=(${likeX}, ${likeY})`
                + ` confidence=${detected.confidence.toFixed(3)}`,
        );
    }

    async function identifyReelsScreen(screenshot: Buffer, scale: number) {
        return identifyInstagramScreen(screenshot, scale, {
            like: seedLike,
            save: seedSaveAnchor,
        }, { preferredFeed: 'reels' });
    }

    async function isCommentSheetOpen(): Promise<boolean> {
        try {
            const [shot, screen] = await Promise.all([
                remoteControl.getScreenshot(udid),
                remoteControl.getScreenInfo(udid),
            ]);
            const identity = await identifyReelsScreen(shot, screen.scale);
            return identity.kind === 'comments';
        } catch {
            return false;
        }
    }

    async function relaunchInstagram(): Promise<void> {
        console.log('Relaunching Instagram to reset to Reels');
        recoveries += 1;
        try {
            await driver!.terminateApp(instagramBundleId);
        } catch (error) {
            console.log(`terminateApp: ${error instanceof Error ? error.message : String(error)}`);
        }
        await driver!.pause(900);
        await driver!.activateApp(instagramBundleId);
        await driver!.pause(3500);
        for (let tryActivate = 1; tryActivate <= 3; tryActivate++) {
            try {
                const state = await driver!.queryAppState(instagramBundleId);
                if (state === 4) break;
                console.log(`Instagram not foreground (state=${state}); activate retry ${tryActivate}`);
            } catch (error) {
                console.log(`queryAppState: ${error instanceof Error ? error.message : String(error)}`);
            }
            await driver!.activateApp(instagramBundleId);
            await driver!.pause(2500);
        }
        await tapCoordinate(driver!, reelsTabX, reelsTabY, 'Reels tab');
        await driver!.pause(1400);
    }

    async function tapReelsTabOnly(): Promise<void> {
        await tapCoordinate(driver!, reelsTabX, reelsTabY, 'Reels tab');
        await driver!.pause(1100);
    }

    async function ensureReelsFeed(maxAttempts = 6): Promise<boolean> {
        let softUnknownRetries = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (stopRequested) return false;
            let screenshot: Buffer;
            let scale: number;
            try {
                const [shot, screen] = await Promise.all([
                    remoteControl.getScreenshot(udid),
                    remoteControl.getScreenInfo(udid),
                ]);
                screenshot = shot;
                scale = screen.scale;
            } catch (error) {
                console.log(`Identify screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
                await relaunchInstagram();
                continue;
            }

            const identity = await identifyReelsScreen(screenshot, scale);
            console.log(
                `Screen identity: kind=${identity.kind} confidence=${identity.confidence.toFixed(2)}`
                + `${identity.reasons.length ? ` [${identity.reasons.join(', ')}]` : ''} attempt=${attempt}`,
            );

            if (identity.kind === 'reels') {
                softUnknownRetries = 0;
                return true;
            }

            if (identity.kind === 'comments') {
                console.log('Dismissing comment sheet');
                await dismissCommentSheet(driver!, isCommentSheetOpen);
                continue;
            }

            // Clear Home / Following — soft Reels tap, no full relaunch.
            if (identity.kind === 'home' || identity.kind === 'following') {
                console.log(`On ${identity.kind} — tapping Reels tab`);
                softUnknownRetries = 0;
                await tapReelsTabOnly();
                continue;
            }

            if ((identity.kind === 'off_feed' || identity.kind === 'search') && softUnknownRetries < 1) {
                softUnknownRetries += 1;
                console.log(`Transient ${identity.kind} — wait/re-check before relaunch`);
                await driver!.pause(900);
                continue;
            }

            softUnknownRetries = 0;
            await relaunchInstagram();
        }
        console.log('Could not recover to Reels feed after identify/relaunch attempts');
        return false;
    }

    async function settleAfterEngage(): Promise<void> {
        try {
            const [shot, screen] = await Promise.all([
                remoteControl.getScreenshot(udid),
                remoteControl.getScreenInfo(udid),
            ]);
            const identity = await identifyReelsScreen(shot, screen.scale);
            console.log(
                `Post-engage identity: kind=${identity.kind} confidence=${identity.confidence.toFixed(2)}`
                + `${identity.reasons.length ? ` [${identity.reasons.join(', ')}]` : ''}`,
            );
            if (identity.kind === 'reels') return;
            if (identity.kind === 'comments') {
                await dismissCommentSheet(driver!, isCommentSheetOpen);
                return;
            }
            if (identity.kind === 'home' || identity.kind === 'following') {
                await tapReelsTabOnly();
                return;
            }
            console.log(`Post-engage settle deferred (${identity.kind})`);
        } catch (error) {
            console.log(`Post-engage settle skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const deadline = Date.now() + durationMinutes * 60_000;

    while (!stopRequested && hasTimeRemaining(Date.now(), deadline)) {
        const onReels = await ensureReelsFeed();
        if (!onReels) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, 1200));
            continue;
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        videosViewed += 1;
        await cancellableDelay(clampToDeadline(Date.now(), deadline, pickWatchDurationMs(profile)));
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        const willLike = likeEnabled && decideLike(profile);
        const willComment = commentEnabled && decideComment(profile);

        if (willLike || willComment) {
            try {
                const [freshShot, screen] = await Promise.all([
                    remoteControl.getScreenshot(udid),
                    remoteControl.getScreenInfo(udid),
                ]);
                const identity = await identifyReelsScreen(freshShot, screen.scale);
                console.log(
                    `Pre-engage identity: kind=${identity.kind} confidence=${identity.confidence.toFixed(2)}`
                    + `${identity.reasons.length ? ` [${identity.reasons.join(', ')}]` : ''}`,
                );
                if (identity.kind === 'search' || identity.kind === 'off_feed'
                    || identity.kind === 'home' || identity.kind === 'following') {
                    console.log(`Skipping engage; recovering from ${identity.kind}`);
                    await ensureReelsFeed(2);
                    continue;
                }
                if (identity.kind === 'comments') {
                    console.log('Skipping engage; dismissing sheet');
                    await dismissCommentSheet(driver!, isCommentSheetOpen);
                    continue;
                }
                const detected = await detectEngagementControls(freshShot, screen.scale, {
                    like: seedLike,
                    save: seedSaveAnchor,
                });
                if (detected) applyDetectedEngagement(detected);
                else {
                    applyEngagementSeeds();
                    console.log(
                        `Could not refine Instagram like control; using seed like=(${likeX}, ${likeY})`,
                    );
                }
            } catch (error) {
                applyEngagementSeeds();
                console.log(
                    `Engagement refine failed; using seeds: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
        }

        if (willLike) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
            await tapCoordinate(driver, likeX, likeY, 'Like');
            likes += 1;
            await cancellableDelay(clampToDeadline(Date.now(), deadline, engagementSettleMs()));
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        if (willComment) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
            await postComment(driver, commentText, isCommentSheetOpen);
            comments += 1;
            await cancellableDelay(clampToDeadline(Date.now(), deadline, engagementSettleMs()));
            await settleAfterEngage();
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        const { linger, extraMs } = decideLinger(profile);
        if (linger) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, extraMs));
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        await swipeNext(driver);
        swipes += 1;
        await cancellableDelay(clampToDeadline(Date.now(), deadline, 550 + Math.round(Math.random() * 250)));
    }

    const elapsedMs = Date.now() - runStartedAt;
    const reason = stopRequested ? 'stopped' : 'completed';
    console.log(
        `Finished Instagram Reels doomscroll: videosViewed=${videosViewed} swipes=${swipes} likes=${likes}`
        + ` comments=${comments} recoveries=${recoveries}`
        + ` elapsedMs=${elapsedMs} reason=${reason}`,
    );
} finally {
    if (driver) {
        await driver.deleteSession();
    }
}
