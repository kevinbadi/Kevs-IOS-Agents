import { remote, type Browser } from 'webdriverio';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchTikTokAccount, tapCoordinate, typeText } from './actions.js';
import { detectEngagementControls } from './engagement-controls.js';
import { detectTikTokCarousel, identifyTikTokScreen } from './screen-identity.js';
import {
    PROFILES,
    clampToDeadline,
    decideComment,
    decideLike,
    decideLinger,
    decideSave,
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
const saveEnabled = booleanEnv('DOOMSCROLL_SAVE_ENABLED', true);
const commentEnabled = booleanEnv('DOOMSCROLL_COMMENT_ENABLED', false);
const commentText = (process.env.DOOMSCROLL_COMMENT_TEXT ?? '').trim();
if (commentEnabled && !commentText) {
    throw new Error('DOOMSCROLL_COMMENT_TEXT is required when DOOMSCROLL_COMMENT_ENABLED=true');
}
const switchAccountName = process.env.TIKTOK_SWITCH_ACCOUNT?.trim() || undefined;
const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === udid);
const coordinates = resolveDeviceCoordinates(coordinateProfile(registeredDevice), registeredDevice?.coordinates);
const tiktokCoordinates = coordinates.tiktok;
const accountSwitchCoords = {
    profileTabX: tiktokCoordinates.profileTab.x,
    profileTabY: tiktokCoordinates.profileTab.y,
    switcherTriggerX: tiktokCoordinates.accountSwitcher.x,
    switcherTriggerY: tiktokCoordinates.accountSwitcher.y,
};
// switchTikTokAccount ends on the Profile tab (it re-checks there to verify
// the switch). The scroll loop below expects the Home / For You feed.
const { x: homeTabX, y: homeTabY } = tiktokCoordinates.homeTab;
// For You sits right of Following. 0.62×width was landing on Following on
// current TikTok headers (false "on Following" recoveries then made it worse).
const forYouTabX = Math.round(coordinates.screenSize.width * 0.72);
const forYouTabY = tiktokCoordinates.followingTab.y;

// Fail fast, before unlocking or launching TikTok, if the requested account
// isn't one this device is registered for.
const allowedAccounts = switchAccountName
    ? registeredAccounts(registeredDevice)
    : [];
if (switchAccountName && !allowedAccounts.includes(switchAccountName)) {
    throw new Error(`TikTok account "${switchAccountName}" is not listed in devices.json for device ${udid}`);
}
let { x: likeX, y: likeY } = tiktokCoordinates.like;
let { x: saveX, y: saveY } = tiktokCoordinates.save;
const { x: commentX, y: commentY } = tiktokCoordinates.comment;
const { x: commentComposerX, y: commentComposerY } = tiktokCoordinates.commentComposer;
const { x: commentSendX, y: commentSendY } = tiktokCoordinates.commentSend;
const { x: swipeX, startY: swipeStartY, endY: swipeEndY, durationMs: swipeDurationMs } = tiktokCoordinates.swipe;
// Keep next-video swipes in the left third so micro X jitter does not advance
// photo carousels sideways. Same X locked for the whole gesture.
const swipeAxisX = Math.round(coordinates.screenSize.width * 0.32);
const wdaUrl = process.env.WDA_URL;
const tiktokBundleId = process.env.TIKTOK_BUNDLE_ID ?? 'com.zhiliaoapp.musically';

const registeredPlatform = registeredDevice?.platform ?? 'ios';

const capabilities: WebdriverIO.Capabilities & Record<string, unknown> = {
    platformName: registeredPlatform === 'android' ? 'Android' : 'iOS',
    'appium:automationName': registeredPlatform === 'android' ? 'UiAutomator2' : 'XCUITest',
    'appium:udid': udid,
    ...(registeredPlatform === 'android'
        ? { 'appium:appPackage': tiktokBundleId }
        : { 'appium:bundleId': tiktokBundleId }),
    'appium:noReset': true,
    'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true,
    'appium:newCommandTimeout': 120,
    'appium:wdaLaunchTimeout': 120000,
    'appium:wdaConnectionTimeout': 120000,
    // TikTok's video feed never becomes fully idle. Waiting for quiescence can
    // make otherwise-completed gestures block until the WDA proxy times out.
    'appium:waitForIdleTimeout': 0,
    'appium:showXcodeLog': process.env.SHOW_XCODE_LOG === 'true',
};

if (registeredPlatform === 'android') {
    delete capabilities['appium:waitForIdleTimeout'];
}

if (wdaUrl) {
    capabilities['appium:webDriverAgentUrl'] = wdaUrl;
    capabilities['appium:wdaRemotePort'] = positiveInteger('WDA_REMOTE_PORT', 8100);
} else if (process.env.XCODE_ORG_ID) {
    capabilities['appium:xcodeOrgId'] = process.env.XCODE_ORG_ID;
    capabilities['appium:xcodeSigningId'] = process.env.XCODE_SIGNING_ID ?? 'Apple Development';
}
if (!wdaUrl && process.env.WDA_BUNDLE_ID) {
    capabilities['appium:updatedWDABundleId'] = process.env.WDA_BUNDLE_ID;
}
if (!wdaUrl && process.env.ALLOW_PROVISIONING_DEVICE_REGISTRATION === 'true') {
    capabilities['appium:allowProvisioningDeviceRegistration'] = true;
}
if (!wdaUrl && process.env.WDA_BOOTSTRAP_PATH) {
    capabilities['appium:useXctestrunFile'] = true;
    capabilities['appium:bootstrapPath'] = process.env.WDA_BOOTSTRAP_PATH;
}

// Cooperative cancellation: a Stop request sends SIGTERM (see
// src/automations/runner.ts). Every wait below races against stopPromise so
// a stop interrupts immediately instead of waiting out the current sleep.
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

/** Longer settle so TikTok can finish heart/bookmark animations before the next tap or swipe. */
function engagementSettleMs(): number {
    return Math.round(750 + Math.random() * 850);
}

let driver: Browser | undefined;
let videosViewed = 0;
let swipes = 0;
let likes = 0;
let saves = 0;
let comments = 0;
let livesSkipped = 0;
let recoveries = 0;
let liveSwipeAttempts = 0;
const runStartedAt = Date.now();

console.log(
    `Starting doomscroll: profile=${personality} requestedDurationMinutes=${durationMinutes}`
    + ` likeEnabled=${likeEnabled} saveEnabled=${saveEnabled} commentEnabled=${commentEnabled}`,
);

async function dismissCommentSheet(
    driver: Browser,
    isStillOpen?: () => Promise<boolean>,
): Promise<void> {
    const width = coordinates.screenSize.width;
    const height = coordinates.screenSize.height;
    // Tap the exposed video above the sheet. Do NOT drag-down unconditionally —
    // once the sheet is gone that gesture reverses the FYP (previous video) and
    // fights swipeNext (next video), causing up/down oscillation.
    await tapCoordinate(
        driver,
        Math.round(width * 0.42),
        Math.round(height * 0.16),
        'Video above comments',
    );
    await driver.pause(550);
    if (!isStillOpen || !(await isStillOpen())) return;

    await tapCoordinate(
        driver,
        Math.round(width * 0.92),
        Math.round(height * 0.33),
        'Comment sheet close',
    );
    await driver.pause(550);
    if (!(await isStillOpen())) return;

    // Only drag the sheet itself while it is still open.
    const grabX = Math.round(width * 0.5);
    const grabY = Math.round(height * 0.36);
    console.log('Comment sheet still open — dragging it closed');
    await driver.performActions([{
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
    await driver.releaseActions();
    await driver.pause(500);
}

async function postComment(
    driver: Browser,
    text: string,
    isCommentSheetOpen?: () => Promise<boolean>,
): Promise<void> {
    await tapCoordinate(driver, commentX, commentY, 'Comment');
    await driver.pause(800);
    await tapCoordinate(driver, commentComposerX, commentComposerY, 'Comment composer');
    await driver.pause(400);
    await typeText(driver, text);
    await driver.pause(300);
    await tapCoordinate(driver, commentSendX, commentSendY, 'Comment send');
    await driver.pause(900);
    console.log('Dismissing comment sheet after send');
    await dismissCommentSheet(driver, isCommentSheetOpen);
}

async function swipeNext(driver: Browser): Promise<void> {
    // Pure vertical flick: identical X throughout. Left-of-center axis avoids
    // the engagement rail and reduces accidental carousel page-turns.
    const startY = Math.max(swipeStartY, Math.round(coordinates.screenSize.height * 0.72));
    const endY = Math.min(swipeEndY, Math.round(coordinates.screenSize.height * 0.22));
    const duration = Math.min(swipeDurationMs, 380);
    await driver.performActions([{
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
    await driver.releaseActions();
}

try {
    const remoteControl = new WdaRemoteControl({
        deviceUdid: udid,
        wdaUrl,
        passcodeKeypadLayout: coordinates.passcodeKeypad,
    });
    console.log('Checking device lock state');
    await remoteControl.unlock(udid);

    console.log(`Opening TikTok on ${udid}`);
    driver = await remote({
        hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
        port: positiveInteger('APPIUM_PORT', 4725),
        path: '/',
        logLevel: 'info',
        connectionRetryCount: 0,
        connectionRetryTimeout: 180000,
        capabilities,
    });

    await driver.updateSettings({ defaultActiveApplication: tiktokBundleId });
    await driver.pause(3000);

    if (switchAccountName) {
        console.log(`Switching to TikTok account "${switchAccountName}"`);
        await switchTikTokAccount(driver, remoteControl, udid, switchAccountName, accountSwitchCoords);
        // switchTikTokAccount leaves the app on the Profile tab; the loop
        // below expects the Home feed.
        await tapCoordinate(driver, homeTabX, homeTabY, 'Home tab');
        await driver.pause(1500);
    }

    // Seeds from profile + optional dashboard calibration. Each FYP video
    // re-detects near these points so rail drift does not hit the LIVE avatar.
    const seedLike = { x: likeX, y: likeY };
    const seedSave = { x: saveX, y: saveY };
    console.log(
        `TikTok engagement seeds: like=(${seedLike.x}, ${seedLike.y}) save=(${seedSave.x}, ${seedSave.y})`
            + ` profile=${coordinateProfile(registeredDevice)}`
            + `${registeredDevice?.coordinates?.like || registeredDevice?.coordinates?.save ? ' (calibrated)' : ''}`,
    );

    function applyEngagementSeeds(): void {
        likeX = seedLike.x;
        likeY = seedLike.y;
        saveX = seedSave.x;
        saveY = seedSave.y;
    }

    function applyDetectedEngagement(detected: { like: { x: number; y: number }; save: { x: number; y: number }; confidence: number }): void {
        ({ x: likeX, y: likeY } = detected.like);
        ({ x: saveX, y: saveY } = detected.save);
        seedLike.x = likeX;
        seedLike.y = likeY;
        seedSave.x = saveX;
        seedSave.y = saveY;
        console.log(
            `Refined TikTok engagement controls: like=(${likeX}, ${likeY}) save=(${saveX}, ${saveY})`
                + ` confidence=${detected.confidence.toFixed(3)}`,
        );
    }

    async function isCommentSheetOpen(): Promise<boolean> {
        try {
            const [shot, screen] = await Promise.all([
                remoteControl.getScreenshot(udid),
                remoteControl.getScreenInfo(udid),
            ]);
            const identity = await identifyTikTokScreen(shot, screen.scale, {
                like: seedLike,
                save: seedSave,
            }, { preferredFeed: 'forYou' });
            return identity.kind === 'comments';
        } catch {
            return false;
        }
    }

    /**
     * Screenshot → classify → recover until we are on FYP.
     * Off-FYP recovery relaunches TikTok — chasing Live X is brittle because
     * that same top-right slot becomes Search on the For You feed.
     */
    async function relaunchTikTok(): Promise<void> {
        console.log('Relaunching TikTok to reset to For You');
        recoveries += 1;
        try {
            await driver!.terminateApp(tiktokBundleId);
        } catch (error) {
            console.log(`terminateApp: ${error instanceof Error ? error.message : String(error)}`);
        }
        await driver!.pause(900);
        await driver!.activateApp(tiktokBundleId);
        await driver!.pause(3500);
        // After a popup/terminate we can land on SpringBoard if activate races.
        for (let tryActivate = 1; tryActivate <= 3; tryActivate++) {
            try {
                const state = await driver!.queryAppState(tiktokBundleId);
                if (state === 4) break;
                console.log(`TikTok not foreground (state=${state}); activate retry ${tryActivate}`);
            } catch (error) {
                console.log(`queryAppState: ${error instanceof Error ? error.message : String(error)}`);
            }
            await driver!.activateApp(tiktokBundleId);
            await driver!.pause(2500);
        }
    }

    async function ensureForYouFeed(maxAttempts = 6): Promise<boolean> {
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
                await relaunchTikTok();
                continue;
            }

            const identity = await identifyTikTokScreen(screenshot, scale, {
                like: seedLike,
                save: seedSave,
            }, { preferredFeed: 'forYou' });
            console.log(
                `Screen identity: kind=${identity.kind} confidence=${identity.confidence.toFixed(2)}`
                + `${identity.reasons.length ? ` [${identity.reasons.join(', ')}]` : ''} attempt=${attempt}`,
            );

            if (identity.kind === 'fyp') {
                liveSwipeAttempts = 0;
                softUnknownRetries = 0;
                return true;
            }

            // Comment / collections sheets are cheap to dismiss without a full relaunch.
            if (identity.kind === 'comments') {
                console.log('Dismissing comment/collections sheet');
                await dismissCommentSheet(driver!, isCommentSheetOpen);
                continue;
            }

            // Live: swipe past first (cheap). Only relaunch if we stay on Live.
            if (identity.kind === 'live') {
                if (liveSwipeAttempts === 0) livesSkipped += 1;
                if (liveSwipeAttempts < 2) {
                    liveSwipeAttempts += 1;
                    console.log(`Live detected — swipe past attempt ${liveSwipeAttempts}/2`);
                    await swipeNext(driver!);
                    swipes += 1;
                    await driver!.pause(900);
                    continue;
                }
                console.log('Still on Live after swipe attempts — relaunching TikTok');
                liveSwipeAttempts = 0;
                await relaunchTikTok();
                continue;
            }

            // Clear Following only — tap For You without a full relaunch.
            if (identity.kind === 'following' && identity.reasons.includes('followingTabSelected')) {
                console.log('On Following — switching to For You tab');
                liveSwipeAttempts = 0;
                softUnknownRetries = 0;
                await tapCoordinate(driver!, forYouTabX, forYouTabY, 'For You tab');
                await driver!.pause(1200);
                continue;
            }

            if ((identity.kind === 'off_feed' || identity.kind === 'search') && softUnknownRetries < 1) {
                softUnknownRetries += 1;
                console.log(`Transient ${identity.kind} — wait/re-check before relaunch`);
                await driver!.pause(900);
                continue;
            }

            liveSwipeAttempts = 0;
            softUnknownRetries = 0;
            // Search / SpringBoard / unrecognized — kill and reopen onto Home/FYP.
            await relaunchTikTok();
        }
        console.log('Could not recover to For You feed after identify/relaunch attempts');
        return false;
    }

    async function settleAfterEngage(): Promise<void> {
        try {
            const [shot, screen] = await Promise.all([
                remoteControl.getScreenshot(udid),
                remoteControl.getScreenInfo(udid),
            ]);
            const identity = await identifyTikTokScreen(shot, screen.scale, {
                like: seedLike,
                save: seedSave,
            }, { preferredFeed: 'forYou' });
            console.log(
                `Post-engage identity: kind=${identity.kind} confidence=${identity.confidence.toFixed(2)}`
                + `${identity.reasons.length ? ` [${identity.reasons.join(', ')}]` : ''}`,
            );
            if (identity.kind === 'fyp') return;
            if (identity.kind === 'comments') {
                await dismissCommentSheet(driver!, isCommentSheetOpen);
                return;
            }
            if (identity.kind === 'following' && identity.reasons.includes('followingTabSelected')) {
                await tapCoordinate(driver!, forYouTabX, forYouTabY, 'For You tab');
                await driver!.pause(1100);
                return;
            }
            console.log(`Post-engage settle deferred (${identity.kind})`);
        } catch (error) {
            console.log(`Post-engage settle skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const deadline = Date.now() + durationMinutes * 60_000;

    // Agentic loop: identify → watch → engage → scroll.
    // Relaunch only when identify hard-fails off FYP (Live/Search), not every clip.
    while (!stopRequested && hasTimeRemaining(Date.now(), deadline)) {
        const onFyp = await ensureForYouFeed();
        if (!onFyp) {
            // Do not swipe on SpringBoard — only relaunch/retry.
            await cancellableDelay(clampToDeadline(Date.now(), deadline, 1200));
            continue;
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        videosViewed += 1;

        // Carousels: short glance then engage/swipe — full watch durations feel stuck.
        let carousel = false;
        try {
            const [shot] = await Promise.all([remoteControl.getScreenshot(udid)]);
            carousel = await detectTikTokCarousel(shot);
            if (carousel) console.log('Carousel detected — short watch then engage/swipe');
        } catch (error) {
            console.log(`Carousel detect skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
        const watchMs = carousel
            ? Math.round(700 + Math.random() * 700)
            : pickWatchDurationMs(profile);
        await cancellableDelay(clampToDeadline(Date.now(), deadline, watchMs));
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        // Carousel bias is for natural profiles only — DIALED always engages fully.
        const willLike = likeEnabled && (
            personality === 'dialed' ? decideLike(profile)
                : carousel ? Math.random() < 0.85 : decideLike(profile)
        );
        const willSave = saveEnabled && (
            personality === 'dialed' ? decideSave(profile)
                : carousel ? Math.random() < 0.35 : decideSave(profile)
        );
        const willComment = commentEnabled && (
            personality === 'dialed' ? decideComment(profile)
                : !carousel && decideComment(profile)
        );

        if (willLike || willSave || willComment) {
            try {
                const [freshShot, screen] = await Promise.all([
                    remoteControl.getScreenshot(udid),
                    remoteControl.getScreenInfo(udid),
                ]);
                const identity = await identifyTikTokScreen(freshShot, screen.scale, {
                    like: seedLike,
                    save: seedSave,
                }, { preferredFeed: 'forYou' });
                console.log(
                    `Pre-engage identity: kind=${identity.kind} confidence=${identity.confidence.toFixed(2)}`
                    + `${identity.reasons.length ? ` [${identity.reasons.join(', ')}]` : ''}`,
                );
                if (identity.kind === 'live' || identity.kind === 'search' || identity.kind === 'off_feed'
                    || (identity.kind === 'following' && identity.reasons.includes('followingTabSelected'))) {
                    console.log(`Skipping engage; recovering from ${identity.kind}`);
                    await ensureForYouFeed(2);
                    continue;
                }
                if (identity.kind === 'comments') {
                    console.log('Skipping engage; dismissing sheet');
                    await dismissCommentSheet(driver!, isCommentSheetOpen);
                    continue;
                }
                const detected = await detectEngagementControls(freshShot, screen.scale, {
                    like: seedLike,
                    save: seedSave,
                });
                if (detected) applyDetectedEngagement(detected);
                else {
                    applyEngagementSeeds();
                    console.log(
                        `Could not refine TikTok engagement controls; using seeds like=(${likeX}, ${likeY}) save=(${saveX}, ${saveY})`,
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

        if (willSave) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, interactionPauseMs()));
            if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;
            await tapCoordinate(driver, saveX, saveY, 'Save');
            saves += 1;
            await cancellableDelay(clampToDeadline(Date.now(), deadline, engagementSettleMs()));
            // Collections / "added to favorites" sheets often appear after save.
            await settleAfterEngage();
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        const { linger, extraMs } = decideLinger(profile);
        if (!carousel && linger) {
            await cancellableDelay(clampToDeadline(Date.now(), deadline, extraMs));
        }
        if (stopRequested || !hasTimeRemaining(Date.now(), deadline)) break;

        await swipeNext(driver);
        swipes += 1;
        // Brief settle only — long pauses after swipe make carousels feel sticky.
        await cancellableDelay(clampToDeadline(Date.now(), deadline, carousel ? 350 : 550 + Math.round(Math.random() * 250)));
    }

    const elapsedMs = Date.now() - runStartedAt;
    const reason = stopRequested ? 'stopped' : 'completed';
    console.log(
        `Finished doomscroll: videosViewed=${videosViewed} swipes=${swipes} likes=${likes}`
        + ` saves=${saves} comments=${comments} livesSkipped=${livesSkipped} recoveries=${recoveries}`
        + ` elapsedMs=${elapsedMs} reason=${reason}`,
    );
} finally {
    if (driver) {
        await driver.deleteSession();
    }
}
