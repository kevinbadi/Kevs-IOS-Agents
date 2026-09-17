export type ResultsPlatform = 'all' | 'tiktok' | 'instagram' | 'linkedin';

export interface OutcomeCounters {
    likes: number;
    saves: number;
    comments: number;
    videos: number;
    swipes: number;
    sent: number;
    posts: number;
    skipped: number;
}

export interface RunCounters {
    runs: number;
    succeeded: number;
    failed: number;
    stopped: number;
}

export type ResultsTotals = RunCounters & OutcomeCounters;

const EMPTY_OUTCOMES: OutcomeCounters = {
    likes: 0, saves: 0, comments: 0, videos: 0, swipes: 0, sent: 0, posts: 0, skipped: 0,
};

const TOTAL_KEYS: Array<keyof ResultsTotals> = [
    'runs', 'succeeded', 'failed', 'stopped',
    'likes', 'saves', 'comments', 'videos', 'swipes', 'sent', 'posts', 'skipped',
];

export function emptyTotals(): ResultsTotals {
    return { runs: 0, succeeded: 0, failed: 0, stopped: 0, ...EMPTY_OUTCOMES };
}

export function addTotals(into: ResultsTotals, add: Partial<ResultsTotals>): void {
    for (const key of TOTAL_KEYS) {
        into[key] = (into[key] ?? 0) + (add[key] ?? 0);
    }
}

const COUNTER_KEYS: Record<string, keyof OutcomeCounters> = {
    likes: 'likes',
    saves: 'saves',
    comments: 'comments',
    videosViewed: 'videos',
    videos: 'videos',
    swipes: 'swipes',
    sent: 'sent',
    skipped: 'skipped',
    loops: 'videos',
};

/** Pull likes/saves/comments/sends from a workflow's finish (or similar) log line. */
export function parseOutcomeLine(line: string): Partial<OutcomeCounters> {
    const out: Partial<OutcomeCounters> = {};
    const token = /\b(likes|saves|comments|videosViewed|videos|swipes|sent|skipped|loops)=(\d+)/g;
    for (const match of line.matchAll(token)) {
        const mapped = COUNTER_KEYS[match[1]];
        if (!mapped) continue;
        out[mapped] = (out[mapped] ?? 0) + Number.parseInt(match[2], 10);
    }
    if (/TikTok post submitted/i.test(line) || /Instagram post submitted/i.test(line)) {
        out.posts = (out.posts ?? 0) + 1;
    }
    return out;
}

export function pluginPlatform(pluginId: string): Exclude<ResultsPlatform, 'all'> | null {
    if (pluginId === 'com.git-agni.tiktok') return 'tiktok';
    if (pluginId === 'com.git-agni.instagram') return 'instagram';
    if (pluginId === 'com.git-agni.linkedin') return 'linkedin';
    return null;
}

export function workflowLabel(pluginId: string, taskType: string): string {
    const platform = pluginPlatform(pluginId);
    const name = WORKFLOW_NAMES[`${platform ?? pluginId}/${taskType}`]
        ?? WORKFLOW_NAMES[taskType]
        ?? taskType.replace(/-/g, ' ');
    const brand = platform === 'tiktok' ? 'TikTok'
        : platform === 'instagram' ? 'Instagram'
            : platform === 'linkedin' ? 'LinkedIn'
                : pluginId.replace(/^com\.git-agni\./, '');
    return `${brand} · ${name}`;
}

const WORKFLOW_NAMES: Record<string, string> = {
    'tiktok/doomscroll': 'Warmup',
    'tiktok/doomscroll-following': 'Engagement',
    'tiktok/post': 'Create a post',
    'tiktok/pipeline-drain': 'Post pipeline',
    'tiktok/workflow-replay': 'Trained replay',
    'instagram/doomscroll': 'Warmup',
    'instagram/doomscroll-following': 'Engage following',
    'instagram/cold-dms': 'Cold DMs',
    'instagram/post': 'Create a post',
    'linkedin/cold-connect': 'Cold connect',
    'linkedin/connect': 'Connection request',
};

export function isResultsPlatform(value: string | undefined): value is ResultsPlatform {
    return value === 'all' || value === 'tiktok' || value === 'instagram' || value === 'linkedin';
}

const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;

export function resolveResultsTimezone(value: string | undefined, fallback = 'America/New_York'): string {
    const timezone = (value ?? fallback).trim() || fallback;
    if (!TIMEZONE_PATTERN.test(timezone)) return fallback;
    try {
        Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
        return timezone;
    } catch {
        return fallback;
    }
}

/** Calendar day in `timezone`, as YYYY-MM-DD. */
export function dayKey(date: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
}
