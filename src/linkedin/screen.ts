import type { OcrWord } from '../instagram/ocr.js';

/**
 * Classify a LinkedIn screenshot from OCR words. Rules are anchored on
 * stable chrome copy (tab labels, sheet buttons, section titles) rather
 * than feed posts.
 */
export type LinkedInScreenKind =
    | 'home'
    | 'network'
    | 'notifications'
    | 'jobs'
    | 'search'
    | 'messaging'
    | 'me-drawer'
    | 'profile'
    | 'profile-menu'
    | 'connect-sheet'
    | 'connect-sent'
    | 'connect-note'
    | 'contact-info'
    | 'member-sheet'
    | 'post-composer'
    | 'me'
    | 'unknown';

export interface LinkedInScreen {
    kind: LinkedInScreenKind;
}

interface Options {
    /** Screenshot pixels per point (3 on the iPhone 13). */
    scale: number;
}

function centerX(word: OcrWord, scale: number): number {
    return (word.x + word.width / 2) / scale;
}

function centerY(word: OcrWord, scale: number): number {
    return (word.y + word.height / 2) / scale;
}

function has(words: OcrWord[], pattern: RegExp, scale: number, band?: [number, number]): boolean {
    return words.some((word) => pattern.test(word.text.trim())
        && (!band || (centerY(word, scale) >= band[0] && centerY(word, scale) <= band[1])));
}

/** ⋯ on the Follow/Message row. OCR usually reads it as ©. */
function hasProfileOverflow(words: OcrWord[], scale: number): boolean {
    return words.some((word) => {
        const x = centerX(word, scale);
        const y = centerY(word, scale);
        return x >= 315 && x <= 385 && y >= 360 && y <= 640
            && /^(\.{2,4}|[⋯…·©®°*])$/.test(word.text.trim());
    });
}

/**
 * Profile header: the degree badge ("· 2nd") sits on the name line right under
 * the photo (y≈270) and the "500+ connections" / "1,234 followers" line just
 * below it. Feed posts also show "2nd" (author line) and ads show "followers",
 * but at arbitrary heights and with a Follow button on the same row as the
 * degree — so require the profile geometry and no inline Follow.
 */
function hasProfileDegreeHeader(words: OcrWord[], scale: number): boolean {
    const degree = words.find((word) => /^(2nd|3rd)$/i.test(word.text.trim())
        && centerY(word, scale) >= 220 && centerY(word, scale) <= 340);
    if (!degree) return false;
    const degreeY = centerY(degree, scale);
    const inlineFollow = words.some((word) => /^Follow$/i.test(word.text.trim())
        && Math.abs(centerY(word, scale) - degreeY) <= 25);
    if (inlineFollow) return false;
    return words.some((word) => /^(connections?|followers)$/i.test(word.text.trim())
        && centerY(word, scale) >= degreeY + 40 && centerY(word, scale) <= degreeY + 200);
}

/** About / Experience / Activity / Highlights as a left profile section title. */
function hasProfileSection(words: OcrWord[], scale: number): boolean {
    return words.some((word) => {
        const x = centerX(word, scale);
        const y = centerY(word, scale);
        return x < 100 && y >= 400 && y <= 780
            && /^(About|Experience|Activity|Highlights)$/i.test(word.text.trim());
    });
}

export function classifyLinkedInScreen(words: OcrWord[], { scale }: Options): LinkedInScreen {
    if (has(words, /^without$/i, scale) && has(words, /^note$/i, scale, [600, 840])) {
        return { kind: 'connect-sheet' };
    }
    if (has(words, /^Add$/i, scale, [620, 800]) && has(words, /^note$/i, scale, [620, 800])) {
        return { kind: 'connect-sheet' };
    }
    if (has(words, /^sent$/i, scale) && has(words, /^invitation$/i, scale)
        && !has(words, /^Premium$/i, scale) && !has(words, /^200$/i, scale) && !has(words, /^\/200$/i, scale)) {
        return { kind: 'connect-sent' };
    }
    if (has(words, /^invitation$/i, scale) && (has(words, /^Premium$/i, scale) || has(words, /^\/200$/i, scale) || has(words, /^200$/i, scale))) {
        return { kind: 'connect-note' };
    }
    if (has(words, /^Personalize$/i, scale) || (has(words, /^Connect$/i, scale, [430, 580]) && has(words, /^Contact$/i, scale))) {
        return { kind: 'profile-menu' };
    }
    if ((has(words, /^Contact$/i, scale, [20, 120]) && has(words, /^info$/i, scale, [20, 120]))
        || (has(words, /^Website$/i, scale) && has(words, /^Email$/i, scale) && has(words, /^Phone$/i, scale))
        || (has(words, /^Connected$/i, scale) && has(words, /^since$/i, scale))) {
        return { kind: 'contact-info' };
    }
    if ((has(words, /^Contact$/i, scale, [280, 640]) && has(words, /^info$/i, scale, [280, 640]))
        || (has(words, /^Remove$/i, scale) && has(words, /^connection$/i, scale))
        || (has(words, /^Share$/i, scale) && has(words, /^via$/i, scale))
        || (has(words, /^Send$/i, scale, [300, 560]) && has(words, /^profile$/i, scale, [300, 560]))) {
        return { kind: 'profile-menu' };
    }
    if ((has(words, /^Account$/i, scale) && has(words, /^history$/i, scale))
        || (has(words, /^Joined$/i, scale) && has(words, /^LinkedIn$/i, scale))
        || (has(words, /^Verifications$/i, scale) && has(words, /^Contact$/i, scale))) {
        return { kind: 'member-sheet' };
    }
    if ((has(words, /^Send$/i, scale, [40, 90]) && has(words, /^invitation$/i, scale))
        || (has(words, /^Your$/i, scale, [80, 180]) && has(words, /^note$/i, scale, [80, 180]))) {
        return { kind: 'connect-note' };
    }
    if (has(words, /^Anyone$/i, scale, [40, 140]) && (has(words, /^Post$/i, scale, [40, 90]) || has(words, /^Photo$/i, scale))) {
        return { kind: 'post-composer' };
    }
    if (has(words, /^Messaging$/i, scale, [40, 140]) || has(words, /^Search\s*messages$/i, scale, [90, 160])) {
        return { kind: 'messaging' };
    }
    // Empty search: Recents row. OCR often misses the Search placeholder
    // and glues "Show all" into Showall.
    if (has(words, /^Recent$/i, scale, [80, 180])
        || has(words, /^Showall$/i, scale, [80, 180])
        || (has(words, /^Show$/i, scale, [80, 180]) && has(words, /^all$/i, scale, [80, 180]))) {
        return { kind: 'search' };
    }
    if (has(words, /^People$/i, scale, [90, 160]) && (has(words, /^Search$/i, scale, [40, 100]) || has(words, /^Posts$/i, scale, [90, 160]))) {
        return { kind: 'search' };
    }
    if (has(words, /^Search$/i, scale, [40, 100])
        && (has(words, /^Posts$/i, scale, [90, 170]) || has(words, /^Companies$/i, scale, [90, 170]) || has(words, /^Groups$/i, scale, [90, 170]))) {
        return { kind: 'search' };
    }
    if (has(words, /^Jobs$/i, scale, [40, 140]) && (has(words, /^Easy$/i, scale) || has(words, /^Search\s*jobs$/i, scale, [40, 120]))) {
        return { kind: 'jobs' };
    }
    if (has(words, /^Notifications$/i, scale, [40, 140])) return { kind: 'notifications' };
    // Grow / Catch up sit under the shared Search header (y≈115). Invitations
    // is the first section on Grow. Tab-bar "My Network" is too low to use.
    if (has(words, /^Grow$/i, scale, [90, 140]) || has(words, /^Catch/i, scale, [90, 140])) {
        return { kind: 'network' };
    }
    if (has(words, /^Invitations$/i, scale, [140, 200]) || has(words, /^Manage$/i, scale, [480, 580])) {
        return { kind: 'network' };
    }
    if ((has(words, /^Follow$/i, scale, [380, 560]) && has(words, /^Message$/i, scale, [380, 560]))
        || ((has(words, /^Connect$/i, scale, [250, 420]) || has(words, /^Pending$/i, scale, [250, 420]) || has(words, /^Follow$/i, scale, [250, 560]))
            && (has(words, /^About$/i, scale) || has(words, /^Experience$/i, scale) || has(words, /^Message$/i, scale, [250, 560])))
        || (has(words, /^About$/i, scale, [480, 760]) && has(words, /^connections$/i, scale))
        || (has(words, /^Open$/i, scale, [450, 560]) && has(words, /^work$/i, scale, [450, 560]))
        || hasProfileOverflow(words, scale)
        || hasProfileSection(words, scale)
        || hasProfileDegreeHeader(words, scale)) {
        return { kind: 'profile' };
    }
    if ((has(words, /^Settings$/i, scale) && has(words, /^Privacy$/i, scale))
        || (has(words, /^viewers$/i, scale) && has(words, /^Manage$/i, scale))
        || (has(words, /^Manage$/i, scale) && has(words, /^pages$/i, scale))) {
        return { kind: 'me-drawer' };
    }
    if ((has(words, /^Enhance$/i, scale) && has(words, /^profile$/i, scale, [450, 560]))
        || (has(words, /^Suggested$/i, scale, [520, 620]) && has(words, /^for$/i, scale, [520, 620]))
        || (has(words, /^View$/i, scale, [140, 280]) && has(words, /^profile$/i, scale, [140, 280]))) {
        return { kind: 'me' };
    }
    if (has(words, /^Start$/i, scale, [40, 140]) && has(words, /^a$/i, scale, [40, 140])) {
        return { kind: 'home' };
    }
    // Home feed: search chrome in the header without a People filter row.
    if (has(words, /^Search$/i, scale, [40, 100]) && !has(words, /^People$/i, scale, [90, 160])) {
        return { kind: 'home' };
    }
    return { kind: 'unknown' };
}
