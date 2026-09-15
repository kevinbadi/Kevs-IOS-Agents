/**
 * LinkedIn connection runner. Two modes:
 *   note  — Cold connect (personalized note). Never taps Add note to invitation
 *           unless the note composer is on screen.
 *   plain — Connection request. Free LinkedIn still shows "Add a note or
 *           connect now" until the 5 monthly notes are used; we always tap
 *           Send without note and never open the composer.
 *           Confirms with Pending / Invitation sent.
 *
 *   IOS_UDID=… WDA_URL=http://127.0.0.1:8101 \
 *     LINKEDIN_LEADS_CSV=data/linkedin/leads/result.csv \
 *     LINKEDIN_CONNECT_NOTE='Hi {firstName}, we are doing some cool things in marketing and want to connect' \
 *     npm run linkedin:cold-connect
 *
 *   LINKEDIN_LEADS_CSV=data/linkedin/leads/connect.csv npm run linkedin:connect
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadRegisteredDevices, resolveDeviceCoordinates, WdaRemoteControl } from '@git-agni/phone-farm-core';
import { passcodeForDevice } from '../devices/secrets.js';
import { coordinateProfile } from '../instagram/runtime-settings.js';
import { pointFromWord, recognizeWords, type OcrWord } from '../instagram/ocr.js';
import { LINKEDIN_BUNDLE_ID, type LinkedInCalibratablePoint } from './coordinates.js';
import { classifyLinkedInScreen, type LinkedInScreenKind } from './screen.js';
import {
    connectNoteForLead,
    DEFAULT_CONNECT_NOTE,
    LINKEDIN_CONNECTS_PER_RUN,
    loadLinkedInContactState,
    markLinkedInContact,
    parseConnectsPerRun,
    parseLinkedInLeadsCsv,
    pickUncontacted,
    saveLinkedInContactState,
    searchQueryForLead,
    validateConnectNote,
    type LinkedInContactState,
    type LinkedInLead,
} from './leads.js';
import {
    verifyConnectSheet,
    verifyNoteReady,
    verifyPlainConnectSent,
    verifyProfile,
    verifyProfileMenu,
} from './verify.js';

const deviceUdid = process.env.IOS_UDID;
if (!deviceUdid) throw new Error('IOS_UDID is required');
const udid: string = deviceUdid;
const wdaUrl = process.env.WDA_URL;
const connectMode = process.env.LINKEDIN_CONNECT_MODE === 'plain' ? 'plain' : 'note';
const pauseMs = Number(process.env.LINKEDIN_COLD_CONNECT_PAUSE_MS ?? 1400);
const outRoot = process.env.LINKEDIN_COLD_CONNECT_DIR
    ?? path.resolve('data', 'linkedin', connectMode === 'plain' ? 'connect' : 'cold-connect');
const csvPath = process.env.LINKEDIN_LEADS_CSV
    ?? path.resolve('data', 'linkedin', 'leads', connectMode === 'plain' ? 'connect.csv' : 'result.csv');
const noteTemplate = connectMode === 'plain'
    ? ''
    : validateConnectNote(process.env.LINKEDIN_CONNECT_NOTE ?? DEFAULT_CONNECT_NOTE);
const connectsPerRun = parseConnectsPerRun(process.env.LINKEDIN_LEAD_LIMIT ?? LINKEDIN_CONNECTS_PER_RUN);
const statePath = process.env.LINKEDIN_LEADS_STATE
    ?? path.join(path.dirname(csvPath), 'state.json');

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
    passcode: await passcodeForDevice(udid),
    passcodeKeypadLayout: resolved.passcodeKeypad,
});

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const sessionDir = path.join(outRoot, runId);
await mkdir(sessionDir, { recursive: true });

const catalog = parseLinkedInLeadsCsv(await readFile(csvPath, 'utf8'));
let contactState: LinkedInContactState = await loadLinkedInContactState(statePath);
const leadNameFilter = process.env.LINKEDIN_LEAD_NAME?.trim().toLowerCase();
const leads = leadNameFilter
    ? catalog.filter((lead) => lead.fullName.toLowerCase().includes(leadNameFilter)).slice(0, 1)
    : pickUncontacted(catalog, contactState, catalog.length);
if (leads.length === 0) {
    throw new Error(leadNameFilter
        ? `No LinkedIn lead matching "${process.env.LINKEDIN_LEAD_NAME}" in ${csvPath}`
        : `No uncontacted LinkedIn leads in ${csvPath}`);
}

type LeadResult = { lead: string; status: 'sent' | 'skipped' | 'failed'; reason?: string };

async function pause(ms = pauseMs): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function findLabel(
    words: OcrWord[],
    pattern: RegExp,
    scale: number,
    band?: [number, number],
): { x: number; y: number; text: string } | undefined {
    const word = words.find((entry) => {
        if (!pattern.test(entry.text.trim())) return false;
        if (!band) return true;
        const y = (entry.y + entry.height / 2) / scale;
        return y >= band[0] && y <= band[1];
    });
    if (!word) return undefined;
    return { ...pointFromWord(word, scale), text: word.text };
}

/** ⋯ sits on the Follow/Message row. OCR usually reads it as © / …, or we use the Follow +. */
function findProfileMenuTarget(words: OcrWord[], scale: number): { x: number; y: number } {
    for (const entry of words) {
        const x = (entry.x + entry.width / 2) / scale;
        const y = (entry.y + entry.height / 2) / scale;
        const text = entry.text.trim();
        if (x < 315 || x > 385 || y < 360 || y > 640) continue;
        if (/^(\.{2,4}|[⋯…·©®°*])$/.test(text)) {
            return { x: Math.round(x), y: Math.round(y) };
        }
    }
    const pluses: number[] = [];
    for (const entry of words) {
        const x = (entry.x + entry.width / 2) / scale;
        const y = (entry.y + entry.height / 2) / scale;
        if (x > 300 || y < 360 || y > 560) continue;
        if (/^\+$/.test(entry.text.trim())) pluses.push(y);
    }
    if (pluses.length > 0) return { x: 348, y: Math.round(Math.min(...pluses)) };
    const message = findLabel(words, /message/i, scale, [360, 640]);
    if (message) return { x: 348, y: message.y };
    let rowY: number | undefined;
    for (const entry of words) {
        const y = (entry.y + entry.height / 2) / scale;
        if (y < 300 || y > 560) continue;
        if (/^(mutual|connections?|followers)$/i.test(entry.text.trim())) rowY = y;
    }
    if (rowY !== undefined) return { x: 348, y: Math.round(rowY + 70) };
    const about = findLabel(words, /^About$/i, scale, [450, 780]);
    if (about && about.x < 120) return { x: 348, y: Math.round(Math.max(400, about.y - 150)) };
    return { x: li.profileMenu.x, y: li.profileMenu.y };
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

async function typeText(wdaSession: string, text: string): Promise<void> {
    await remote.request(`/session/${wdaSession}/wda/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [text] }),
    });
}

async function snapshot(label: string): Promise<{ kind: LinkedInScreenKind; words: OcrWord[]; scale: number }> {
    const image = await remote.getScreenshot(udid);
    const { scale } = await remote.getScreenInfo(udid);
    const words = await recognizeWords(image);
    const screen = classifyLinkedInScreen(words, { scale });
    await writeFile(path.join(sessionDir, `${label}.png`), image);
    console.log(`${label} → ${screen.kind}`);
    return { kind: screen.kind, words, scale };
}

async function tap(name: LinkedInCalibratablePoint, label: string): Promise<void> {
    const point = li[name];
    console.log(`Tap ${label} (${point.x}, ${point.y})`);
    await remote.performAction(udid, { type: 'tap', x: point.x, y: point.y });
    await pause();
}

async function tapPoint(x: number, y: number, label: string): Promise<void> {
    console.log(`Tap ${label} (${x}, ${y})`);
    await remote.performAction(udid, { type: 'tap', x, y });
    await pause();
}

async function dismissMeDrawer(): Promise<void> {
    const x = Math.round(li.screenSize.width * 0.94);
    const y = Math.round(li.screenSize.height * 0.48);
    await tapPoint(x, y, 'Dismiss Me drawer');
}

async function dismissSheet(): Promise<void> {
    const x = Math.round(li.screenSize.width * 0.5);
    console.log(`Swipe down to dismiss sheet (${x}, 340 → 780)`);
    await remote.performAction(udid, {
        type: 'swipe', startX: x, startY: 340, endX: x, endY: 780, durationMs: 350,
    });
    await pause();
}

/** Get off Me / leftover sheets / profiles and onto Recents search before typing. */
async function openSearch(label: string): Promise<boolean> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const screen = await snapshot(`${label}-nav-${attempt}`);
        if (screen.kind === 'search') return true;
        if (screen.kind === 'me-drawer') {
            await dismissMeDrawer();
            continue;
        }
        if (screen.kind === 'member-sheet' || screen.kind === 'connect-sheet' || screen.kind === 'connect-note') {
            await dismissSheet();
            continue;
        }
        if (screen.kind === 'me' || screen.kind === 'profile' || screen.kind === 'profile-menu' || screen.kind === 'connect-sent') {
            await tap('homeTab', 'Home');
            continue;
        }
        if (screen.kind === 'home') {
            await tap('searchField', 'Search bar');
            await pause(800);
            continue;
        }
        await tap('homeTab', 'Home');
        await pause(400);
        await tap('searchField', 'Search bar');
        await pause(800);
    }
    const last = await snapshot(`${label}-nav-final`);
    return last.kind === 'search';
}

async function tapSendWithoutNote(words?: OcrWord[], scale?: number): Promise<void> {
    const sendPlain = words && scale
        ? findLabel(words, /^without$/i, scale, [680, 840])
            ?? findLabel(words, /^Send$/i, scale, [700, 820])
        : undefined;
    const point = sendPlain ?? { x: li.sendWithoutNote.x, y: li.sendWithoutNote.y };
    await tapPoint(point.x, point.y, 'Send without note');
}

async function bail(lead: LinkedInLead, reason: string): Promise<LeadResult> {
    console.log(`Cross off ${lead.fullName}: ${reason}`);
    try {
        await tap('homeTab', 'Home');
    } catch {
        // still record the skip
    }
    return { lead: lead.fullName, status: 'skipped', reason };
}

async function processLead(
    lead: LinkedInLead,
    index: number,
    wdaSession: string,
): Promise<LeadResult> {
    const query = searchQueryForLead(lead);
    const note = connectMode === 'plain' ? '' : connectNoteForLead(lead, noteTemplate);
    const tag = String(index + 1).padStart(2, '0');
    console.log(`\nLead ${index + 1}: ${lead.fullName} (${lead.degree || 'unknown'})`);
    console.log(`Search "${query}"`);

    const opened = await openSearch(tag);
    if (!opened) return bail(lead, 'could not open search');
    await tap('searchField', 'Search bar');
    await pause(400);
    await typeText(wdaSession, '\b'.repeat(48));
    await pause(300);
    await typeText(wdaSession, query);
    await pause(2000);
    const afterQuery = await snapshot(`${tag}-01-search`);
    let profile = afterQuery;
    if (!(verifyProfile(profile.kind, profile.words, lead).ok)) {
        const people = findLabel(afterQuery.words, /^People$/i, afterQuery.scale, [90, 170]);
        if (people) await tapPoint(people.x, people.y, 'People filter');
        else await tap('searchPeopleFilter', 'People filter');
        await pause(1200);
        profile = await snapshot(`${tag}-02-results`);
    }
    if (!(verifyProfile(profile.kind, profile.words, lead).ok)) {
        await tap('searchFirstResult', 'Select person');
        profile = await snapshot(`${tag}-03-profile`);
    }

    const onProfile = verifyProfile(profile.kind, profile.words, lead);
    if (!onProfile.ok) {
        if (onProfile.reason === 'already pending') {
            await tap('homeTab', 'Home');
            return { lead: lead.fullName, status: 'sent', reason: 'already pending' };
        }
        return bail(lead, onProfile.reason ?? 'not on profile');
    }

    let sheet: { kind: LinkedInScreenKind; words: OcrWord[]; scale: number } | undefined;
    const visibleConnect = findLabel(profile.words, /^Connect$/i, profile.scale, [220, 640]);
    if (visibleConnect) {
        await tapPoint(visibleConnect.x, visibleConnect.y, 'Connect');
    } else {
        const dots = findProfileMenuTarget(profile.words, profile.scale);
        let menu = profile;
        let openedMenu = false;
        for (const [offsetIndex, y] of [dots.y, dots.y - 16, dots.y + 16].entries()) {
            await tapPoint(dots.x, y, 'Click profile menu');
            menu = await snapshot(`${tag}-04-menu-${offsetIndex}`);
            if (menu.kind === 'connect-sheet') {
                sheet = menu;
                break;
            }
            if (menu.kind === 'profile-menu') {
                openedMenu = true;
                break;
            }
            if (menu.kind === 'member-sheet') await dismissSheet();
        }
        if (!sheet && openedMenu) {
            if (findLabel(menu.words, /^Pending$/i, menu.scale, [400, 700])) {
                await tap('homeTab', 'Home');
                return { lead: lead.fullName, status: 'sent', reason: 'already pending' };
            }
            const menuConnect = findLabel(menu.words, /^Connect$/i, menu.scale, [400, 640]);
            if (menuConnect) {
                await tapPoint(menuConnect.x, menuConnect.y, 'Connect');
            } else {
                // 2nd degree: Connect is on the profile (same row as ⋯). Menu shows Follow.
                await dismissSheet();
                await tapPoint(li.follow.x, dots.y, 'Connect');
            }
        } else if (!sheet) {
            return bail(lead, 'profile menu did not open');
        }
    }

    if (connectMode === 'plain') {
        console.log('Sheet up — tapping Send without note now');
        if (sheet) {
            await tapSendWithoutNote(sheet.words, sheet.scale);
        } else {
            await pause(500);
            await tapSendWithoutNote();
        }
        await pause(400);
        let after = await snapshot(`${tag}-06-sent`);
        if (after.kind === 'profile-menu') {
            const retryConnect = findLabel(after.words, /^Connect$/i, after.scale, [400, 640]);
            if (retryConnect) {
                await tapPoint(retryConnect.x, retryConnect.y, 'Connect');
                await pause(500);
                await tapSendWithoutNote();
                await pause(400);
                after = await snapshot(`${tag}-06-retry-connect`);
            }
        }
        if (after.kind === 'connect-sheet') {
            await tapSendWithoutNote(after.words, after.scale);
            await pause(400);
            after = await snapshot(`${tag}-06-retry`);
        }
        const confirmed = verifyPlainConnectSent(after.kind, after.words, lead);
        if (!confirmed.ok) return bail(lead, confirmed.reason ?? 'send not confirmed');
        await tap('homeTab', 'Home');
        return { lead: lead.fullName, status: 'sent' };
    }

    if (!sheet) sheet = await snapshot(`${tag}-05-sheet`);
    const onSheet = verifyConnectSheet(sheet.kind);
    if (!onSheet.ok) return bail(lead, onSheet.reason ?? 'not on send-request sheet');

    const addNote = findLabel(sheet.words, /^Add$/i, sheet.scale, [640, 780])
        ?? { x: li.addANote.x, y: li.addANote.y, text: 'Add note (calibrated)' };
    await tapPoint(addNote.x, addNote.y, 'Add note');
    await pause(800);
    await tap('noteComposer', 'Note field');
    await typeText(wdaSession, note.slice(0, 200));
    await pause(800);
    const composer = await snapshot(`${tag}-06-note`);
    const ready = verifyNoteReady(composer.kind);
    if (!ready.ok) return bail(lead, ready.reason ?? 'note composer not ready');
    const send = findLabel(composer.words, /^Add$/i, composer.scale, [380, 520])
        ?? findLabel(composer.words, /^invitation$/i, composer.scale, [380, 520])
        ?? { x: li.sendInvitation.x, y: li.sendInvitation.y, text: 'Add note to invitation (calibrated)' };
    await tapPoint(send.x, send.y, 'Add note to invitation');
    await snapshot(`${tag}-07-sent`);
    await tap('homeTab', 'Home');
    return { lead: lead.fullName, status: 'sent' };
}

console.log(`LinkedIn ${connectMode === 'plain' ? 'connection request' : 'cold-connect'} ${runId} → ${sessionDir}`);
console.log(`Device ${udid} · ${resolved.displayName} · ${connectsPerRun} connects this run · ${leads.length} remaining`);
if (leadNameFilter) console.log(`Only lead: ${leads[0]?.fullName}`);
if (connectMode === 'plain') {
    console.log('Mode: Send without note (no invitation note)');
} else {
    console.log(`Note: ${noteTemplate}`);
}

let wdaSession: string | undefined;
const results: LeadResult[] = [];
let sent = 0;
try {
    try {
        await remote.unlock(udid);
    } catch (error) {
        console.log(`Unlock skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    wdaSession = await launchLinkedIn();
    if (!wdaSession) throw new Error('WebDriverAgent session is required to type');
    await pause(2500);
    await openSearch('boot');

    for (const [index, lead] of leads.entries()) {
        if (sent >= connectsPerRun) break;
        try {
            const result = await processLead(lead, index, wdaSession);
            results.push(result);
            contactState = markLinkedInContact(contactState, lead, result.status, result.reason);
            await saveLinkedInContactState(statePath, contactState);
            if (result.status === 'sent') sent += 1;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn(`Failed ${lead.fullName}: ${reason}`);
            results.push({ lead: lead.fullName, status: 'failed', reason });
            contactState = markLinkedInContact(contactState, lead, 'failed', reason);
            await saveLinkedInContactState(statePath, contactState);
            try {
                await tap('homeTab', 'Home after failure');
            } catch {
                // keep going
            }
        }
    }
} finally {
    if (wdaSession) {
        await remote.request(`/session/${wdaSession}`, { method: 'DELETE' }).catch(() => {});
    }
}

await writeFile(path.join(sessionDir, 'run.json'), JSON.stringify({
    udid, runId, csvPath, connectMode, noteTemplate: noteTemplate || undefined, connectsPerRun, results, sent,
}, null, 2));
console.log(`\nFinished. sent=${sent}/${connectsPerRun} skipped=${results.filter((entry) => entry.status === 'skipped').length} failed=${results.filter((entry) => entry.status === 'failed').length}`);
for (const entry of results) {
    console.log(`  ${entry.status.padEnd(8)} ${entry.lead}${entry.reason ? ` — ${entry.reason}` : ''}`);
}
