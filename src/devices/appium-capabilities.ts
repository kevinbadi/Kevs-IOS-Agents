import type { RegisteredDevice } from './registry.js';

export interface AppiumCapabilitiesOptions {
    appId: string;
    noReset?: boolean;
    forceAppLaunch?: boolean;
}

export function appiumCapabilities(
    device: Pick<RegisteredDevice, 'udid' | 'platform'>,
    options: AppiumCapabilitiesOptions,
): Record<string, unknown> {
    const platform = device.platform ?? 'ios';
    if (platform === 'android') {
        return {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:udid': device.udid,
            'appium:appPackage': options.appId,
            'appium:noReset': options.noReset ?? true,
            ...(options.forceAppLaunch === undefined ? {} : { 'appium:forceAppLaunch': options.forceAppLaunch }),
            'appium:newCommandTimeout': 120,
        };
    }
    return {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': device.udid,
        'appium:bundleId': options.appId,
        'appium:noReset': options.noReset ?? true,
        ...(options.forceAppLaunch === undefined ? {} : { 'appium:forceAppLaunch': options.forceAppLaunch }),
        'appium:newCommandTimeout': 120,
    };
}