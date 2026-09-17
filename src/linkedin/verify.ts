import type { OcrWord } from '../instagram/ocr.js';
import type { LinkedInScreenKind } from './screen.js';
import type { LinkedInLead } from './leads.js';

function normalize(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function nameTokens(text: string): string[] {
    return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/gu)
        .filter((token) => token.length >= 3);
}

export function leadNameOnScreen(words: OcrWord[], lead: LinkedInLead): boolean {
    const hay = words.map((word) => normalize(word.text)).filter(Boolean);
    const mentions = (needle: string) => needle.length >= 3 && hay.some((token) => (
        token === needle || (needle.length >= 4 && token.includes(needle))
    ));
    const lastParts = nameTokens(lead.lastName);
    if (lastParts.length > 0 && lastParts.every((part) => mentions(part))) return true;
    const last = normalize(lead.lastName);
    if (last.length >= 4 && mentions(last)) return true;
    return mentions(normalize(lead.firstName)) || mentions(normalize(lead.fullName));
}

export interface VerifyResult {
    ok: boolean;
    reason?: string;
}

/** After opening a result: must be a profile that shows this person. */
export function verifyProfile(
    kind: LinkedInScreenKind,
    words: OcrWord[],
    lead: LinkedInLead,
): VerifyResult {
    if (kind !== 'profile') {
        return { ok: false, reason: `expected profile, got ${kind}` };
    }
    const pending = words.some((word) => /^Pending$/i.test(word.text.trim()));
    if (pending) return { ok: false, reason: 'already pending' };
    if (!leadNameOnScreen(words, lead)) {
        return { ok: false, reason: 'profile name not on screen' };
    }
    return { ok: true };
}

/** 1st-degree / already-connected profiles show Message, not Connect. */
export function alreadyConnectedOnProfile(kind: LinkedInScreenKind, words: OcrWord[]): boolean {
    if (kind !== 'profile') return false;
    const label = (pattern: RegExp) => words.some((word) => pattern.test(word.text.trim()));
    if (label(/^Connect$/i) || label(/^Pending$/i)) return false;
    return label(/^1st$/i) || (label(/^Message$/i) && label(/^Following$/i));
}

export function alreadyConnectedOnMenu(kind: LinkedInScreenKind, words: OcrWord[]): boolean {
    if (kind !== 'profile-menu') return false;
    const label = (pattern: RegExp) => words.some((word) => pattern.test(word.text.trim()));
    if (label(/^Connect$/i)) return false;
    return (label(/^Remove$/i) && label(/^connection$/i)) || label(/^Following$/i);
}

export function verifyProfileMenu(kind: LinkedInScreenKind): VerifyResult {
    if (kind !== 'profile-menu') return { ok: false, reason: `expected profile menu, got ${kind}` };
    return { ok: true };
}

export function verifyConnectSheet(kind: LinkedInScreenKind): VerifyResult {
    if (kind !== 'connect-sheet') return { ok: false, reason: `expected send-request sheet, got ${kind}` };
    return { ok: true };
}

/** Only send a note invite when OCR says we are on the 200-char note page. */
export function verifyNoteReady(kind: LinkedInScreenKind): VerifyResult {
    if (kind !== 'connect-note') return { ok: false, reason: `expected note composer, got ${kind}` };
    return { ok: true };
}

/**
 * After Send without note the sheet must be gone. Success is Pending on this
 * person's profile, or LinkedIn's "Invitation sent" confirmation — not merely
 * being back on a profile (that can mean the tap missed).
 */
export function verifyPlainConnectSent(
    kind: LinkedInScreenKind,
    words: OcrWord[],
    lead: LinkedInLead,
): VerifyResult {
    if (kind === 'connect-sheet' || kind === 'connect-note' || kind === 'profile-menu') {
        return { ok: false, reason: `still on ${kind}` };
    }
    const joined = words.map((word) => word.text.trim()).join(' ');
    const pending = words.some((word) => /^Pending$/i.test(word.text.trim()));
    const sentCopy = kind === 'connect-sent'
        || /invitation sent/i.test(joined)
        || (/sent/i.test(joined) && /invitation/i.test(joined));
    if (sentCopy) return { ok: true };
    if (pending) {
        if (kind === 'profile' && !leadNameOnScreen(words, lead)) {
            return { ok: false, reason: 'Pending on a different profile' };
        }
        return { ok: true };
    }
    return { ok: false, reason: 'no Pending / invitation-sent confirmation' };
}
