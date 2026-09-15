import assert from 'node:assert/strict';
import test from 'node:test';

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { classifyLinkedInScreen } from '../src/linkedin/screen.js';
import { LINKEDIN_CALIBRATABLE_POINTS, LINKEDIN_IPHONE13, linkedinForScreen } from '../src/linkedin/coordinates.js';
import {
    LINKEDIN_COLD_CONNECT, LINKEDIN_CONNECT, linkedinLabelsForWorkflow, linkedinPointsForWorkflow, parseLinkedInWorkflow,
} from '../src/linkedin/workflows.js';
import { connectNoteForLead, DEFAULT_CONNECT_NOTE, markLinkedInContact, parseLinkedInLeadsCsv, pickUncontacted } from '../src/linkedin/leads.js';
import { leadNameOnScreen, verifyNoteReady, verifyPlainConnectSent, verifyProfile } from '../src/linkedin/verify.js';
import type { OcrWord } from '../src/instagram/ocr.js';

const w = (text: string, xPt: number, yPt: number): OcrWord => ({
    text, x: (xPt - 10) * 3, y: (yPt - 8) * 3, width: 80, height: 36, confidence: 90,
});
const opts = { scale: 3 };

test('linkedin calibratable points exist on the iPhone 13 seed', () => {
    for (const name of LINKEDIN_CALIBRATABLE_POINTS) {
        const point = LINKEDIN_IPHONE13[name];
        assert.equal(typeof point.x, 'number', name);
        assert.equal(typeof point.y, 'number', name);
        assert.ok(point.x >= 0 && point.x <= 390, name);
        assert.ok(point.y >= 0 && point.y <= 844, name);
    }
});

test('linkedinForScreen identity-keeps 390×844 and scales 402×874', () => {
    assert.equal(linkedinForScreen({ width: 390, height: 844 }), LINKEDIN_IPHONE13);
    const scaled = linkedinForScreen({ width: 402, height: 874 });
    assert.equal(scaled.screenSize.width, 402);
    assert.ok(scaled.homeTab.y > LINKEDIN_IPHONE13.homeTab.y);
});

test('network / notifications / jobs titles', () => {
    assert.equal(classifyLinkedInScreen([w('Grow', 98, 115), w('Catchup', 293, 116)], opts).kind, 'network');
    assert.equal(classifyLinkedInScreen([w('Invitations', 80, 161), w('Manage', 43, 536)], opts).kind, 'network');
    assert.equal(classifyLinkedInScreen([w('Notifications', 60, 70)], opts).kind, 'notifications');
    assert.equal(classifyLinkedInScreen([w('Jobs', 40, 70), w('Easy', 80, 260)], opts).kind, 'jobs');
});

test('connect sheet, invitation sent, and note composer', () => {
    assert.equal(classifyLinkedInScreen([w('without', 195, 790), w('note', 250, 790)], opts).kind, 'connect-sheet');
    assert.equal(classifyLinkedInScreen([w('Invitation', 80, 80), w('sent', 180, 80)], opts).kind, 'connect-sent');
    assert.equal(classifyLinkedInScreen([w('invitation', 195, 430), w('Premium', 195, 200), w('200', 350, 180)], opts).kind, 'connect-note');
    assert.equal(classifyLinkedInScreen([w('Personalize', 80, 560), w('Connect', 80, 502), w('Contact', 80, 450)], opts).kind, 'profile-menu');
});

test('search vs home header', () => {
    assert.equal(classifyLinkedInScreen([w('Search', 175, 68), w('People', 70, 120), w('Posts', 160, 120)], opts).kind, 'search');
    assert.equal(classifyLinkedInScreen([w('Recent', 43, 110), w('Showall', 297, 109)], opts).kind, 'search');
    assert.equal(classifyLinkedInScreen([w('Search', 175, 68)], opts).kind, 'home');
});

test('profile with Search header is not the home feed', () => {
    assert.equal(classifyLinkedInScreen([
        w('Search', 99, 69), w('Ross', 132, 272), w('2nd', 209, 271), w('followers', 97, 412),
        w('©', 358, 485), w('Highlights', 64, 554), w('About', 44, 722),
    ], opts).kind, 'profile');
    assert.equal(classifyLinkedInScreen([
        w('Search', 99, 69), w('Kidd', 105, 272), w('3rd', 151, 271), w('connections', 86, 368),
        w('©', 358, 409), w('Activity', 51, 479),
    ], opts).kind, 'profile');
    assert.equal(classifyLinkedInScreen([
        w('Search', 98, 69), w('Capova', 142, 273), w('About', 44, 632),
    ], opts).kind, 'profile');
});

test('hidden-connect profile is not the home feed', () => {
    assert.equal(classifyLinkedInScreen([
        w('Search', 175, 68), w('Saleel', 49, 272), w('connections', 97, 406),
        w('Open', 46, 501), w('work', 101, 499), w('About', 44, 602),
    ], opts).kind, 'profile');
});

test('About this member sheet', () => {
    assert.equal(classifyLinkedInScreen([
        w('Account', 40, 400), w('history', 110, 400), w('Joined', 40, 440), w('LinkedIn', 110, 440),
    ], opts).kind, 'member-sheet');
    assert.equal(classifyLinkedInScreen([
        w('Connect', 80, 502), w('Contact', 80, 450), w('Personalize', 80, 560), w('member', 80, 700),
    ], opts).kind, 'profile-menu');
});

test('Me drawer and own profile are not home or a lead profile', () => {
    assert.equal(classifyLinkedInScreen([
        w('Settings', 88, 613), w('Privacy', 167, 613), w('Manage', 50, 413), w('pages', 99, 415),
        w('profile', 74, 315), w('viewers', 122, 313),
    ], opts).kind, 'me-drawer');
    assert.equal(classifyLinkedInScreen([
        w('Search', 98, 71), w('Enhance', 172, 500), w('profile', 225, 501),
        w('Suggested', 66, 571), w('for', 133, 569),
    ], opts).kind, 'me');
});

test('cold-connect and connection-request workflows', () => {
    assert.equal(parseLinkedInWorkflow(undefined), 'all');
    assert.equal(parseLinkedInWorkflow('cold-connect'), 'cold-connect');
    assert.equal(parseLinkedInWorkflow('connect'), 'connect');
    assert.throws(() => parseLinkedInWorkflow('pymk'));
    assert.deepEqual([...linkedinPointsForWorkflow('cold-connect')], [
        'homeTab', 'searchField', 'searchPeopleFilter', 'searchFirstResult',
        'profileMenu', 'connect', 'addANote', 'noteComposer', 'sendInvitation',
    ]);
    assert.deepEqual([...linkedinPointsForWorkflow('connect')], [
        'homeTab', 'searchField', 'searchPeopleFilter', 'searchFirstResult',
        'profileMenu', 'connect', 'sendWithoutNote',
    ]);
    assert.equal(linkedinPointsForWorkflow('all').length, LINKEDIN_CALIBRATABLE_POINTS.length);
    assert.match(linkedinLabelsForWorkflow('cold-connect').profileMenu ?? '', /profile menu/i);
    assert.match(linkedinLabelsForWorkflow('connect').sendWithoutNote ?? '', /without note/i);
    assert.equal(LINKEDIN_COLD_CONNECT.steps.length, 9);
    assert.equal(LINKEDIN_CONNECT.steps.length, 7);
    assert.equal(LINKEDIN_IPHONE13.profileMenu.x, 358);
    assert.equal(LINKEDIN_IPHONE13.profileMenu.y, 468);
    assert.equal(LINKEDIN_IPHONE13.sendWithoutNote.y, 774);
});

test('parses LinkedIn lead CSV and fills the note', async () => {
    const raw = await readFile(path.resolve('test/fixtures/linkedin-leads.csv'), 'utf8');
    const leads = parseLinkedInLeadsCsv(raw);
    assert.equal(leads.length, 2);
    assert.equal(leads[0]?.fullName, 'Jane Doe');
    assert.equal(leads[1]?.slug, 'nicolò-ricci');
    assert.equal(
        connectNoteForLead(leads[0]!, DEFAULT_CONNECT_NOTE),
        'Hi Jane, we are doing some cool things in marketing and want to connect',
    );
    const remaining = pickUncontacted(leads, {
        'jane-doe': { status: 'sent', at: '2026-09-15T00:00:00.000Z', fullName: 'Jane Doe' },
    }, 5);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.fullName, 'Nicolò Ricci');
    const kept = markLinkedInContact({
        'jane-doe': { status: 'sent', at: '2026-09-15T00:00:00.000Z', fullName: 'Jane Doe' },
    }, leads[0]!, 'skipped', 'already pending');
    assert.equal(kept['jane-doe']?.status, 'sent');
});

test('verify refuses send unless the note composer is on screen', () => {
    const lead = {
        profileLink: 'https://www.linkedin.com/in/frank-sinanaj-7541b116/',
        slug: 'frank-sinanaj-7541b116',
        firstName: 'Frank',
        lastName: 'Sinanaj',
        fullName: 'Frank Sinanaj',
        degree: '3rd',
    };
    assert.equal(verifyProfile('home', [w('Frank', 40, 200)], lead).ok, false);
    assert.equal(verifyProfile('profile', [w('Sinanaj', 80, 220), w('Follow', 100, 468)], lead).ok, true);
    const manso = {
        ...lead,
        firstName: 'Manso',
        lastName: 'Da Silva',
        fullName: 'Manso Da Silva',
        slug: 'manso-da-silva',
    };
    assert.equal(leadNameOnScreen([w('Manso', 53, 272), w('Da', 109, 272), w('Silva', 155, 272)], manso), true);
    assert.equal(verifyNoteReady('unknown').ok, false);
    assert.equal(verifyNoteReady('profile-menu').ok, false);
    assert.equal(verifyNoteReady('connect-note').ok, true);
});

test('plain connect confirms with Pending or invitation sent, not a bare profile', () => {
    const lead = {
        profileLink: 'https://www.linkedin.com/in/mohammed-saleel--/',
        slug: 'mohammed-saleel--',
        firstName: 'Mohammed',
        lastName: 'Saleel',
        fullName: 'Mohammed Saleel',
        degree: '3rd',
    };
    assert.equal(verifyPlainConnectSent('connect-sheet', [w('without', 195, 790)], lead).ok, false);
    assert.equal(verifyPlainConnectSent('connect-note', [w('invitation', 195, 430)], lead).ok, false);
    assert.equal(verifyPlainConnectSent('profile', [w('Saleel', 80, 220), w('Follow', 100, 468)], lead).ok, false);
    assert.equal(verifyPlainConnectSent('profile', [w('Saleel', 80, 220), w('Pending', 100, 300)], lead).ok, true);
    assert.equal(verifyPlainConnectSent('connect-sent', [w('Invitation', 80, 80), w('sent', 180, 80)], lead).ok, true);
    assert.equal(verifyPlainConnectSent('profile', [w('Pending', 100, 300), w('Someone', 80, 220)], lead).ok, false);
});
