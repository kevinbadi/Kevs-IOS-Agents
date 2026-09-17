/**
 * App playbooks: what the agent should know about an app before it acts in it.
 *
 * Small vision models can read a screen but do not know app conventions —
 * that a heart is a toggle, that each reel fills the screen, that the next
 * video is one scroll away. These hints are injected into the observation only
 * while the matching app is in the foreground, so they cost tokens only when
 * they matter. Add an entry here to teach the agent a new app.
 */

export interface AppPlaybook {
    /** Bundle ids this playbook applies to. */
    bundleIds: string[];
    /** Short, imperative lines the model can act on. */
    hints: string[];
}

const VERTICAL_FEED = [
    'This is a full-screen vertical video feed: exactly ONE video is on screen at a time.',
    'To get to the NEXT video, call scroll with direction "down".',
    'To like videos, alternate strictly using "Last executed action" in ACTIONS SO FAR:',
    '  • Last executed action = scroll down → you are on a NEW video that is NOT liked → tap the heart now.',
    '  • Last executed action = tap (Like) → this video is DONE → scroll down now. Never tap the heart again on it.',
    'Never rely on the heart\'s colour in the picture; rely on the element label and the last executed action.',
    'Like/heart, save, and follow buttons are toggles — tapping one a second time UNDOES it. Never tap the heart twice on the same video.',
    'When the goal asks for N videos, count the heart taps in ACTIONS SO FAR — that number is how many you have liked. Say it in your reasoning ("liked 2 of 5").',
    'Call done only when the number of heart taps in ACTIONS SO FAR equals N.',
];

export const APP_PLAYBOOKS: AppPlaybook[] = [
    {
        bundleIds: ['com.burbn.instagram'],
        hints: [
            'Instagram: the bottom tab bar is Home, Search, Create (+), Reels, Profile. Reels is the clapperboard icon (label "Reels" / "reels-tab").',
            'On a reel the heart is the Button labelled "Like" in the column on the right (same spot as "ufi-like-button", about x=360). Tap its listed centre.',
            'READ THE ELEMENT LIST, not the colour: a Button "Like" means this video is NOT liked yet (transparent heart). A Button "Unlike" means it IS liked (red heart) — do not tap it again.',
            ...VERTICAL_FEED,
        ],
    },
    {
        bundleIds: ['com.zhiliaoapp.musically'],
        hints: [
            'TikTok: the For You feed opens on launch; the heart, comment, and share buttons sit in the column on the right.',
            ...VERTICAL_FEED,
        ],
    },
    {
        bundleIds: ['com.google.ios.youtube'],
        hints: [
            'YouTube: Shorts is the second tab in the bottom bar. Inside Shorts the like button is in the column on the right.',
            ...VERTICAL_FEED,
        ],
    },
    {
        bundleIds: ['com.linkedin.LinkedIn'],
        hints: [
            'LinkedIn: the bottom tab bar is Home, My Network, Post, Notifications, Jobs. Search is the field at the top.',
            'On a profile, "Connect" may be hidden under the "More" button next to "Message".',
            'The feed is a list: scroll down to see more posts; each post has Like, Comment, Repost, Send underneath it.',
        ],
    },
    {
        bundleIds: ['com.apple.springboard'],
        hints: [
            'Home screen: to open an app you know the bundle id of, call open_app — it is faster and never misses.',
            'Otherwise pull Spotlight (scroll "down" from the middle of the home screen), type the name, then tap the Top Hit.',
        ],
    },
];

/** Returns the bundle id embedded in the runner's foreground label, e.g. "Instagram (com.burbn.instagram)". */
export function bundleIdFromLabel(app: string | null): string | null {
    if (!app) return null;
    const match = /\(([a-z0-9.-]+)\)\s*$/i.exec(app);
    const id = match?.[1] ?? null;
    // The runner labels the home screen "Home screen (SpringBoard)".
    return id === 'SpringBoard' ? 'com.apple.springboard' : id;
}

/** Hints for whichever app is in the foreground, or null when we have none. */
export function appHintsFor(app: string | null): string | null {
    const bundleId = bundleIdFromLabel(app);
    if (!bundleId) return null;
    const playbook = APP_PLAYBOOKS.find((entry) => entry.bundleIds.includes(bundleId));
    return playbook ? playbook.hints.map((line) => `- ${line}`).join('\n') : null;
}
