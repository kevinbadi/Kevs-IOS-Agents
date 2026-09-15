import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface LinkedInLead {
    profileLink: string;
    slug: string;
    firstName: string;
    lastName: string;
    fullName: string;
    degree: string;
}

const SLUG_PATTERN = /linkedin\.com\/in\/([^/?#]+)/i;

function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]!;
        if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === ',' && !inQuotes) {
            fields.push(current);
            current = '';
            continue;
        }
        current += char;
    }
    fields.push(current);
    return fields;
}

function slugFromProfileLink(link: string): string {
    const match = SLUG_PATTERN.exec(link);
    return match ? decodeURIComponent(match[1]!).replace(/\/$/, '') : '';
}

function column(headers: string[], row: string[], name: string): string {
    const index = headers.findIndex((header) => header.trim().toLowerCase() === name);
    if (index < 0) return '';
    return (row[index] ?? '').trim();
}

/** Parse a PhBuster-style LinkedIn export. Drops blank rows and upgrade footers. */
export function parseLinkedInLeadsCsv(raw: string): LinkedInLead[] {
    const lines = raw.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]!).map((header) => header.trim());
    const leads: LinkedInLead[] = [];
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
        if (/^export limit reached/i.test(line) || /^upgrade to export/i.test(line)) continue;
        if (/^https:\/\/phbuster\.io/i.test(line)) continue;
        const row = parseCsvLine(line);
        const profileLink = column(headers, row, 'profilelink');
        const fullName = column(headers, row, 'fullname');
        const firstName = column(headers, row, 'firstname');
        const lastName = column(headers, row, 'lastname');
        const degree = column(headers, row, 'degree');
        if (!profileLink.startsWith('http') || !fullName) continue;
        const slug = slugFromProfileLink(profileLink);
        const key = slug || fullName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        leads.push({ profileLink, slug, firstName, lastName, fullName, degree });
    }
    return leads;
}

export function searchQueryForLead(lead: LinkedInLead): string {
    return lead.fullName.normalize('NFD').replace(/\p{M}/gu, '');
}

export function connectNoteForLead(lead: LinkedInLead, template: string): string {
    const note = template
        .replaceAll('{firstName}', lead.firstName || lead.fullName.split(/\s+/)[0] || '')
        .replaceAll('{fullName}', lead.fullName)
        .trim();
    return note.length > LINKEDIN_NOTE_MAX_LENGTH ? note.slice(0, LINKEDIN_NOTE_MAX_LENGTH) : note;
}

export const DEFAULT_CONNECT_NOTE =
    'Hi {firstName}, we are doing some cool things in marketing and want to connect';

/** LinkedIn invitation notes cap at 200 characters on current iOS. */
export const LINKEDIN_NOTE_MAX_LENGTH = 200;
/** Target skill: 5 connects per run × 5 runs/day. */
export const LINKEDIN_CONNECTS_PER_RUN = 5;
export const LINKEDIN_MAX_CONNECTS_PER_DAY = 25;
export const LINKEDIN_MAX_CONNECTS_PER_RUN = LINKEDIN_MAX_CONNECTS_PER_DAY;

export function leadKey(lead: LinkedInLead): string {
    return (lead.slug || lead.fullName).trim().toLowerCase();
}

export type LinkedInContactStatus = 'sent' | 'skipped' | 'failed';

export interface LinkedInContact {
    status: LinkedInContactStatus;
    at: string;
    fullName: string;
    reason?: string;
}

export type LinkedInContactState = Record<string, LinkedInContact>;

export function parseConnectsPerRun(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value ?? LINKEDIN_CONNECTS_PER_RUN);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > LINKEDIN_MAX_CONNECTS_PER_DAY) {
        throw new Error(`connects per run must be 1–${LINKEDIN_MAX_CONNECTS_PER_DAY}`);
    }
    return parsed;
}

export function pickUncontacted(
    leads: LinkedInLead[],
    state: LinkedInContactState,
    size: number,
): LinkedInLead[] {
    const picked: LinkedInLead[] = [];
    for (const lead of leads) {
        if (picked.length >= size) break;
        if (state[leadKey(lead)]?.status === 'sent') continue;
        picked.push(lead);
    }
    return picked;
}

export async function loadLinkedInContactState(statePath: string): Promise<LinkedInContactState> {
    try {
        const raw = JSON.parse(await readFile(statePath, 'utf8')) as unknown;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        return raw as LinkedInContactState;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw error;
    }
}

export async function saveLinkedInContactState(statePath: string, state: LinkedInContactState): Promise<void> {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function markLinkedInContact(
    state: LinkedInContactState,
    lead: LinkedInLead,
    status: LinkedInContactStatus,
    reason?: string,
): LinkedInContactState {
    const key = leadKey(lead);
    if (state[key]?.status === 'sent' && status !== 'sent') return state;
    return {
        ...state,
        [key]: {
            status,
            at: new Date().toISOString(),
            fullName: lead.fullName,
            ...(reason ? { reason } : {}),
        },
    };
}

export function validateConnectNote(note: string): string {
    const trimmed = note.trim();
    if (!trimmed) throw new Error('Connection note is required');
    if (trimmed.length > LINKEDIN_NOTE_MAX_LENGTH) {
        throw new Error(`Connection note must be ${LINKEDIN_NOTE_MAX_LENGTH} characters or fewer`);
    }
    return trimmed;
}

const LEAD_CSV_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export function linkedInLeadsDirectory(): string {
    return process.env.LINKEDIN_LEADS_DIR ?? path.resolve('data', 'linkedin', 'leads');
}

/** Basename without `.csv`. */
export function validateLinkedInLeadCsvName(name: string): string {
    const trimmed = name.trim().replace(/\.csv$/i, '');
    if (!LEAD_CSV_NAME.test(trimmed)) {
        throw new Error(`Invalid LinkedIn lead CSV "${name}" — use letters, digits, dot, dash, underscore`);
    }
    return trimmed;
}

export function linkedInLeadCsvPath(name: string): string {
    return path.join(linkedInLeadsDirectory(), `${validateLinkedInLeadCsvName(name)}.csv`);
}

export interface LinkedInLeadCsvSummary {
    name: string;
    total: number;
    sent: number;
    remaining: number;
}

export async function summarizeLinkedInLeadCsvs(): Promise<LinkedInLeadCsvSummary[]> {
    const directory = linkedInLeadsDirectory();
    let entries: string[];
    try {
        entries = await readdir(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
    const state = await loadLinkedInContactState(path.join(directory, 'state.json'));
    const summaries: LinkedInLeadCsvSummary[] = [];
    for (const entry of entries.filter((file) => file.toLowerCase().endsWith('.csv')).sort()) {
        const name = entry.slice(0, -'.csv'.length);
        if (!LEAD_CSV_NAME.test(name)) continue;
        const leads = parseLinkedInLeadsCsv(await readFile(path.join(directory, entry), 'utf8'));
        const remaining = pickUncontacted(leads, state, leads.length).length;
        const sent = leads.filter((lead) => state[leadKey(lead)]?.status === 'sent').length;
        summaries.push({ name, total: leads.length, sent, remaining });
    }
    return summaries;
}
