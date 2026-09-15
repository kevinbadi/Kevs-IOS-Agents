import assert from 'node:assert/strict';
import test from 'node:test';

import { deviceWaitProblem } from '../src/scheduler/executor.js';

test('deviceWaitProblem names the first missing dependency', () => {
    assert.equal(deviceWaitProblem({
        deviceFound: false, wdaReady: false, appiumReady: false, wdaPort: 8101, appiumPort: 4725,
    }), 'device is offline');
    assert.equal(deviceWaitProblem({
        deviceFound: true, wdaReady: false, appiumReady: true, wdaPort: 8101, appiumPort: 4725,
    }), 'WDA is unavailable on port 8101');
    assert.equal(deviceWaitProblem({
        deviceFound: true, wdaReady: true, appiumReady: false, wdaPort: 8101, appiumPort: 4725,
    }), 'Appium is unavailable on port 4725');
    assert.equal(deviceWaitProblem({
        deviceFound: true, wdaReady: true, appiumReady: true, wdaPort: 8101, appiumPort: 4725,
    }), undefined);
});
