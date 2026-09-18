import { createRequire } from 'node:module';

import { modelNameForProductType } from './coordinates.js';
import { discoverConnectedAndroidDevices } from './android/discovery.js';

const require = createRequire(import.meta.url);
interface IosUtilities {
    getConnectedDevices(): Promise<string[]>;
    getDeviceName(udid: string): Promise<string>;
    getOSVersion(udid: string): Promise<string>;
    getDeviceInfo(udid: string): Promise<{ ProductType?: string; HardwareModel?: string }>;
}
const { utilities } = require('appium-ios-device') as { utilities: IosUtilities };

export interface Device {
    name: string;
    osVersion: string;
    udid: string;
    /** Legacy discovery snapshots omit this and are treated as iOS. */
    platform?: 'ios' | 'android';
    productType?: string;
    hardwareModel?: string;
    modelName?: string;
}

export async function discoverConnectedDeviceUdids(): Promise<string[]> {
    const [iosResult, androidResult] = await Promise.allSettled([
        utilities.getConnectedDevices(),
        discoverConnectedAndroidDevices(),
    ]);
    return Array.from(new Set([
        ...(iosResult.status === 'fulfilled' ? iosResult.value : []),
        ...(androidResult.status === 'fulfilled' ? androidResult.value.map(({ udid }) => udid) : []),
    ]));
}

/** Discover devices from both transports; an unavailable transport is ignored. */
export async function discoverConnectedDevices(): Promise<Device[]> {
    const [iosResult, androidResult] = await Promise.allSettled([
        discoverConnectedIosDevices(),
        discoverConnectedAndroidDevices(),
    ]);
    return [
        ...(iosResult.status === 'fulfilled' ? iosResult.value : []),
        ...(androidResult.status === 'fulfilled' ? androidResult.value : []),
    ];
}

async function discoverConnectedIosDevices(): Promise<Device[]> {
    const udids = await discoverConnectedDeviceUdids();
    return Promise.all(udids.map(async (udid) => {
        const [name, osVersion, info] = await Promise.all([
            utilities.getDeviceName(udid), utilities.getOSVersion(udid), utilities.getDeviceInfo(udid),
        ]);
        const modelName = modelNameForProductType(info.ProductType);
        return {
            name, osVersion, udid, platform: 'ios' as const,
            ...(info.ProductType ? { productType: info.ProductType } : {}),
            ...(info.HardwareModel ? { hardwareModel: info.HardwareModel } : {}),
            ...(modelName ? { modelName } : {}),
        };
    }));
}
