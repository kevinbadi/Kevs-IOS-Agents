import assert from 'node:assert/strict';
import test from 'node:test';

import {
    discoverConnectedAndroidDevices,
    discoverConnectedAndroidDeviceUdids,
} from '../src/devices/android/discovery.js';

test('discoverConnectedAndroidDeviceUdids only returns authorized devices', async () => {
    const calls: string[][] = [];
    const runner = async (_file: string, args: string[]) => {
        calls.push(args);
        return { stdout: 'List of devices attached\nphone-1\tdevice\nphone-2\toffline\nphone-3\tunauthorized\n' };
    };

    assert.deepEqual(await discoverConnectedAndroidDeviceUdids(runner), ['phone-1']);
    assert.deepEqual(calls, [['devices']]);
});

test('discoverConnectedAndroidDevices reads Android model and OS version', async () => {
    const runner = async (_file: string, args: string[]) => {
        if (args[0] === 'devices') return { stdout: 'List of devices attached\nphone-1\tdevice\n' };
        if (args.at(-1) === 'ro.product.model') return { stdout: 'Pixel 8\n' };
        if (args.at(-1) === 'ro.build.version.release') return { stdout: '14\n' };
        throw new Error(`Unexpected adb call: ${args.join(' ')}`);
    };

    assert.deepEqual(await discoverConnectedAndroidDevices(runner), [{
        name: 'Pixel 8',
        modelName: 'Pixel 8',
        osVersion: '14',
        udid: 'phone-1',
        platform: 'android',
    }]);
});