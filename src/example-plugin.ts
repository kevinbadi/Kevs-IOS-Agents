import { createDecisions, type Decisions, type ScreenCatalog } from './decisions/index.js';
import type { PhoneFarmPlugin, TaskDefinition, TaskExecutionContext } from './plugin.js';
import type { JsonObject, JsonValue } from './types.js';

interface OpenAppPayload extends JsonObject {
    bundleId: string;
    waitSeconds: number;
}

/**
 * Comparison flag for the semantic-decision path (src/decisions). Off (the
 * default) runs the original open-app logic byte for byte; on, the task asks
 * the decision model what appeared after launch and clears a system prompt if
 * one is in the way. Both paths stay until the telemetry says which is better.
 */
export const OPEN_APP_DECISIONS_FLAG = 'OPEN_APP_USE_DECISIONS';

export function openAppUsesDecisions(env: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true|yes|on)$/i.test(env[OPEN_APP_DECISIONS_FLAG]?.trim() ?? '');
}

/** What can be on screen right after launching an arbitrary app. */
export const OPEN_APP_SCREENS: ScreenCatalog = {
    'app': "The app's own interface is showing: its content, tabs, feed, or home view, with nothing on top of it",
    'system-prompt': 'An iOS system alert or permission sheet is on top (buttons like Allow, Don\'t Allow, OK, Not Now, Continue, Ask App Not to Track)',
    'sign-in': 'A login, sign-in, sign-up, or onboarding screen asking for credentials or to get started',
    'home-screen': 'The iOS home screen or Spotlight — the app is not in the foreground',
};

const DISMISS_PROMPT_GOAL = 'Dismiss the iOS system prompt without granting anything: prefer "Not Now", "Don\'t Allow", "Ask App Not to Track", "Cancel", or "OK" in that order';
const SETTLE_MS = 1_500;
const AFTER_TAP_MS = 1_200;

/** How the plugin obtains its decision maker; swapped in tests. */
export type DecisionsFactory = (context: TaskExecutionContext) => Decisions;

export interface ExamplePluginOptions {
    env?: NodeJS.ProcessEnv;
    decisions?: DecisionsFactory;
}

const formatPercent = (probability: number): string => `${Math.round(probability * 100)}%`;

export function createOpenAppTask(options: ExamplePluginOptions = {}): TaskDefinition<OpenAppPayload> {
    const env = options.env ?? process.env;
    const decisionsFor: DecisionsFactory = options.decisions
        ?? ((context) => createDecisions({ executionId: context.executionId, deviceUdid: context.device.udid, source: 'example/open-app' }));

    return {
        type: 'open-app',
        version: 1,
        displayName: 'Open an installed app',
        validate(value: JsonValue): OpenAppPayload {
            if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Payload must be an object');
            const bundleId = value.bundleId;
            const waitSeconds = value.waitSeconds;
            if (typeof bundleId !== 'string' || !/^[A-Za-z0-9.-]{3,255}$/.test(bundleId)) {
                throw new Error('bundleId must be a valid application identifier');
            }
            if (!Number.isInteger(waitSeconds) || typeof waitSeconds !== 'number' || waitSeconds < 1 || waitSeconds > 300) {
                throw new Error('waitSeconds must be an integer between 1 and 300');
            }
            return { bundleId, waitSeconds };
        },
        summarize: (payload) => `Open ${payload.bundleId} for ${payload.waitSeconds} seconds`,
        estimateDurationMs: (payload) => payload.waitSeconds * 1_000,
        retryPolicy: () => ({ retryLimit: 1, retryDelaySeconds: 30, retryBackoff: false }),
        supportsStop: () => true,
        async execute(context, payload) {
            try {
                await context.log(`Opening ${payload.bundleId}`);
                await context.automation.activateApp(payload.bundleId);
                if (openAppUsesDecisions(env)) {
                    await openAppWithDecisions(context, payload, decisionsFor(context));
                } else {
                    await context.automation.pause(payload.waitSeconds * 1_000, context.signal);
                }
                return { exitCode: 0, stopped: context.signal.aborted };
            } catch (error) {
                if (context.signal.aborted) return { exitCode: null, stopped: true };
                return { exitCode: null, stopped: false, error: error instanceof Error ? error.message : String(error) };
            }
        },
    };
}

/**
 * The decision path. Every verdict is logged; every escalation falls back to
 * the plain wait so a low-confidence answer can never cause a tap. After a
 * tap, the elements are re-read and a Noul verifies the expected screen
 * appeared — that verification matters more than the pick itself.
 */
async function openAppWithDecisions(context: TaskExecutionContext, payload: OpenAppPayload, decisions: Decisions): Promise<void> {
    const started = Date.now();
    const remaining = () => Math.max(0, payload.waitSeconds * 1_000 - (Date.now() - started));
    const { automation, log, signal } = context;

    if (!decisions.available) {
        await log(`Decisions unavailable (TYPESAFE_API_KEY unset) — ${OPEN_APP_DECISIONS_FLAG} ignored, using the plain wait`);
        await automation.pause(remaining(), signal);
        return;
    }

    await automation.pause(Math.min(SETTLE_MS, remaining()), signal);
    const elements = await automation.elements();
    const screen = await decisions.decideScreen(elements, OPEN_APP_SCREENS, `Just launched ${payload.bundleId}`);
    await log(`Decision · screen=${screen.value} confidence=${formatPercent(screen.confidence)} fits=${screen.fits === undefined ? 'n/a' : formatPercent(screen.fits)} · ${screen.latencyMs} ms · ${screen.escalate ? `ESCALATE (${screen.reason})` : 'act'}`);

    if (screen.escalate) {
        await log('Escalating — no action taken, falling back to the plain wait');
        await automation.pause(remaining(), signal);
        return;
    }

    if (screen.value === 'system-prompt') {
        const pick = await decisions.chooseElement(elements, DISMISS_PROMPT_GOAL);
        await log(`Decision · element=${pick.value ?? 'none'}${pick.element ? ` (${pick.element.role} "${pick.element.label ?? ''}")` : ''} confidence=${formatPercent(pick.confidence)} fits=${pick.fits === undefined ? 'n/a' : formatPercent(pick.fits)} · ${pick.latencyMs} ms · ${pick.escalate ? `ESCALATE (${pick.reason})` : 'act'}`);
        if (!pick.escalate && pick.tapPoint) {
            await log(`Tapping element ${pick.value} at its centre (${pick.tapPoint.x}, ${pick.tapPoint.y})`);
            await automation.tap(pick.tapPoint.x, pick.tapPoint.y);
            await automation.pause(Math.min(AFTER_TAP_MS, remaining()), signal);
            const after = await automation.elements();
            const check = await decisions.ask(after, {
                appeared: "Is the app's own interface now showing, with no system prompt or alert on top of it?",
                promptGone: 'Is the previous system prompt gone from the screen?',
            });
            if (check.escalate) {
                await log(`Verification unavailable (${check.reason}) — could not confirm the app screen appeared`);
            } else {
                await log(`Verification · app screen appeared: ${formatPercent(check.answers.appeared ?? 0)} · prompt gone: ${formatPercent(check.answers.promptGone ?? 0)} · ${check.latencyMs} ms`);
            }
        } else {
            await log('Escalating — leaving the prompt alone');
        }
    } else if (screen.value === 'home-screen') {
        await log(`${payload.bundleId} is not in the foreground; launching once more`);
        await automation.activateApp(payload.bundleId);
    } else if (screen.value === 'sign-in') {
        await log('Sign-in screen detected — nothing to do here, leaving it for the operator');
    }

    await automation.pause(remaining(), signal);
}

export function createExamplePlugin(options: ExamplePluginOptions = {}): PhoneFarmPlugin {
    return {
        id: 'org.phone-farm.example',
        version: '0.1.0',
        displayName: 'Example app launcher',
        tasks: [createOpenAppTask(options)],
    };
}

export const examplePlugin: PhoneFarmPlugin = createExamplePlugin();

export default examplePlugin;
