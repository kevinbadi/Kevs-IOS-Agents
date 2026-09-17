import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

import { AgentRunnerError, type AgentRunner } from './runner.js';

const RUN_ID = /^[0-9a-f-]{36}$/;

export interface AgentRouteOptions {
    /** URL prefix, e.g. "/api/agent" (cloud) or "/api/agent-local". */
    prefix?: string;
    /** Extra fields merged into the status payload (e.g. local runtime health). */
    status?: () => Promise<Record<string, unknown>>;
}

export function registerAgentRoutes(app: FastifyInstance, runner: AgentRunner, options: AgentRouteOptions = {}): void {
    const prefix = options.prefix ?? '/api/agent';
    app.get(`${prefix}/status`, async () => ({
        configured: runner.configured,
        model: runner.modelName,
        flavor: runner.flavor,
        defaultMaxSteps: runner.defaultMaxSteps,
        ...(options.status ? await options.status() : {}),
    }));

    app.get<{ Querystring: { deviceUdid?: string } }>(`${prefix}/runs`, async (request) => ({
        runs: await runner.list(request.query.deviceUdid),
    }));

    app.post<{ Body: { deviceUdid?: string; goal?: string; maxSteps?: number } }>(`${prefix}/runs`, async (request, reply) => {
        try {
            const run = await runner.start({
                deviceUdid: String(request.body?.deviceUdid ?? ''),
                goal: String(request.body?.goal ?? ''),
                ...(request.body?.maxSteps !== undefined ? { maxSteps: Number(request.body.maxSteps) } : {}),
            });
            return reply.code(201).send(run);
        } catch (error) {
            if (error instanceof AgentRunnerError) return reply.code(error.statusCode).send({ error: error.message });
            throw error;
        }
    });

    app.get<{ Params: { id: string } }>(`${prefix}/runs/:id`, async (request, reply) => {
        const run = await runner.get(request.params.id);
        return run ?? reply.code(404).send({ error: 'Run not found' });
    });

    app.post<{ Params: { id: string } }>(`${prefix}/runs/:id/stop`, async (request, reply) => {
        const run = await runner.stop(request.params.id);
        return run ?? reply.code(404).send({ error: 'Run not found' });
    });

    app.get<{ Params: { id: string; step: string } }>(`${prefix}/runs/:id/steps/:step/screenshot`, async (request, reply) => {
        const index = Number.parseInt(request.params.step, 10);
        if (!RUN_ID.test(request.params.id) || !Number.isInteger(index) || index < 0) {
            return reply.code(404).send({ error: 'Screenshot not found' });
        }
        await runner.get(request.params.id);
        const file = runner.screenshotPath(request.params.id, index);
        if (!file) return reply.code(404).send({ error: 'Screenshot not found' });
        try {
            const body = await readFile(file);
            return reply.type('image/jpeg').header('cache-control', 'private, max-age=3600').send(body);
        } catch {
            return reply.code(404).send({ error: 'Screenshot not found' });
        }
    });
}
