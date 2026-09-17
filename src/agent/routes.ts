import { readFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';

import { AgentRunnerError, type AgentRunner } from './runner.js';

const RUN_ID = /^[0-9a-f-]{36}$/;

export function registerAgentRoutes(app: FastifyInstance, runner: AgentRunner): void {
    app.get('/api/agent/status', async () => ({
        configured: runner.configured,
        model: runner.modelName,
        defaultMaxSteps: runner.defaultMaxSteps,
    }));

    app.get<{ Querystring: { deviceUdid?: string } }>('/api/agent/runs', async (request) => ({
        runs: await runner.list(request.query.deviceUdid),
    }));

    app.post<{ Body: { deviceUdid?: string; goal?: string; maxSteps?: number } }>('/api/agent/runs', async (request, reply) => {
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

    app.get<{ Params: { id: string } }>('/api/agent/runs/:id', async (request, reply) => {
        const run = await runner.get(request.params.id);
        return run ?? reply.code(404).send({ error: 'Run not found' });
    });

    app.post<{ Params: { id: string } }>('/api/agent/runs/:id/stop', async (request, reply) => {
        const run = await runner.stop(request.params.id);
        return run ?? reply.code(404).send({ error: 'Run not found' });
    });

    app.get<{ Params: { id: string; step: string } }>('/api/agent/runs/:id/steps/:step/screenshot', async (request, reply) => {
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
