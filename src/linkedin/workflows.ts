import {
    LINKEDIN_CALIBRATABLE_POINTS,
    LINKEDIN_POINT_LABELS,
    type LinkedInCalibratablePoint,
} from './coordinates.js';

/**
 * LinkedIn automation is mapped per workflow, not as one dump of every
 * chrome target. Cold connect: open → Search → People → select →
 * Click profile menu (hidden connect) → Connect → "Add a note or connect
 * now" (shown while monthly notes remain) → Add note (cold-connect) or
 * Send without note (connect) → Home.
 */
export const LINKEDIN_WORKFLOW_IDS = ['all', 'cold-connect', 'connect'] as const;
export type LinkedInWorkflowId = typeof LINKEDIN_WORKFLOW_IDS[number];

export interface LinkedInWorkflowStep {
    n: number;
    text: string;
    point: LinkedInCalibratablePoint;
}

export interface LinkedInWorkflow {
    id: Exclude<LinkedInWorkflowId, 'all'>;
    displayName: string;
    points: readonly LinkedInCalibratablePoint[];
    labels: Partial<Record<LinkedInCalibratablePoint, string>>;
    steps: readonly LinkedInWorkflowStep[];
}

const COLD_CONNECT_POINTS = [
    'homeTab',
    'searchField',
    'searchPeopleFilter',
    'searchFirstResult',
    'profileMenu',
    'connect',
    'addANote',
    'noteComposer',
    'sendInvitation',
] as const satisfies readonly LinkedInCalibratablePoint[];

export const LINKEDIN_COLD_CONNECT: LinkedInWorkflow = {
    id: 'cold-connect',
    displayName: 'Cold connect',
    points: COLD_CONNECT_POINTS,
    labels: {
        homeTab: '1 · Open LinkedIn (Home)',
        searchField: '2 · Search bar (top middle)',
        searchPeopleFilter: '3 · People filter',
        searchFirstResult: '4 · Select person',
        profileMenu: '5 · Click profile menu',
        connect: '6 · Connect',
        addANote: '7 · Add note',
        noteComposer: '8 · Note field',
        sendInvitation: '9 · Add note to invitation',
    },
    steps: [
        { n: 1, text: 'Open LinkedIn', point: 'homeTab' },
        { n: 2, text: 'Tap Search (top middle)', point: 'searchField' },
        { n: 3, text: 'Filter People', point: 'searchPeopleFilter' },
        { n: 4, text: 'Select the person', point: 'searchFirstResult' },
        { n: 5, text: 'Click profile menu', point: 'profileMenu' },
        { n: 6, text: 'Connect', point: 'connect' },
        { n: 7, text: 'Add note', point: 'addANote' },
        { n: 8, text: 'Type the note', point: 'noteComposer' },
        { n: 9, text: 'Add note to invitation', point: 'sendInvitation' },
    ],
};

const CONNECT_POINTS = [
    'homeTab',
    'searchField',
    'searchPeopleFilter',
    'searchFirstResult',
    'profileMenu',
    'connect',
    'sendWithoutNote',
] as const satisfies readonly LinkedInCalibratablePoint[];

export const LINKEDIN_CONNECT: LinkedInWorkflow = {
    id: 'connect',
    displayName: 'Connection request',
    points: CONNECT_POINTS,
    labels: {
        homeTab: '1 · Open LinkedIn (Home)',
        searchField: '2 · Search bar (top middle)',
        searchPeopleFilter: '3 · People filter',
        searchFirstResult: '4 · Select person',
        profileMenu: '5 · Click profile menu',
        connect: '6 · Connect',
        sendWithoutNote: '7 · Send without note',
    },
    steps: [
        { n: 1, text: 'Open LinkedIn', point: 'homeTab' },
        { n: 2, text: 'Tap Search (top middle)', point: 'searchField' },
        { n: 3, text: 'Filter People', point: 'searchPeopleFilter' },
        { n: 4, text: 'Select the person', point: 'searchFirstResult' },
        { n: 5, text: 'Click profile menu', point: 'profileMenu' },
        { n: 6, text: 'Connect', point: 'connect' },
        { n: 7, text: 'Send without note', point: 'sendWithoutNote' },
    ],
};

export const LINKEDIN_WORKFLOWS: Record<Exclude<LinkedInWorkflowId, 'all'>, LinkedInWorkflow> = {
    'cold-connect': LINKEDIN_COLD_CONNECT,
    connect: LINKEDIN_CONNECT,
};

export function parseLinkedInWorkflow(value: unknown): LinkedInWorkflowId {
    if (value === undefined || value === null || value === '') return 'all';
    if (value === 'all' || value === 'cold-connect' || value === 'connect') return value;
    throw new Error(`Unknown LinkedIn workflow "${String(value)}"`);
}

export function linkedinPointsForWorkflow(workflow: LinkedInWorkflowId): readonly string[] {
    if (workflow === 'all') return LINKEDIN_CALIBRATABLE_POINTS;
    return LINKEDIN_WORKFLOWS[workflow].points;
}

export function linkedinLabelsForWorkflow(workflow: LinkedInWorkflowId): Record<string, string> {
    if (workflow === 'all') return LINKEDIN_POINT_LABELS;
    const defined = LINKEDIN_WORKFLOWS[workflow];
    const labels: Record<string, string> = { ...LINKEDIN_POINT_LABELS };
    for (const name of defined.points) {
        const override = defined.labels[name];
        if (override) labels[name] = override;
    }
    return labels;
}
