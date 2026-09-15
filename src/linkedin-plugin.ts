import { fileURLToPath } from 'node:url';

import type { PhoneFarmPlugin, TaskDefinition } from './plugin.js';
import type { JsonObject, JsonValue } from './types.js';
import {
    DEFAULT_CONNECT_NOTE,
    LINKEDIN_CONNECTS_PER_RUN,
    linkedInLeadCsvPath,
    parseConnectsPerRun,
    summarizeLinkedInLeadCsvs,
    validateConnectNote,
    validateLinkedInLeadCsvName,
} from './linkedin/leads.js';

export interface LinkedInPluginConfiguration {
    connectEntrypoint?: string;
    bundleId?: string;
}

type ConnectMode = 'plain' | 'note';

type ConnectPayload = JsonObject & {
    mode: ConnectMode;
    leadCsv: string;
    leadLimit: number;
    note?: string;
};

function objectPayload(value: JsonValue): Record<string, JsonValue> {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Payload must be an object');
    return value;
}

function optionalString(value: JsonValue | undefined, name: string): string | undefined {
    if (value === undefined) return;
    if (typeof value !== 'string') throw new Error(`${name} must be a string`);
    return value;
}

function validateConnectPayload(value: JsonValue, expectedMode: ConnectMode): ConnectPayload {
    const input = objectPayload(value);
    const mode = input.mode === undefined ? expectedMode : input.mode;
    if (mode !== expectedMode) throw new Error(`mode must be ${expectedMode}`);
    const leadCsv = validateLinkedInLeadCsvName(optionalString(input.leadCsv, 'leadCsv') ?? '');
    const leadLimit = parseConnectsPerRun(input.leadLimit ?? LINKEDIN_CONNECTS_PER_RUN);
    if (mode === 'note') {
        return {
            mode,
            leadCsv,
            leadLimit,
            note: validateConnectNote(optionalString(input.note, 'note') ?? DEFAULT_CONNECT_NOTE),
        };
    }
    return { mode, leadCsv, leadLimit };
}

function createConnectTask(
    configuration: LinkedInPluginConfiguration,
    mode: ConnectMode,
): TaskDefinition<ConnectPayload> {
    const type = mode === 'plain' ? 'connect' : 'cold-connect';
    const displayName = mode === 'plain' ? 'LinkedIn connection request' : 'LinkedIn cold connect';
    return {
        type, version: 1, displayName,
        validate: (value) => validateConnectPayload(value, mode),
        summarize: (payload) => (mode === 'plain'
            ? `Connection request · ${payload.leadLimit} from ${payload.leadCsv}`
            : `Cold connect · ${payload.leadLimit} from ${payload.leadCsv}`),
        estimateDurationMs: (payload) => Math.max(60_000, payload.leadLimit * 30_000),
        retryPolicy: () => ({ retryLimit: 0, retryDelaySeconds: 0, retryBackoff: false }),
        supportsStop: () => true,
        execute: (context, payload) => context.runProcess({
            entrypoint: configuration.connectEntrypoint
                ?? fileURLToPath(new URL('./linkedin/cold-connect.ts', import.meta.url)),
            env: {
                IOS_UDID: context.device.udid,
                LINKEDIN_BUNDLE_ID: configuration.bundleId ?? 'com.linkedin.LinkedIn',
                LINKEDIN_CONNECT_MODE: payload.mode,
                LINKEDIN_LEADS_CSV: linkedInLeadCsvPath(payload.leadCsv),
                LINKEDIN_LEAD_LIMIT: String(payload.leadLimit),
                ...(payload.note ? { LINKEDIN_CONNECT_NOTE: payload.note } : {}),
            },
        }),
    };
}

export function createLinkedInPlugin(configuration: LinkedInPluginConfiguration = {}): PhoneFarmPlugin {
    return {
        id: 'com.git-agni.linkedin',
        version: '0.1.0',
        displayName: 'LinkedIn automation',
        tasks: [
            createConnectTask(configuration, 'note'),
            createConnectTask(configuration, 'plain'),
        ],
        async registerRoutes(context) {
            const deviceData = async (udid: string) => (await context.loadDevices()).find((device) => device.udid === udid);

            context.app.get('/api/linkedin/leads', async () => ({ lists: await summarizeLinkedInLeadCsvs() }));

            const startRun = async (
                device: NonNullable<Awaited<ReturnType<typeof deviceData>>>,
                body: Record<string, string>,
                mode: ConnectMode,
            ) => {
                if (device.disabled) {
                    throw new Error('This device is disconnected — reconnect it before scheduling automation');
                }
                const taskType = mode === 'plain' ? 'connect' : 'cold-connect';
                const payload = validateConnectPayload({
                    mode,
                    leadCsv: body.lead_csv ?? '',
                    leadLimit: body.lead_limit ? Number(body.lead_limit) : LINKEDIN_CONNECTS_PER_RUN,
                    ...(mode === 'note' ? { note: body.note ?? DEFAULT_CONNECT_NOTE } : {}),
                }, mode);
                const recent = await context.scheduler.listExecutions(50, device.udid);
                const mine = recent.filter(({ pluginId, taskType: type }) => (
                    pluginId === 'com.git-agni.linkedin' && (type === 'connect' || type === 'cold-connect')
                ));
                if (mine.some(({ status }) => status === 'running')) {
                    throw new Error('A LinkedIn connect run is already active on this device. Stop it from Activity, then start again.');
                }
                await context.scheduler.clearDeviceQueue(device.udid, {
                    pluginId: 'com.git-agni.linkedin',
                    taskType,
                    onlyQueued: true,
                });
                await context.scheduler.createTask({
                    deviceUdid: device.udid,
                    task: {
                        pluginId: 'com.git-agni.linkedin', taskType, taskVersion: 1, payload,
                    },
                    timing: { kind: 'now' },
                }, device.pluginData['com.git-agni.linkedin'] ?? {});
            };

            for (const [route, mode] of [
                ['/api/devices/:udid/linkedin/fragments/connect-run', 'plain'],
                ['/api/devices/:udid/linkedin/fragments/cold-connect-run', 'note'],
            ] as const) {
                context.app.post<{ Params: { udid: string }; Body: Record<string, string> }>(
                    route, async (request, reply) => {
                        const device = await deviceData(request.params.udid);
                        if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                        try {
                            await startRun(device, request.body ?? {}, mode);
                            return reply.code(202).type('text/html').send(await context.renderActivity(device.udid));
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            return reply.code(409).type('text/html').send(await context.renderActivity(device.udid, message));
                        }
                    },
                );
            }
        },
    };
}
