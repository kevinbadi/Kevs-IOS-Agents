function element(selector) {
    const value = document.querySelector(selector);
    if (!value)
        throw new Error(`Missing element: ${selector}`);
    return value;
}
const udid = decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) ?? '');
const elements = {
    screen: element('#screen'),
    status: element('#status'),
    statusText: element('#status span:last-child'),
    refresh: element('#refresh'),
    toggle: element('#toggle'),
    recordScreen: element('#record-screen'),
    recordStatus: element('#record-status'),
    remoteButtons: Array.from(document.querySelectorAll('[data-remote-action]')),
    openPost: element('#open-post'),
    openDoomscroll: element('#open-doomscroll'),
    doomscrollDialog: element('#doomscroll-dialog'),
    closeDoomscroll: element('#close-doomscroll'),
    cancelDoomscroll: element('#cancel-doomscroll'),
    doomscrollDuration: element('#doomscroll-duration'),
    doomscrollDurationButtons: Array.from(document.querySelectorAll('[data-doomscroll-duration]')),
    postDialog: element('#post-dialog'),
    postForm: element('#post-form'),
    closePost: element('#close-post'),
    cancelPost: element('#cancel-post'),
    submitPost: element('#submit-post'),
    media: element('#media'),
    mediaList: element('#media-list'),
    musicUrl: element('#music-url'),
    caption: element('#caption'),
    postAccount: element('#post-account'),
    publishConfirm: element('#publish-confirm'),
    confirmPublish: element('#confirm-publish'),
    postResult: element('#post-result'),
    doomscrollForm: element('#doomscroll-form'),
    doomscrollRecurring: element('#doomscroll-recurring'),
    doomscrollStartOptions: element('#doomscroll-start-options'),
    doomscrollStartKind: element('#doomscroll-start-kind'),
    doomscrollOnceFields: element('#doomscroll-once-fields'),
    doomscrollRecurringFields: element('#doomscroll-recurring-fields'),
    doomscrollFrequency: element('#doomscroll-frequency'),
    doomscrollWeekdayFields: element('#doomscroll-weekday-fields'),
    doomscrollWeekdayInputs: Array.from(document.querySelectorAll('#doomscroll-weekday-fields input[type="checkbox"]')),
    doomscrollRunWindowField: element('#doomscroll-run-window-field'),
    doomscrollScheduleKind: element('#doomscroll-schedule-kind'),
    doomscrollWeekdays: element('#doomscroll-weekdays'),
    doomscrollRunAt: element('#doomscroll-run-at'),
    doomscrollRunAtIso: element('#doomscroll-run-at-iso'),
    doomscrollResult: element('#doomscroll-result'),
    doomscrollCommentEnabled: element('#doomscroll-comment-enabled'),
    doomscrollCommentText: element('#doomscroll-comment-text'),
    openFollowingDoomscroll: element('#open-following-doomscroll'),
    followingDoomscrollDialog: element('#following-doomscroll-dialog'),
    closeFollowingDoomscroll: element('#close-following-doomscroll'),
    cancelFollowingDoomscroll: element('#cancel-following-doomscroll'),
    followingDoomscrollForm: element('#following-doomscroll-form'),
    followingDoomscrollDuration: element('#following-doomscroll-duration'),
    followingDoomscrollDurationButtons: Array.from(document.querySelectorAll('[data-following-doomscroll-duration]')),
    followingCommentEnabled: element('#following-comment-enabled'),
    followingCommentText: element('#following-comment-text'),
    followingDoomscrollResult: element('#following-doomscroll-result'),
    trainToggle: element('#train-toggle'),
    trainSave: element('#train-save'),
    trainClear: element('#train-clear'),
    trainStatus: element('#train-status'),
    trainSteps: element('#train-steps'),
    trainSaveDialog: element('#train-save-dialog'),
    trainSaveForm: element('#train-save-form'),
    closeTrainSave: element('#close-train-save'),
    cancelTrainSave: element('#cancel-train-save'),
    trainWorkflowName: element('#train-workflow-name'),
    trainWorkflowFeed: element('#train-workflow-feed'),
    trainSaveResult: element('#train-save-result'),
    refreshWorkflows: element('#refresh-workflows'),
    workflowList: element('#workflow-list'),
    openInstagramDoomscroll: element('#open-instagram-doomscroll'),
    instagramDoomscrollDialog: element('#instagram-doomscroll-dialog'),
    closeInstagramDoomscroll: element('#close-instagram-doomscroll'),
    cancelInstagramDoomscroll: element('#cancel-instagram-doomscroll'),
    instagramDoomscrollDuration: element('#instagram-doomscroll-duration'),
    instagramDoomscrollDurationButtons: Array.from(document.querySelectorAll('[data-instagram-doomscroll-duration]')),
    openInstagramFollowingDoomscroll: element('#open-instagram-following-doomscroll'),
    instagramFollowingDoomscrollDialog: element('#instagram-following-doomscroll-dialog'),
    closeInstagramFollowingDoomscroll: element('#close-instagram-following-doomscroll'),
    cancelInstagramFollowingDoomscroll: element('#cancel-instagram-following-doomscroll'),
    instagramFollowingDoomscrollForm: element('#instagram-following-doomscroll-form'),
    instagramFollowingDoomscrollDuration: element('#instagram-following-doomscroll-duration'),
    instagramFollowingDoomscrollDurationButtons: Array.from(document.querySelectorAll('[data-instagram-following-doomscroll-duration]')),
    instagramFollowingCommentEnabled: element('#instagram-following-comment-enabled'),
    instagramFollowingCommentText: element('#instagram-following-comment-text'),
    instagramFollowingDoomscrollResult: element('#instagram-following-doomscroll-result'),
    openInstagramColdDms: element('#open-instagram-cold-dms'),
    instagramColdDmsDialog: element('#instagram-cold-dms-dialog'),
    closeInstagramColdDms: element('#close-instagram-cold-dms'),
    cancelInstagramColdDms: element('#cancel-instagram-cold-dms'),
    instagramColdDmsForm: element('#instagram-cold-dms-form'),
    instagramColdDmsAccount: element('#instagram-cold-dms-account'),
    instagramColdDmsLeadList: element('#instagram-cold-dms-lead-list'),
    instagramColdDmsLeadFields: element('#instagram-cold-dms-lead-fields'),
    instagramColdDmsHandles: element('#instagram-cold-dms-handles'),
    instagramColdDmsResult: element('#instagram-cold-dms-result'),
    instagramDoomscrollForm: element('#instagram-doomscroll-form'),
    instagramCommentEnabled: element('#instagram-comment-enabled'),
    instagramCommentText: element('#instagram-comment-text'),
    instagramDoomscrollRecurring: element('#instagram-doomscroll-recurring'),
    instagramDoomscrollStartOptions: element('#instagram-doomscroll-start-options'),
    instagramDoomscrollStartKind: element('#instagram-doomscroll-start-kind'),
    instagramDoomscrollOnceFields: element('#instagram-doomscroll-once-fields'),
    instagramDoomscrollRecurringFields: element('#instagram-doomscroll-recurring-fields'),
    instagramDoomscrollFrequency: element('#instagram-doomscroll-frequency'),
    instagramDoomscrollWeekdayFields: element('#instagram-doomscroll-weekday-fields'),
    instagramDoomscrollWeekdayInputs: Array.from(document.querySelectorAll('#instagram-doomscroll-weekday-fields input[type="checkbox"]')),
    instagramDoomscrollRunWindowField: element('#instagram-doomscroll-run-window-field'),
    instagramDoomscrollScheduleKind: element('#instagram-doomscroll-schedule-kind'),
    instagramDoomscrollWeekdays: element('#instagram-doomscroll-weekdays'),
    instagramDoomscrollRunAt: element('#instagram-doomscroll-run-at'),
    instagramDoomscrollRunAtIso: element('#instagram-doomscroll-run-at-iso'),
    instagramDoomscrollResult: element('#instagram-doomscroll-result'),
    timezoneInputs: Array.from(document.querySelectorAll('.browser-timezone')),
    postRecurring: element('#post-recurring'),
    postStartOptions: element('#post-start-options'),
    postStartKind: element('#post-start-kind'),
    postOnceFields: element('#post-once-fields'),
    postRecurringFields: element('#post-recurring-fields'),
    postFrequency: element('#post-frequency'),
    postWeekdayFields: element('#post-weekday-fields'),
    postWeekdayInputs: Array.from(document.querySelectorAll('#post-weekday-fields input[type="checkbox"]')),
    postRunWindowField: element('#post-run-window-field'),
    postRunAt: element('#post-run-at'),
    postLocalTime: element('#post-local-time'),
    postRunWindow: element('#post-run-window'),
    accountsForm: element('#accounts-form'),
    deviceAccounts: element('#device-accounts'),
    accountsResult: element('#accounts-result'),
    accountsDialog: element('#accounts-dialog'),
    openAccounts: element('#open-accounts'),
    closeAccounts: element('#close-accounts'),
    instagramAccountsForm: element('#instagram-accounts-form'),
    instagramDeviceAccounts: element('#instagram-device-accounts'),
    instagramAccountsResult: element('#instagram-accounts-result'),
    instagramAccountsDialog: element('#instagram-accounts-dialog'),
    openInstagramAccounts: element('#open-instagram-accounts'),
    closeInstagramAccounts: element('#close-instagram-accounts'),
    passcodeDialog: element('#passcode-dialog'),
    openPasscode: element('#open-passcode'),
    closePasscode: element('#close-passcode'),
    removeDialog: element('#remove-dialog'),
    openRemove: element('#open-remove'),
    closeRemove: element('#close-remove'),
    deviceSchedules: element('#device-schedules'),
    deviceExecutions: element('#device-executions'),
    deviceQueueStatus: element('#device-queue-status'),
    clearDeviceQueue: element('#clear-device-queue'),
    tasksDialog: element('#tasks-dialog'),
    openTasks: element('#open-tasks'),
    closeTasks: element('#close-tasks'),
    passcodeForm: element('#passcode-form'),
    devicePasscode: element('#device-passcode'),
    passcodeClear: element('#passcode-clear'),
    passcodeState: element('#passcode-state'),
    passcodeResult: element('#passcode-result'),
    openCalibrate: element('#open-calibrate'),
    openLinkedInColdConnect: element('#open-linkedin-cold-connect'),
    openLinkedInConnect: element('#open-linkedin-connect'),
    linkedinConnectDialog: element('#linkedin-connect-dialog'),
    closeLinkedInConnect: element('#close-linkedin-connect'),
    cancelLinkedInConnect: element('#cancel-linkedin-connect'),
    linkedinConnectForm: element('#linkedin-connect-form'),
    linkedinConnectLeadCsv: element('#linkedin-connect-lead-csv'),
    linkedinConnectResult: element('#linkedin-connect-result'),
    linkedinConnectCalibrate: element('#linkedin-connect-calibrate'),
    linkedinColdConnectDialog: element('#linkedin-cold-connect-dialog'),
    closeLinkedInColdConnect: element('#close-linkedin-cold-connect'),
    cancelLinkedInColdConnect: element('#cancel-linkedin-cold-connect'),
    linkedinColdConnectForm: element('#linkedin-cold-connect-form'),
    linkedinColdConnectLeadCsv: element('#linkedin-cold-connect-lead-csv'),
    linkedinColdConnectResult: element('#linkedin-cold-connect-result'),
    linkedinColdConnectCalibrate: element('#linkedin-cold-connect-calibrate'),
    calibrateDialog: element('#calibrate-dialog'),
    closeCalibrate: element('#close-calibrate'),
    calApp: element('#cal-app'),
    calWorkflow: element('#cal-workflow'),
    calWorkflowWrap: element('#cal-workflow-wrap'),
    calScreen: element('#cal-screen'),
    calControl: element('#cal-control'),
    calUnlock: element('#cal-unlock'),
    calMarkers: element('#cal-markers'),
    calPoints: element('#cal-points'),
    calStatus: element('#cal-status'),
    calProfile: element('#cal-profile'),
    calResetAll: element('#cal-reset-all'),
    calCancel: element('#cal-cancel'),
    calSave: element('#cal-save'),
    removeDevice: element('#remove-device'),
    removeResult: element('#remove-result'),
};
let screenSize;
let paused = false;
let connecting = false;
let pointerStart;
let trainRecording = false;
let trainStartedAt = 0;
let trainEvents = [];
const SCREEN_RECORD_MAX_MS = 10 * 60_000;
const SCREEN_RECORD_FPS = 12;
let screenCapture;
function pickScreenRecorderMimeType() {
    const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
    ];
    for (const type of candidates) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type))
            return type;
    }
    return '';
}
function formatRecordElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
function updateRecordUi(recording, message = '') {
    elements.recordScreen.classList.toggle('recording', recording);
    elements.recordScreen.textContent = recording ? 'Stop & download' : 'Record screen';
    elements.recordStatus.hidden = !message;
    elements.recordStatus.textContent = message;
}
function drawScreenCaptureFrame(session) {
    const image = elements.screen;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width > 0 && height > 0) {
        if (session.canvas.width !== width || session.canvas.height !== height) {
            session.canvas.width = width;
            session.canvas.height = height;
        }
        try {
            session.context.drawImage(image, 0, 0, width, height);
        }
        catch {
            // Frame may be mid-decode; skip and keep recording.
        }
    }
    session.frameHandle = window.setTimeout(() => drawScreenCaptureFrame(session), Math.round(1000 / SCREEN_RECORD_FPS));
}
function downloadScreenCapture(blob, mimeType) {
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const shortUdid = udid.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'device';
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ios-agents-${shortUdid}-${stamp}.${extension}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
async function stopScreenCapture(reason = 'Recording saved') {
    const session = screenCapture;
    if (!session)
        return;
    screenCapture = undefined;
    window.clearTimeout(session.frameHandle);
    window.clearInterval(session.tickHandle);
    await new Promise((resolve) => {
        session.recorder.addEventListener('stop', () => resolve(), { once: true });
        if (session.recorder.state !== 'inactive')
            session.recorder.stop();
        else
            resolve();
    });
    for (const track of session.stream.getTracks())
        track.stop();
    const blob = new Blob(session.chunks, { type: session.mimeType || 'video/webm' });
    if (blob.size > 0) {
        downloadScreenCapture(blob, blob.type || session.mimeType);
        updateRecordUi(false, `${reason} · ${(blob.size / (1024 * 1024)).toFixed(1)} MB`);
    }
    else {
        updateRecordUi(false, 'Recording produced an empty file — keep the live stream visible and try again.');
    }
}
async function startScreenCapture() {
    if (screenCapture)
        return;
    if (typeof MediaRecorder === 'undefined') {
        updateRecordUi(false, 'This browser cannot record canvas video.');
        return;
    }
    if (paused || !elements.screen.getAttribute('src')) {
        updateRecordUi(false, 'Start the live stream before recording.');
        return;
    }
    const mimeType = pickScreenRecorderMimeType();
    if (!mimeType) {
        updateRecordUi(false, 'No supported MediaRecorder codec in this browser.');
        return;
    }
    // Wait briefly for the first MJPEG frame dimensions.
    const readyAt = Date.now() + 2_500;
    while (Date.now() < readyAt && (!elements.screen.naturalWidth || !elements.screen.naturalHeight)) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    const width = elements.screen.naturalWidth || screenSize?.width || 390;
    const height = elements.screen.naturalHeight || screenSize?.height || 844;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
        updateRecordUi(false, 'Could not open a drawing surface for recording.');
        return;
    }
    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.drawImage(elements.screen, 0, 0, width, height);
    const stream = canvas.captureStream(SCREEN_RECORD_FPS);
    const chunks = [];
    let recorder;
    try {
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
    }
    catch (error) {
        updateRecordUi(false, errorMessage(error));
        for (const track of stream.getTracks())
            track.stop();
        return;
    }
    const session = {
        recorder,
        chunks,
        canvas,
        context,
        stream,
        startedAt: Date.now(),
        frameHandle: 0,
        tickHandle: 0,
        mimeType,
    };
    recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0)
            chunks.push(event.data);
    });
    recorder.addEventListener('error', () => {
        void stopScreenCapture('Recording stopped after an encoder error');
    });
    screenCapture = session;
    recorder.start(1_000);
    drawScreenCaptureFrame(session);
    session.tickHandle = window.setInterval(() => {
        if (!screenCapture)
            return;
        const elapsed = Date.now() - screenCapture.startedAt;
        updateRecordUi(true, `Recording ${formatRecordElapsed(elapsed)}`);
        if (elapsed >= SCREEN_RECORD_MAX_MS) {
            void stopScreenCapture('Auto-stopped at 10 minutes');
        }
    }, 500);
    updateRecordUi(true, 'Recording 0:00');
}
function summarizeTrainAction(action) {
    if (action.type === 'tap')
        return `tap (${action.x}, ${action.y})`;
    if (action.type === 'swipe') {
        return `swipe (${action.startX},${action.startY})→(${action.endX},${action.endY})`;
    }
    return action.type;
}
function renderTrainSteps() {
    elements.trainSteps.innerHTML = '';
    for (const event of trainEvents) {
        const li = document.createElement('li');
        li.textContent = `+${event.t}ms · ${summarizeTrainAction(event.action)}`;
        elements.trainSteps.append(li);
    }
    elements.trainSteps.hidden = trainEvents.length === 0;
    elements.trainStatus.textContent = trainRecording
        ? `Recording… ${trainEvents.length} gesture${trainEvents.length === 1 ? '' : 's'}`
        : (trainEvents.length ? `${trainEvents.length} gestures ready to save` : '');
}
function recordTrainEvent(action) {
    if (!trainRecording)
        return;
    const t = Math.max(0, Math.round(performance.now() - trainStartedAt));
    trainEvents.push({ t, action });
    renderTrainSteps();
}
function setTrainRecording(active) {
    trainRecording = active;
    if (active) {
        trainStartedAt = performance.now();
        trainEvents = [];
    }
    elements.trainToggle.textContent = active ? 'Stop training' : 'Train workflow';
    elements.trainSave.hidden = active || trainEvents.length === 0;
    elements.trainClear.hidden = trainEvents.length === 0 && !active;
    renderTrainSteps();
}
let orderedMedia = [];
let postPoll;
let connectionPoll;
let connectionChecking = false;
const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
elements.timezoneInputs.forEach((input) => { input.value = browserTimezone; });
function selectedWeekdays(inputs) {
    return inputs.filter(({ checked }) => checked).map(({ value }) => Number(value));
}
function updateDoomscrollSchedule() {
    const recurring = elements.doomscrollRecurring.checked;
    const kind = recurring ? elements.doomscrollFrequency.value : elements.doomscrollStartKind.value;
    elements.doomscrollScheduleKind.value = kind;
    elements.doomscrollWeekdays.value = selectedWeekdays(elements.doomscrollWeekdayInputs).join(',');
    elements.doomscrollStartOptions.hidden = recurring;
    elements.doomscrollOnceFields.hidden = recurring || kind !== 'once';
    elements.doomscrollRecurringFields.hidden = !recurring;
    elements.doomscrollWeekdayFields.hidden = !recurring || kind !== 'weekly';
    elements.doomscrollRunWindowField.hidden = kind === 'now';
    elements.doomscrollRunAt.required = kind === 'once';
}
function updateInstagramDoomscrollSchedule() {
    const recurring = elements.instagramDoomscrollRecurring.checked;
    const kind = recurring ? elements.instagramDoomscrollFrequency.value : elements.instagramDoomscrollStartKind.value;
    elements.instagramDoomscrollScheduleKind.value = kind;
    elements.instagramDoomscrollWeekdays.value = selectedWeekdays(elements.instagramDoomscrollWeekdayInputs).join(',');
    elements.instagramDoomscrollStartOptions.hidden = recurring;
    elements.instagramDoomscrollOnceFields.hidden = recurring || kind !== 'once';
    elements.instagramDoomscrollRecurringFields.hidden = !recurring;
    elements.instagramDoomscrollWeekdayFields.hidden = !recurring || kind !== 'weekly';
    elements.instagramDoomscrollRunWindowField.hidden = kind === 'now';
    elements.instagramDoomscrollRunAt.required = kind === 'once';
}
function updatePostSchedule() {
    const recurring = elements.postRecurring.checked;
    const kind = recurring ? elements.postFrequency.value : elements.postStartKind.value;
    elements.postStartOptions.hidden = recurring;
    elements.postOnceFields.hidden = recurring || kind !== 'once';
    elements.postRecurringFields.hidden = !recurring;
    elements.postWeekdayFields.hidden = !recurring || kind !== 'weekly';
    elements.postRunWindowField.hidden = kind === 'now';
    elements.postRunAt.required = kind === 'once';
}
elements.doomscrollRecurring.addEventListener('change', updateDoomscrollSchedule);
elements.doomscrollStartKind.addEventListener('change', updateDoomscrollSchedule);
elements.doomscrollFrequency.addEventListener('change', updateDoomscrollSchedule);
elements.doomscrollWeekdayInputs.forEach((input) => input.addEventListener('change', updateDoomscrollSchedule));
elements.instagramDoomscrollRecurring.addEventListener('change', updateInstagramDoomscrollSchedule);
elements.instagramDoomscrollStartKind.addEventListener('change', updateInstagramDoomscrollSchedule);
elements.instagramDoomscrollFrequency.addEventListener('change', updateInstagramDoomscrollSchedule);
elements.instagramDoomscrollWeekdayInputs.forEach((input) => input.addEventListener('change', updateInstagramDoomscrollSchedule));
elements.postRecurring.addEventListener('change', updatePostSchedule);
elements.postStartKind.addEventListener('change', updatePostSchedule);
elements.postFrequency.addEventListener('change', updatePostSchedule);
elements.doomscrollForm.addEventListener('submit', () => {
    updateDoomscrollSchedule();
    elements.doomscrollResult.textContent = 'Starting…';
    elements.doomscrollRunAtIso.value = elements.doomscrollRunAt.value
        ? new Date(elements.doomscrollRunAt.value).toISOString()
        : '';
});
elements.instagramDoomscrollForm.addEventListener('submit', () => {
    updateInstagramDoomscrollSchedule();
    elements.instagramDoomscrollResult.textContent = 'Starting…';
    elements.instagramDoomscrollRunAtIso.value = elements.instagramDoomscrollRunAt.value
        ? new Date(elements.instagramDoomscrollRunAt.value).toISOString()
        : '';
});
elements.openDoomscroll.addEventListener('click', () => elements.doomscrollDialog.showModal());
elements.doomscrollCommentEnabled.addEventListener('change', () => {
    elements.doomscrollCommentText.disabled = !elements.doomscrollCommentEnabled.checked;
    if (elements.doomscrollCommentEnabled.checked && !elements.doomscrollCommentText.value.trim()) {
        elements.doomscrollCommentText.value = '🔥';
    }
});
elements.closeDoomscroll.addEventListener('click', () => elements.doomscrollDialog.close());
elements.cancelDoomscroll.addEventListener('click', () => elements.doomscrollDialog.close());
elements.doomscrollDurationButtons.forEach((button) => {
    button.addEventListener('click', () => {
        elements.doomscrollDuration.value = button.dataset.doomscrollDuration ?? '';
    });
});
elements.openInstagramDoomscroll.addEventListener('click', () => elements.instagramDoomscrollDialog.showModal());
elements.closeInstagramDoomscroll.addEventListener('click', () => elements.instagramDoomscrollDialog.close());
elements.cancelInstagramDoomscroll.addEventListener('click', () => elements.instagramDoomscrollDialog.close());
elements.instagramDoomscrollDurationButtons.forEach((button) => {
    button.addEventListener('click', () => {
        elements.instagramDoomscrollDuration.value = button.dataset.instagramDoomscrollDuration ?? '';
    });
});
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function setStatus(message, state = '') {
    elements.status.className = `status ${state}`;
    elements.statusText.textContent = message;
}
async function jsonRequest(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok)
        throw new Error(data.error ?? `Request failed (${response.status})`);
    return data;
}
function startStream() {
    if (paused || !screenSize)
        return;
    setStatus('Connecting video stream…');
    elements.screen.src = `/api/devices/${encodeURIComponent(udid)}/remote/stream?t=${Date.now()}`;
}
/** Drop MJPEG during post/upload — Photos + Create + FYP cold-start piles on WDA harder than warmup swipes. */
function pauseStreamForAutomation(message = 'Video stream paused during post (keeps WDA stable)') {
    if (paused && !elements.screen.getAttribute('src'))
        return;
    paused = true;
    elements.toggle.textContent = 'Resume stream';
    if (screenCapture)
        void stopScreenCapture('Recording stopped — automation started');
    elements.screen.removeAttribute('src');
    setStatus(message);
}
async function connectRemote() {
    if (paused || connecting || !screenSize)
        return;
    connecting = true;
    try {
        startStream();
    }
    finally {
        connecting = false;
    }
}
async function pollConnection(reloadWhenReady = false) {
    if (connectionChecking)
        return;
    connectionChecking = true;
    window.clearTimeout(connectionPoll);
    try {
        const connection = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/connection`);
        if (connection.wda === 'ready') {
            if (reloadWhenReady) {
                location.reload();
                return;
            }
            connectionPoll = window.setTimeout(() => void connectRemote(), 2_000);
            return;
        }
        const appium = connection.appium === 'ready' ? '' : ' Appium is unavailable.';
        setStatus(`${connection.message}.${appium}`.replace('..', '.'), connection.wda === 'error' ? 'error' : '');
        connectionPoll = window.setTimeout(() => void pollConnection(reloadWhenReady), 2_000);
    }
    catch (error) {
        setStatus(errorMessage(error), 'error');
        connectionPoll = window.setTimeout(() => void pollConnection(reloadWhenReady), 2_000);
    }
    finally {
        connectionChecking = false;
    }
}
function useDeviceSummary(summary) {
    const width = Number(summary.dataset.screenWidth);
    const height = Number(summary.dataset.screenHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height))
        return;
    screenSize = { width, height };
    const name = summary.querySelector('h1')?.textContent;
    if (name)
        document.title = `${name} · iOS Automation`;
    void connectRemote();
}
document.addEventListener('htmx:afterSwap', () => {
    const summary = document.querySelector('#device-summary[data-screen-width]');
    if (summary)
        useDeviceSummary(summary);
});
document.addEventListener('htmx:afterRequest', (event) => {
    const detail = event.detail;
    if (detail?.elt === elements.doomscrollForm) {
        if (detail.successful) {
            elements.doomscrollResult.textContent = '';
            elements.doomscrollDialog.close();
        }
        else {
            const message = detail.xhr?.responseText?.match(/<p class="run-error">([^<]+)<\/p>/)?.[1]
                ?? 'Could not start doomscroll. Check Activity for details.';
            elements.doomscrollResult.textContent = message.trim();
        }
    }
    if (detail?.elt === elements.instagramDoomscrollForm) {
        if (detail.successful) {
            elements.instagramDoomscrollResult.textContent = '';
            elements.instagramDoomscrollDialog.close();
        }
        else {
            const message = detail.xhr?.responseText?.match(/<p class="run-error">([^<]+)<\/p>/)?.[1]
                ?? 'Could not start doomscroll. Check Activity for details.';
            elements.instagramDoomscrollResult.textContent = message.trim();
        }
    }
});
function containContentBox(element, mediaWidth, mediaHeight) {
    const rect = element.getBoundingClientRect();
    const mw = mediaWidth > 0 ? mediaWidth : rect.width;
    const mh = mediaHeight > 0 ? mediaHeight : rect.height;
    const scale = Math.min(rect.width / mw, rect.height / mh);
    const width = mw * scale;
    const height = mh * scale;
    return {
        left: rect.left + (rect.width - width) / 2,
        top: rect.top + (rect.height - height) / 2,
        width,
        height,
        elementWidth: rect.width,
        elementHeight: rect.height,
    };
}
/** Map a pointer event on an object-fit:contain image to device points. */
function pointFromContainedMedia(event, img, deviceSize) {
    const mediaW = img.naturalWidth || deviceSize.width;
    const mediaH = img.naturalHeight || deviceSize.height;
    const box = containContentBox(img, mediaW, mediaH);
    if (box.width <= 0 || box.height <= 0) {
        throw new Error('Screen content size is unavailable');
    }
    const x = ((event.clientX - box.left) / box.width) * deviceSize.width;
    const y = ((event.clientY - box.top) / box.height) * deviceSize.height;
    return {
        x: Math.max(0, Math.min(deviceSize.width, Math.round(x))),
        y: Math.max(0, Math.min(deviceSize.height, Math.round(y))),
    };
}
function pointFromEvent(event) {
    if (!screenSize)
        throw new Error('Screen dimensions are unavailable');
    return pointFromContainedMedia(event, elements.screen, screenSize);
}
async function sendAction(action) {
    setStatus('Sending input…');
    elements.remoteButtons.forEach((button) => { button.disabled = true; });
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/remote/action`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(action),
        });
        if (trainRecording)
            recordTrainEvent(action);
        setStatus(action.type === 'tap' ? `Tapped (${action.x}, ${action.y})` : 'Remote connected', 'ready');
    }
    catch (error) {
        setStatus(errorMessage(error), 'error');
    }
    finally {
        elements.remoteButtons.forEach((button) => { button.disabled = false; });
    }
}
function directionalSwipe(direction) {
    if (!screenSize) {
        setStatus('Screen dimensions are unavailable', 'error');
        return;
    }
    const left = Math.round(screenSize.width * 0.22);
    const right = Math.round(screenSize.width * 0.78);
    const top = Math.round(screenSize.height * 0.25);
    const bottom = Math.round(screenSize.height * 0.75);
    const centerX = Math.round(screenSize.width / 2);
    const centerY = Math.round(screenSize.height / 2);
    const points = {
        left: [right, centerY, left, centerY],
        right: [left, centerY, right, centerY],
        up: [centerX, bottom, centerX, top],
        down: [centerX, top, centerX, bottom],
    };
    const [startX, startY, endX, endY] = points[direction];
    return { type: 'swipe', startX, startY, endX, endY, durationMs: 350 };
}
elements.remoteButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const action = button.dataset.remoteAction;
        if (action === 'home' || action === 'lock' || action === 'wake'
            || action === 'unlock' || action === 'volumeUp' || action === 'volumeDown') {
            void sendAction({ type: action });
            return;
        }
        if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
            const swipe = directionalSwipe(action);
            if (swipe)
                void sendAction(swipe);
        }
    });
});
elements.screen.addEventListener('pointerdown', (event) => {
    if (!screenSize)
        return;
    elements.screen.setPointerCapture(event.pointerId);
    pointerStart = { ...pointFromEvent(event), time: performance.now() };
});
elements.screen.addEventListener('pointerup', (event) => {
    if (!pointerStart || !screenSize)
        return;
    const end = pointFromEvent(event);
    const start = pointerStart;
    pointerStart = undefined;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance < 12) {
        void sendAction({ type: 'tap', x: end.x, y: end.y });
    }
    else {
        const durationMs = Math.max(150, Math.min(1200, Math.round(performance.now() - (start.time ?? 0))));
        void sendAction({
            type: 'swipe',
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
            durationMs,
        });
    }
});
elements.screen.addEventListener('pointercancel', () => { pointerStart = undefined; });
elements.screen.addEventListener('load', () => setStatus('Live video connected', 'ready'));
elements.screen.addEventListener('error', () => {
    if (paused)
        return;
    elements.screen.removeAttribute('src');
    if (screenCapture)
        void stopScreenCapture('Recording stopped — stream disconnected');
    setStatus('Video stream disconnected; checking the phone connection…', 'error');
    void pollConnection();
});
elements.refresh.addEventListener('click', async () => {
    elements.refresh.disabled = true;
    window.clearTimeout(connectionPoll);
    if (screenCapture)
        await stopScreenCapture('Recording stopped — reconnecting');
    elements.screen.removeAttribute('src');
    setStatus('Restarting the phone connection…');
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/reconnect`, { method: 'POST' });
        elements.refresh.disabled = false;
        void pollConnection(true);
    }
    catch (error) {
        setStatus(errorMessage(error), 'error');
        elements.refresh.disabled = false;
    }
});
elements.toggle.addEventListener('click', () => {
    paused = !paused;
    elements.toggle.textContent = paused ? 'Resume stream' : 'Pause stream';
    if (paused) {
        if (screenCapture)
            void stopScreenCapture('Recording stopped — stream paused');
        elements.screen.removeAttribute('src');
        setStatus('Video stream paused');
    }
    else {
        void connectRemote();
    }
});
elements.recordScreen.addEventListener('click', () => {
    if (screenCapture) {
        void stopScreenCapture('Recording saved');
        return;
    }
    void startScreenCapture();
});
window.addEventListener('beforeunload', () => {
    if (!screenCapture)
        return;
    window.clearTimeout(screenCapture.frameHandle);
    window.clearInterval(screenCapture.tickHandle);
    if (screenCapture.recorder.state !== 'inactive')
        screenCapture.recorder.stop();
    for (const track of screenCapture.stream.getTracks())
        track.stop();
});
function renderMedia() {
    elements.mediaList.replaceChildren(...orderedMedia.map((file, index) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${index + 1}. ${file.name}`;
        const up = document.createElement('button');
        up.type = 'button';
        up.textContent = '↑';
        up.title = 'Move earlier';
        up.disabled = index === 0;
        const down = document.createElement('button');
        down.type = 'button';
        down.textContent = '↓';
        down.title = 'Move later';
        down.disabled = index === orderedMedia.length - 1;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        up.addEventListener('click', () => { [orderedMedia[index - 1], orderedMedia[index]] = [orderedMedia[index], orderedMedia[index - 1]]; renderMedia(); });
        down.addEventListener('click', () => { [orderedMedia[index], orderedMedia[index + 1]] = [orderedMedia[index + 1], orderedMedia[index]]; renderMedia(); });
        remove.addEventListener('click', () => { orderedMedia.splice(index, 1); renderMedia(); });
        item.append(name, up, down, remove);
        return item;
    }));
}
function selectedDestination() {
    // Publish-only for now — scheduling is via Start / Recurring, not Drafts.
    return 'publish';
}
function postTiming() {
    const kind = elements.postRecurring.checked ? elements.postFrequency.value : elements.postStartKind.value;
    if (kind === 'now')
        return { kind };
    if (kind === 'once') {
        if (!elements.postRunAt.value)
            throw new Error('Choose a one-time start date');
        return { kind, runAt: new Date(elements.postRunAt.value).toISOString() };
    }
    if (kind === 'daily')
        return { kind, localTime: elements.postLocalTime.value, timezone: browserTimezone };
    const weekdays = selectedWeekdays(elements.postWeekdayInputs);
    if (weekdays.length === 0)
        throw new Error('Choose at least one recurring day');
    return {
        kind: 'weekly', localTime: elements.postLocalTime.value, timezone: browserTimezone,
        weekdays,
    };
}
function updateDestination() {
    elements.publishConfirm.classList.add('visible');
    elements.submitPost.textContent = 'Publish';
}
async function pollPost() {
    try {
        const run = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/posts/current`);
        elements.postResult.textContent = run.status === 'running'
            ? 'Post automation is running. Follow its live output in the Automation log.'
            : '';
        if (run.status === 'running') {
            pauseStreamForAutomation();
            postPoll = window.setTimeout(() => void pollPost(), 1000);
        }
        else {
            elements.submitPost.disabled = false;
            elements.postResult.textContent = run.status === 'succeeded'
                ? 'Completed: post published.'
                : 'Automation failed. Review the Automation log and the phone screen.';
        }
    }
    catch (error) {
        elements.postResult.textContent = errorMessage(error);
        elements.submitPost.disabled = false;
    }
}
function formatDate(value) {
    return value ? new Date(value).toLocaleString() : '—';
}
function taskActionButton(label, action) {
    const buttonElement = document.createElement('button');
    buttonElement.className = 'icon-button';
    buttonElement.type = 'button';
    buttonElement.textContent = label;
    buttonElement.addEventListener('click', () => {
        void (async () => {
            try {
                await action();
                await loadDeviceTasks();
            }
            catch (error) {
                window.alert(errorMessage(error));
            }
        })();
    });
    return buttonElement;
}
function pluginLabel(pluginId) {
    if (pluginId === 'com.git-agni.instagram')
        return 'Instagram';
    if (pluginId === 'com.git-agni.tiktok')
        return 'TikTok';
    return pluginId ? pluginId.replace(/^com\.git-agni\./, '') : 'Task';
}
function taskTitle(taskType, payload, pluginId) {
    const app = pluginLabel(pluginId);
    if (taskType === 'doomscroll' || taskType === 'doomscroll-following') {
        const isInstagram = pluginId === 'com.git-agni.instagram';
        const label = taskType === 'doomscroll-following'
            ? (isInstagram ? 'engage following' : 'engagement')
            : (isInstagram ? 'warmup' : 'warmup');
        const details = payload?.durationMinutes ? ` · ${payload.durationMinutes} min` : '';
        return `${app} ${label}${details}`;
    }
    return payload?.account ? `${app} · publish · ${payload.account}` : `${app} · publish`;
}
function timingDescription(timing) {
    if (timing.kind === 'once')
        return `Once · ${formatDate(timing.runAt ?? null)}`;
    if (timing.kind === 'daily')
        return `Daily · ${timing.localTime ?? '—'} · ${timing.timezone ?? 'local time'}`;
    if (timing.kind === 'weekly') {
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = timing.weekdays?.map((day) => names[day] ?? String(day)).join(', ') || 'no days';
        return `Weekly ${days} · ${timing.localTime ?? '—'} · ${timing.timezone ?? 'local time'}`;
    }
    return 'Run immediately';
}
function renderDeviceSchedules(schedules) {
    if (!schedules.length) {
        elements.deviceSchedules.className = 'task-list empty-state';
        elements.deviceSchedules.textContent = 'No schedules for this device.';
        return;
    }
    elements.deviceSchedules.className = 'task-list';
    elements.deviceSchedules.replaceChildren(...schedules.map((schedule) => {
        const row = document.createElement('article');
        row.className = 'task-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = taskTitle(schedule.taskType, schedule.payload, schedule.pluginId);
        const meta = document.createElement('p');
        meta.textContent = `${timingDescription(schedule.timing)} · next ${formatDate(schedule.nextRunAt)}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${schedule.status}`;
        state.textContent = schedule.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (schedule.status === 'active')
            actions.append(taskActionButton('Pause', async () => {
                await jsonRequest(`/api/schedules/${schedule.id}/pause`, { method: 'POST' });
            }));
        if (schedule.status === 'paused')
            actions.append(taskActionButton('Resume', async () => {
                await jsonRequest(`/api/schedules/${schedule.id}/resume`, { method: 'POST' });
            }));
        if (schedule.status !== 'cancelled' && schedule.status !== 'completed') {
            actions.append(taskActionButton('Cancel', async () => {
                await jsonRequest(`/api/schedules/${schedule.id}/cancel`, { method: 'POST' });
            }));
        }
        row.append(copy, state, actions);
        return row;
    }));
}
function renderDeviceExecutions(executions) {
    const running = executions.filter((execution) => execution.status === 'running').length;
    const queued = executions.filter((execution) => execution.status === 'queued').length;
    // Warmup/doomscroll is light enough to keep Live Control; post/upload is not.
    if (executions.some((execution) => execution.status === 'running' && execution.taskType === 'post')) {
        pauseStreamForAutomation();
    }
    if (running || queued) {
        elements.deviceQueueStatus.textContent = `Queue: ${running} running · ${queued} waiting`;
        elements.clearDeviceQueue.disabled = false;
    }
    else {
        elements.deviceQueueStatus.textContent = 'Queue: empty — nothing running or waiting';
        elements.clearDeviceQueue.disabled = true;
    }
    if (!executions.length) {
        elements.deviceExecutions.className = 'task-list empty-state';
        elements.deviceExecutions.textContent = 'No task runs for this device yet.';
        return;
    }
    elements.deviceExecutions.className = 'task-list';
    elements.deviceExecutions.replaceChildren(...executions.map((execution) => {
        const row = document.createElement('article');
        row.className = 'task-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = taskTitle(execution.taskType, undefined, execution.pluginId);
        const meta = document.createElement('p');
        meta.textContent = `${formatDate(execution.scheduledFor)}${execution.error ? ` · ${execution.error}` : ''}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${execution.status}`;
        state.textContent = execution.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (execution.status === 'queued' || (execution.status === 'running' && (execution.taskType === 'doomscroll' || execution.taskType === 'doomscroll-following'))) {
            actions.append(taskActionButton(execution.status === 'queued' ? 'Cancel' : 'Stop', async () => {
                await jsonRequest(`/api/executions/${execution.id}/stop`, { method: 'POST' });
            }));
        }
        if (execution.status === 'failed' || execution.status === 'stopped') {
            actions.append(taskActionButton('Retry', async () => {
                if (execution.taskType === 'post') {
                    const app = pluginLabel(execution.pluginId);
                    if (!window.confirm(`The post may already have reached ${app}. Retry only after checking the device.`))
                        return;
                }
                await jsonRequest(`/api/executions/${execution.id}/retry`, { method: 'POST' });
            }));
        }
        row.append(copy, state, actions);
        return row;
    }));
}
async function loadDeviceTasks() {
    try {
        const query = `deviceUdid=${encodeURIComponent(udid)}`;
        const [scheduleData, executionData] = await Promise.all([
            jsonRequest(`/api/schedules?${query}`),
            jsonRequest(`/api/executions?${query}`),
        ]);
        renderDeviceSchedules(scheduleData.schedules);
        renderDeviceExecutions(executionData.executions);
    }
    catch (error) {
        const message = errorMessage(error);
        elements.deviceSchedules.className = 'task-list empty-state';
        elements.deviceSchedules.textContent = message;
        elements.deviceExecutions.className = 'task-list empty-state';
        elements.deviceExecutions.textContent = message;
    }
}
function syncTikTokAccountSelects(accounts) {
    const previousDoomscroll = document.querySelector('#doomscroll-account')?.value ?? '';
    const previousFollowing = document.querySelector('#following-doomscroll-account')?.value ?? '';
    const previousPost = elements.postAccount.value;
    elements.postAccount.replaceChildren(new Option("Don't switch (already signed in)", '', true, true));
    const doomscrollAccount = element('#doomscroll-account');
    const followingAccount = element('#following-doomscroll-account');
    doomscrollAccount.replaceChildren(new Option("Don't switch", ''));
    followingAccount.replaceChildren(new Option("Don't switch", ''));
    for (const account of accounts) {
        elements.postAccount.add(new Option(account, account));
        doomscrollAccount.add(new Option(account, account));
        followingAccount.add(new Option(account, account));
    }
    if (accounts.includes(previousPost))
        elements.postAccount.value = previousPost;
    if (accounts.includes(previousDoomscroll))
        doomscrollAccount.value = previousDoomscroll;
    if (accounts.includes(previousFollowing))
        followingAccount.value = previousFollowing;
}
function preferSolePostAccount() {
    // Keep "Don't switch" as the default — forced switches need calibrated Profile/switcher taps.
}
elements.openPost.addEventListener('click', () => {
    const listed = [...elements.postAccount.options].filter((option) => option.value).map((option) => option.value);
    if (listed.length === 0) {
        const fromField = elements.deviceAccounts.value.split(',').map((value) => value.trim()).filter(Boolean)
            .map((value) => value.startsWith('@') ? value : `@${value}`);
        if (fromField.length > 0)
            syncTikTokAccountSelects(fromField);
    }
    preferSolePostAccount();
    elements.postDialog.showModal();
});
elements.closePost.addEventListener('click', () => elements.postDialog.close());
elements.cancelPost.addEventListener('click', () => elements.postDialog.close());
elements.media.addEventListener('change', () => {
    orderedMedia = Array.from(elements.media.files ?? []);
    renderMedia();
});
elements.postForm.addEventListener('change', (event) => {
    if (event.target.name === 'destination')
        updateDestination();
});
elements.postForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const destination = selectedDestination();
    if (orderedMedia.length === 0) {
        elements.postResult.textContent = 'Choose media first.';
        return;
    }
    if (orderedMedia.length > 3) {
        elements.postResult.textContent = 'Choose no more than three slideshow images.';
        return;
    }
    const videos = orderedMedia.filter(({ type }) => type.startsWith('video/'));
    const images = orderedMedia.filter(({ type }) => type.startsWith('image/'));
    if (!((videos.length === 1 && orderedMedia.length === 1) || images.length === orderedMedia.length)) {
        elements.postResult.textContent = 'Choose exactly one video, or only slideshow images.';
        return;
    }
    if (destination === 'publish' && !elements.confirmPublish.checked) {
        elements.postResult.textContent = 'Confirm public publishing before continuing.';
        return;
    }
    const form = new FormData();
    for (const file of orderedMedia)
        form.append('media', file, file.name);
    form.append('destination', destination);
    form.append('musicUrl', elements.musicUrl.value);
    form.append('caption', elements.caption.value);
    form.append('account', elements.postAccount.value);
    try {
        form.append('timing', JSON.stringify(postTiming()));
    }
    catch (error) {
        elements.postResult.textContent = errorMessage(error);
        return;
    }
    form.append('runWindowMinutes', elements.postRunWindow.value);
    form.append('recurringPublishConfirmed', String(destination !== 'publish' || elements.confirmPublish.checked));
    elements.submitPost.disabled = true;
    // Drop MJPEG before media upload / Appium starts — waiting for "running"
    // still leaves the stream on during the heaviest Photos + FYP window.
    pauseStreamForAutomation();
    elements.postResult.textContent = 'Uploading media to the automation server…';
    try {
        const result = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/posts`, { method: 'POST', body: form });
        window.clearTimeout(postPoll);
        elements.submitPost.disabled = false;
        elements.postResult.textContent = '';
        elements.postDialog.close();
        if (result.status === 'running') {
            void pollPost();
        }
        void loadDeviceTasks();
    }
    catch (error) {
        elements.postResult.textContent = errorMessage(error);
        elements.submitPost.disabled = false;
    }
});
elements.accountsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.accountsResult.textContent = 'Saving…';
    try {
        const result = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/accounts`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accounts: elements.deviceAccounts.value.split(',') }),
        });
        syncTikTokAccountSelects(result.accounts);
        elements.deviceAccounts.value = result.accounts.join(', ');
        elements.accountsResult.textContent = result.accounts.length ? 'Accounts saved.' : 'Account switching is optional.';
        elements.accountsDialog.close();
    }
    catch (error) {
        elements.accountsResult.textContent = errorMessage(error);
    }
});
elements.instagramAccountsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.instagramAccountsResult.textContent = 'Saving…';
    try {
        const result = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/instagram/accounts`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accounts: elements.instagramDeviceAccounts.value.split(',') }),
        });
        const previousDoomscroll = (document.querySelector('#instagram-doomscroll-account'))?.value ?? '';
        const previousFriends = (document.querySelector('#instagram-following-doomscroll-account'))?.value ?? '';
        const previousColdDms = elements.instagramColdDmsAccount.value;
        const doomscrollAccount = element('#instagram-doomscroll-account');
        const friendsAccount = element('#instagram-following-doomscroll-account');
        doomscrollAccount.replaceChildren(new Option("Don't switch", ''));
        friendsAccount.replaceChildren(new Option("Don't switch", ''));
        elements.instagramColdDmsAccount.replaceChildren(new Option("Don't switch", ''));
        for (const account of result.accounts) {
            doomscrollAccount.add(new Option(account, account));
            friendsAccount.add(new Option(account, account));
            elements.instagramColdDmsAccount.add(new Option(account, account));
        }
        if (result.accounts.includes(previousDoomscroll))
            doomscrollAccount.value = previousDoomscroll;
        if (result.accounts.includes(previousFriends))
            friendsAccount.value = previousFriends;
        if (result.accounts.includes(previousColdDms))
            elements.instagramColdDmsAccount.value = previousColdDms;
        elements.instagramDeviceAccounts.value = result.accounts.join(', ');
        elements.instagramAccountsResult.textContent = result.accounts.length ? 'Accounts saved.' : 'Account switching is optional.';
    }
    catch (error) {
        elements.instagramAccountsResult.textContent = errorMessage(error);
    }
});
function calAppLabel(app) {
    if (app === 'instagram')
        return 'Instagram';
    if (app === 'linkedin')
        return 'LinkedIn';
    return 'TikTok';
}
function calSaveBody(app, overrides) {
    if (app === 'instagram')
        return { instagramCoordinates: overrides };
    if (app === 'linkedin')
        return { linkedinCoordinates: overrides };
    return { coordinates: overrides };
}
const cal = {
    app: 'tiktok',
    screen: undefined,
    points: [],
    overrides: {},
    /** Keep unsaved per-app edits when switching TikTok ↔ Instagram ↔ LinkedIn. */
    overridesByApp: {
        tiktok: {},
        instagram: {},
        linkedin: {},
    },
    armed: undefined,
    dirty: false,
};
function calValue(name) {
    const point = cal.points.find((entry) => entry.name === name);
    return cal.overrides[name] ?? point.current ?? point.default;
}
function renderCalPoints() {
    elements.calPoints.replaceChildren(...cal.points.map((point) => {
        const value = calValue(point.name);
        const overridden = point.name in cal.overrides;
        const li = document.createElement('li');
        li.className = `cal-point${overridden ? ' overridden' : ''}${cal.armed === point.name ? ' armed' : ''}`;
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'cal-pick';
        pick.textContent = cal.armed === point.name ? `${point.label} — click the screen` : point.label;
        pick.addEventListener('click', () => { cal.armed = cal.armed === point.name ? undefined : point.name; renderCal(); });
        const xy = document.createElement('span');
        xy.className = 'cal-xy';
        xy.textContent = `${value.x}, ${value.y}`;
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'cal-reset';
        reset.title = 'Reset to profile';
        reset.textContent = '↺';
        reset.addEventListener('click', () => {
            delete cal.overrides[point.name];
            cal.dirty = true;
            renderCal();
        });
        li.append(pick, xy, reset);
        return li;
    }));
}
function renderCalMarkers() {
    if (!cal.screen)
        return;
    const mediaW = elements.calScreen.naturalWidth || cal.screen.width;
    const mediaH = elements.calScreen.naturalHeight || cal.screen.height;
    const box = containContentBox(elements.calScreen, mediaW, mediaH);
    elements.calMarkers.replaceChildren(...cal.points.map((point) => {
        const value = calValue(point.name);
        const marker = document.createElement('span');
        marker.className = `m${point.name in cal.overrides ? ' overridden' : ''}${cal.armed === point.name ? ' armed' : ''}`;
        const left = box.elementWidth <= 0 ? 0
            : ((box.left - elements.calScreen.getBoundingClientRect().left)
                + (value.x / cal.screen.width) * box.width) / box.elementWidth * 100;
        const top = box.elementHeight <= 0 ? 0
            : ((box.top - elements.calScreen.getBoundingClientRect().top)
                + (value.y / cal.screen.height) * box.height) / box.elementHeight * 100;
        marker.style.left = `${left}%`;
        marker.style.top = `${top}%`;
        marker.title = point.label;
        return marker;
    }));
}
function renderCal() {
    renderCalPoints();
    renderCalMarkers();
}
async function loadCalibratePoints(app, workflow) {
    // Stash in-progress edits for the app we're leaving so switching
    // TikTok ↔ Instagram ↔ LinkedIn does not throw away unsaved points.
    if (cal.points.length > 0) {
        cal.overridesByApp[cal.app] = { ...cal.overrides };
    }
    const query = new URLSearchParams({ app });
    if (app === 'linkedin') {
        const selected = workflow ?? elements.calWorkflow.value ?? 'cold-connect';
        elements.calWorkflow.value = selected;
        query.set('workflow', selected);
        elements.calWorkflowWrap.hidden = false;
    }
    else {
        elements.calWorkflowWrap.hidden = true;
    }
    const data = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/coordinates?${query.toString()}`);
    cal.app = data.app;
    cal.screen = data.screenSize;
    cal.points = data.points;
    const fromServer = {};
    for (const point of data.points)
        if (point.overridden)
            fromServer[point.name] = point.current;
    const local = cal.overridesByApp[app] ?? {};
    // Prefer local unsaved edits over the server snapshot for this app.
    cal.overrides = { ...fromServer, ...local };
    cal.overridesByApp[app] = { ...cal.overrides };
    cal.armed = undefined;
    elements.calApp.value = data.app;
    const workflowLabel = data.workflow && data.workflow !== 'all' ? ` · ${data.workflow}` : '';
    elements.calProfile.textContent = `${data.profile} · ${calAppLabel(data.app)}${workflowLabel}`;
    elements.calSave.textContent = `Save ${calAppLabel(data.app)}`;
    renderCal();
}
async function openCalibrate(opts) {
    elements.calStatus.textContent = 'Loading…';
    elements.calibrateDialog.showModal();
    try {
        elements.calControl.checked = false;
        elements.calScreen.parentElement?.classList.remove('controlling');
        if (opts?.app)
            elements.calApp.value = opts.app;
        if (opts?.workflow)
            elements.calWorkflow.value = opts.workflow;
        else if (elements.calApp.value === 'linkedin' && !elements.calWorkflow.value) {
            elements.calWorkflow.value = 'cold-connect';
        }
        await loadCalibratePoints(elements.calApp.value, elements.calApp.value === 'linkedin' ? elements.calWorkflow.value : undefined);
        elements.calScreen.src = `/api/devices/${encodeURIComponent(udid)}/remote/stream?t=${Date.now()}`;
        elements.calStatus.textContent = '';
    }
    catch (error) {
        elements.calStatus.textContent = errorMessage(error);
    }
}
function closeCalibrate() {
    elements.calScreen.src = '';
    elements.calibrateDialog.close();
}
elements.openCalibrate.addEventListener('click', () => void openCalibrate());
elements.closeCalibrate.addEventListener('click', closeCalibrate);
elements.calCancel.addEventListener('click', closeCalibrate);
elements.calApp.addEventListener('change', () => {
    if (!elements.calibrateDialog.open)
        return;
    if (elements.calApp.value === 'linkedin')
        elements.calWorkflow.value = 'cold-connect';
    elements.calStatus.textContent = 'Loading…';
    void loadCalibratePoints(elements.calApp.value)
        .then(() => { elements.calStatus.textContent = ''; })
        .catch((error) => { elements.calStatus.textContent = errorMessage(error); });
});
elements.calWorkflow.addEventListener('change', () => {
    if (!elements.calibrateDialog.open)
        return;
    elements.calStatus.textContent = 'Loading…';
    void loadCalibratePoints('linkedin', elements.calWorkflow.value)
        .then(() => { elements.calStatus.textContent = ''; })
        .catch((error) => { elements.calStatus.textContent = errorMessage(error); });
});
elements.openTasks.addEventListener('click', () => {
    void loadDeviceTasks();
    elements.tasksDialog.showModal();
});
elements.closeTasks.addEventListener('click', () => elements.tasksDialog.close());
elements.clearDeviceQueue.addEventListener('click', async () => {
    if (!window.confirm('Cancel every queued job and stop every running automation on this device?'))
        return;
    elements.clearDeviceQueue.disabled = true;
    elements.deviceQueueStatus.textContent = 'Clearing queue…';
    try {
        const result = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/queue/clear`, { method: 'POST' });
        elements.deviceQueueStatus.textContent =
            `Cleared ${result.cancelled} queued · stopping ${result.stopping} running`;
        await loadDeviceTasks();
        const activityResponse = await fetch(`/api/devices/${encodeURIComponent(udid)}/fragments/activity`);
        if (activityResponse.ok) {
            const html = await activityResponse.text();
            const current = document.querySelector('#device-activity');
            if (current)
                current.outerHTML = html;
        }
    }
    catch (error) {
        elements.deviceQueueStatus.textContent = errorMessage(error);
        elements.clearDeviceQueue.disabled = false;
    }
});
elements.openAccounts.addEventListener('click', () => elements.accountsDialog.showModal());
elements.closeAccounts.addEventListener('click', () => elements.accountsDialog.close());
elements.openInstagramAccounts.addEventListener('click', () => elements.instagramAccountsDialog.showModal());
elements.closeInstagramAccounts.addEventListener('click', () => elements.instagramAccountsDialog.close());
elements.openPasscode.addEventListener('click', () => {
    elements.passcodeResult.textContent = '';
    elements.passcodeDialog.showModal();
});
elements.closePasscode.addEventListener('click', () => elements.passcodeDialog.close());
elements.openRemove.addEventListener('click', () => {
    elements.removeResult.textContent = '';
    elements.removeDialog.showModal();
});
elements.closeRemove.addEventListener('click', () => elements.removeDialog.close());
elements.calResetAll.addEventListener('click', () => {
    if (!confirm(`Reset all ${calAppLabel(cal.app)} touch points to the profile defaults?`))
        return;
    cal.overrides = {};
    cal.overridesByApp[cal.app] = {};
    cal.armed = undefined;
    cal.dirty = true;
    renderCal();
});
function calPointFromEvent(event) {
    if (!cal.screen)
        throw new Error('Calibration screen size is unavailable');
    return pointFromContainedMedia(event, elements.calScreen, cal.screen);
}
async function calSendAction(action) {
    elements.calStatus.textContent = 'Sending input…';
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/remote/action`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(action),
        });
        elements.calStatus.textContent = action.type === 'tap' ? `Tapped (${action.x}, ${action.y})` : 'Sent.';
    }
    catch (error) {
        elements.calStatus.textContent = errorMessage(error);
    }
}
let calPointerStart;
elements.calControl.addEventListener('change', () => {
    elements.calScreen.parentElement?.classList.toggle('controlling', elements.calControl.checked);
    if (elements.calControl.checked) {
        cal.armed = undefined;
        renderCal();
    }
});
elements.calUnlock.addEventListener('click', () => void calSendAction({ type: 'unlock' }));
elements.calScreen.addEventListener('click', (event) => {
    if (elements.calControl.checked || !cal.armed || !cal.screen)
        return;
    cal.overrides[cal.armed] = calPointFromEvent(event);
    cal.overridesByApp[cal.app] = { ...cal.overrides };
    cal.dirty = true;
    cal.armed = undefined;
    renderCal();
});
elements.calScreen.addEventListener('pointerdown', (event) => {
    if (!elements.calControl.checked || !cal.screen)
        return;
    elements.calScreen.setPointerCapture(event.pointerId);
    calPointerStart = { ...calPointFromEvent(event), time: performance.now() };
});
elements.calScreen.addEventListener('pointerup', (event) => {
    if (!calPointerStart || !cal.screen)
        return;
    const start = calPointerStart;
    const end = calPointFromEvent(event);
    calPointerStart = undefined;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 12) {
        void calSendAction({ type: 'tap', x: end.x, y: end.y });
    }
    else {
        const durationMs = Math.max(150, Math.min(1200, Math.round(performance.now() - start.time)));
        void calSendAction({ type: 'swipe', startX: start.x, startY: start.y, endX: end.x, endY: end.y, durationMs });
    }
});
elements.calScreen.addEventListener('pointercancel', () => { calPointerStart = undefined; });
elements.calSave.addEventListener('click', async () => {
    elements.calSave.disabled = true;
    const appLabel = calAppLabel(cal.app);
    elements.calStatus.textContent = `Saving ${appLabel}…`;
    try {
        // Snapshot current edits into the per-app bag before PATCH.
        cal.overridesByApp[cal.app] = { ...cal.overrides };
        const body = calSaveBody(cal.app, cal.overrides);
        // Empty object clears this app's overrides (Reset all → Save).
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        // Re-load from server so the UI matches what was actually persisted.
        cal.overridesByApp[cal.app] = {};
        cal.dirty = false;
        await loadCalibratePoints(cal.app);
        const count = Object.keys(cal.overrides).length;
        elements.calStatus.textContent = count
            ? `Saved ${count} ${appLabel} override${count === 1 ? '' : 's'}.`
            : `Cleared all ${appLabel} overrides.`;
    }
    catch (error) {
        elements.calStatus.textContent = errorMessage(error);
    }
    finally {
        elements.calSave.disabled = false;
    }
});
async function patchPasscode(passcode, pending, done) {
    elements.passcodeResult.textContent = pending;
    try {
        const response = await fetch(`/api/devices/${encodeURIComponent(udid)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ passcode }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error ?? `Request failed (${response.status})`);
        }
        const data = await response.json();
        elements.passcodeState.textContent = data.hasPasscode ? '· set' : '· not set';
        elements.devicePasscode.value = '';
        elements.passcodeResult.textContent = done;
    }
    catch (error) {
        elements.passcodeResult.textContent = errorMessage(error);
    }
}
elements.passcodeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = elements.devicePasscode.value.trim();
    if (!/^\d{4,}$/.test(value)) {
        elements.passcodeResult.textContent = 'Enter at least four digits.';
        return;
    }
    void patchPasscode(value, 'Saving…', 'Passcode saved.');
});
elements.passcodeClear.addEventListener('click', () => {
    if (!confirm('Clear this device’s passcode? Automation will not be able to unlock a locked phone.'))
        return;
    void patchPasscode('', 'Clearing…', 'Passcode cleared.');
});
document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-rename-device]');
    if (!button)
        return;
    event.preventDefault();
    const title = document.querySelector('.device-name')?.textContent ?? '';
    const current = title.replace(/\s+/g, ' ').trim();
    const next = window.prompt('Rename this phone for the farm grid', current);
    if (next === null)
        return;
    const name = next.replace(/\s+/g, ' ').trim();
    if (!name) {
        window.alert('Name cannot be empty');
        return;
    }
    button.disabled = true;
    void (async () => {
        try {
            await jsonRequest(`/api/devices/${encodeURIComponent(udid)}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            document.title = `${name} · IOS AGENTS`;
            const response = await fetch(`/api/devices/${encodeURIComponent(udid)}/fragments/summary`);
            if (!response.ok)
                throw new Error(`Could not refresh device header (${response.status})`);
            const html = await response.text();
            const summary = document.querySelector('#device-summary');
            if (summary)
                summary.outerHTML = html;
            const refreshed = document.querySelector('#device-summary[data-screen-width]');
            if (refreshed)
                useDeviceSummary(refreshed);
        }
        catch (error) {
            button.disabled = false;
            window.alert(errorMessage(error));
        }
    })();
});
elements.removeDevice.addEventListener('click', async () => {
    elements.removeDevice.disabled = true;
    elements.removeResult.textContent = 'Removing…';
    try {
        const response = await fetch(`/api/devices/${encodeURIComponent(udid)}`, { method: 'DELETE' });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error ?? `Request failed (${response.status})`);
        }
        location.href = '/';
    }
    catch (error) {
        elements.removeDevice.disabled = false;
        elements.removeResult.textContent = errorMessage(error);
    }
});
updateDestination();
updateDoomscrollSchedule();
updateInstagramDoomscrollSchedule();
updatePostSchedule();
setInterval(() => { if (elements.tasksDialog.open)
    void loadDeviceTasks(); }, 5_000);
const loadedSummary = document.querySelector('#device-summary[data-screen-width]');
if (loadedSummary)
    useDeviceSummary(loadedSummary);
// --- Workflow train / following doomscroll ---------------------------------
elements.trainToggle.addEventListener('click', () => {
    setTrainRecording(!trainRecording);
});
elements.trainClear.addEventListener('click', () => {
    trainEvents = [];
    setTrainRecording(false);
});
elements.trainSave.addEventListener('click', () => {
    if (trainEvents.length === 0)
        return;
    elements.trainSaveResult.textContent = '';
    elements.trainWorkflowName.value = elements.trainWorkflowName.value || 'following-engage';
    elements.trainSaveDialog.showModal();
});
elements.closeTrainSave.addEventListener('click', () => elements.trainSaveDialog.close());
elements.cancelTrainSave.addEventListener('click', () => elements.trainSaveDialog.close());
elements.trainSaveForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    elements.trainSaveResult.textContent = 'Saving…';
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/workflows`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: elements.trainWorkflowName.value.trim(),
                events: trainEvents,
                meta: { feed: elements.trainWorkflowFeed.value, source: 'recording' },
            }),
        });
        elements.trainSaveResult.textContent = 'Saved.';
        trainEvents = [];
        setTrainRecording(false);
        elements.trainSaveDialog.close();
        await loadWorkflows();
    }
    catch (error) {
        elements.trainSaveResult.textContent = errorMessage(error);
    }
});
async function swapDeviceActivity(response) {
    if (!response.ok)
        throw new Error(`Request failed (${response.status})`);
    const html = await response.text();
    const activity = document.querySelector('#device-activity');
    if (activity)
        activity.outerHTML = html;
}
function appendBuiltinWorkflowRow(options) {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.innerHTML = `<div><strong>${options.title}</strong><div class="run-meta">${options.meta}</div></div>`;
    const actions = document.createElement('div');
    actions.className = 'inline-actions';
    const configure = document.createElement('button');
    configure.type = 'button';
    configure.className = 'button secondary';
    configure.textContent = 'Configure';
    configure.addEventListener('click', () => options.onConfigure());
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'button secondary';
    run.textContent = 'Run 5m';
    run.addEventListener('click', async () => {
        run.disabled = true;
        try {
            await options.onRun5m();
        }
        catch (error) {
            setStatus(errorMessage(error), 'error');
        }
        finally {
            run.disabled = false;
        }
    });
    actions.append(configure, run);
    row.append(actions);
    elements.workflowList.append(row);
}
async function loadWorkflows() {
    elements.workflowList.classList.add('loading-card');
    elements.workflowList.innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading workflows…';
    try {
        const data = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/workflows`);
        const workflows = data.workflows ?? [];
        elements.workflowList.classList.remove('loading-card');
        elements.workflowList.innerHTML = '';
        appendBuiltinWorkflowRow({
            title: 'Instagram · Engage following',
            meta: 'Built-in · Reels → Friends · like/comment',
            onConfigure: () => elements.instagramFollowingDoomscrollDialog.showModal(),
            onRun5m: async () => {
                const form = new FormData();
                form.set('durationMinutes', '5');
                form.set('personality', 'dialed');
                form.set('likeEnabled', 'on');
                form.set('commentEnabled', 'on');
                form.set('commentText', '🔥');
                form.set('scheduleKind', 'now');
                form.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
                const response = await fetch(`/api/devices/${encodeURIComponent(udid)}/instagram/fragments/following-scroll-run`, { method: 'POST', body: form });
                await swapDeviceActivity(response);
            },
        });
        appendBuiltinWorkflowRow({
            title: 'TikTok · Engagement',
            meta: 'Built-in · Following feed · like/comment/save',
            onConfigure: () => elements.followingDoomscrollDialog.showModal(),
            onRun5m: async () => {
                const form = new FormData();
                form.set('durationMinutes', '5');
                form.set('personality', 'dialed');
                form.set('likeEnabled', 'on');
                form.set('commentEnabled', 'on');
                form.set('saveEnabled', 'on');
                form.set('commentText', '🔥');
                form.set('scheduleKind', 'now');
                form.set('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
                const response = await fetch(`/api/devices/${encodeURIComponent(udid)}/fragments/following-scroll-run`, { method: 'POST', body: form });
                await swapDeviceActivity(response);
            },
        });
        if (workflows.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'No trained gesture workflows yet. Use Train workflow on the live screen.';
            elements.workflowList.append(empty);
            return;
        }
        for (const workflow of workflows) {
            const row = document.createElement('div');
            row.className = 'task-row';
            row.innerHTML = `<div><strong>${workflow.name}</strong><div class="run-meta">${workflow.steps.length} steps · ${new Date(workflow.createdAt).toLocaleString()}</div></div>`;
            const actions = document.createElement('div');
            actions.className = 'inline-actions';
            const replay = document.createElement('button');
            replay.type = 'button';
            replay.className = 'button secondary';
            replay.textContent = 'Replay 5m';
            replay.addEventListener('click', async () => {
                replay.disabled = true;
                try {
                    const form = new FormData();
                    form.set('workflowId', workflow.id);
                    form.set('durationMinutes', '5');
                    const response = await fetch(`/api/devices/${encodeURIComponent(udid)}/fragments/workflow-replay-run`, {
                        method: 'POST',
                        body: form,
                    });
                    await swapDeviceActivity(response);
                }
                catch (error) {
                    setStatus(errorMessage(error), 'error');
                }
                finally {
                    replay.disabled = false;
                }
            });
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'button secondary';
            remove.textContent = 'Delete';
            remove.addEventListener('click', async () => {
                if (!confirm(`Delete workflow “${workflow.name}”?`))
                    return;
                await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/workflows/${encodeURIComponent(workflow.id)}`, {
                    method: 'DELETE',
                });
                await loadWorkflows();
            });
            actions.append(replay, remove);
            row.append(actions);
            elements.workflowList.append(row);
        }
    }
    catch (error) {
        elements.workflowList.classList.remove('loading-card');
        elements.workflowList.textContent = errorMessage(error);
    }
}
elements.refreshWorkflows.addEventListener('click', () => { void loadWorkflows(); });
void loadWorkflows();
elements.openFollowingDoomscroll.addEventListener('click', () => elements.followingDoomscrollDialog.showModal());
elements.closeFollowingDoomscroll.addEventListener('click', () => elements.followingDoomscrollDialog.close());
elements.cancelFollowingDoomscroll.addEventListener('click', () => elements.followingDoomscrollDialog.close());
elements.followingDoomscrollDurationButtons.forEach((button) => {
    button.addEventListener('click', () => {
        elements.followingDoomscrollDuration.value = button.dataset.followingDoomscrollDuration ?? '5';
    });
});
elements.followingCommentEnabled.addEventListener('change', () => {
    elements.followingCommentText.disabled = !elements.followingCommentEnabled.checked;
    if (elements.followingCommentEnabled.checked && !elements.followingCommentText.value.trim()) {
        elements.followingCommentText.value = '🔥';
    }
});
elements.instagramCommentEnabled.addEventListener('change', () => {
    elements.instagramCommentText.disabled = !elements.instagramCommentEnabled.checked;
    if (elements.instagramCommentEnabled.checked && !elements.instagramCommentText.value.trim()) {
        elements.instagramCommentText.value = '🔥';
    }
});
elements.instagramFollowingCommentEnabled.addEventListener('change', () => {
    elements.instagramFollowingCommentText.disabled = !elements.instagramFollowingCommentEnabled.checked;
    if (elements.instagramFollowingCommentEnabled.checked && !elements.instagramFollowingCommentText.value.trim()) {
        elements.instagramFollowingCommentText.value = '🔥';
    }
});
elements.openInstagramFollowingDoomscroll.addEventListener('click', () => elements.instagramFollowingDoomscrollDialog.showModal());
elements.closeInstagramFollowingDoomscroll.addEventListener('click', () => elements.instagramFollowingDoomscrollDialog.close());
elements.cancelInstagramFollowingDoomscroll.addEventListener('click', () => elements.instagramFollowingDoomscrollDialog.close());
elements.instagramFollowingDoomscrollDurationButtons.forEach((button) => {
    button.addEventListener('click', () => {
        elements.instagramFollowingDoomscrollDuration.value = button.dataset.instagramFollowingDoomscrollDuration ?? '5';
    });
});
elements.instagramFollowingDoomscrollForm.addEventListener('htmx:afterRequest', ((event) => {
    const detail = event.detail;
    if (detail.successful) {
        elements.instagramFollowingDoomscrollResult.textContent = 'Started.';
        elements.instagramFollowingDoomscrollDialog.close();
    }
    else {
        elements.instagramFollowingDoomscrollResult.textContent = detail.xhr?.responseText
            ? 'Could not start — check Activity.'
            : 'Request failed.';
    }
}));
function syncColdDmsLeadMode() {
    const usingList = elements.instagramColdDmsLeadList.value !== '';
    elements.instagramColdDmsLeadFields.hidden = !usingList;
    elements.instagramColdDmsHandles.disabled = usingList;
    elements.instagramColdDmsHandles.required = !usingList;
}
async function loadColdDmsLeadLists() {
    const previous = elements.instagramColdDmsLeadList.value;
    try {
        const response = await fetch('/api/instagram/leads');
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        elements.instagramColdDmsLeadList.replaceChildren(new Option('Paste handles instead', ''));
        for (const list of result.lists) {
            const label = `${list.name} · ${list.remainingPublic} public left of ${list.total}`;
            elements.instagramColdDmsLeadList.add(new Option(label, list.name));
        }
        if (result.lists.some((list) => list.name === previous))
            elements.instagramColdDmsLeadList.value = previous;
        else if (!previous && result.lists.length > 0)
            elements.instagramColdDmsLeadList.value = result.lists[0].name;
    }
    catch {
        // Leave whatever options are there; pasted handles still work.
    }
    syncColdDmsLeadMode();
}
elements.instagramColdDmsLeadList.addEventListener('change', syncColdDmsLeadMode);
elements.openInstagramColdDms.addEventListener('click', () => {
    elements.instagramColdDmsResult.textContent = '';
    void loadColdDmsLeadLists();
    elements.instagramColdDmsDialog.showModal();
});
elements.closeInstagramColdDms.addEventListener('click', () => elements.instagramColdDmsDialog.close());
elements.cancelInstagramColdDms.addEventListener('click', () => elements.instagramColdDmsDialog.close());
elements.instagramColdDmsForm.addEventListener('htmx:afterRequest', ((event) => {
    const detail = event.detail;
    if (detail.successful) {
        elements.instagramColdDmsResult.textContent = 'Started.';
        elements.instagramColdDmsDialog.close();
        void loadDeviceTasks();
    }
    else {
        elements.instagramColdDmsResult.textContent = detail.xhr?.responseText
            ? 'Could not start — check Activity.'
            : 'Request failed.';
    }
}));
async function loadLinkedInLeadCsvs(select, preferred) {
    const previous = select.value || preferred || '';
    try {
        const response = await fetch('/api/linkedin/leads');
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        select.replaceChildren();
        if (result.lists.length === 0) {
            select.add(new Option('No lead lists found', ''));
            select.required = true;
            return;
        }
        for (const list of result.lists) {
            select.add(new Option(`${list.name}.csv · ${list.remaining} left of ${list.total}`, list.name));
        }
        if (result.lists.some((list) => list.name === previous))
            select.value = previous;
        else if (preferred && result.lists.some((list) => list.name === preferred))
            select.value = preferred;
    }
    catch {
        if (select.options.length === 0)
            select.add(new Option('Could not load lead lists', ''));
    }
}
elements.openLinkedInConnect.addEventListener('click', () => {
    elements.linkedinConnectResult.textContent = '';
    void loadLinkedInLeadCsvs(elements.linkedinConnectLeadCsv, 'hormozi');
    elements.linkedinConnectDialog.showModal();
});
elements.closeLinkedInConnect.addEventListener('click', () => elements.linkedinConnectDialog.close());
elements.cancelLinkedInConnect.addEventListener('click', () => elements.linkedinConnectDialog.close());
elements.linkedinConnectCalibrate.addEventListener('click', () => {
    elements.linkedinConnectDialog.close();
    void openCalibrate({ app: 'linkedin', workflow: 'connect' });
});
elements.linkedinConnectForm.addEventListener('htmx:afterRequest', ((event) => {
    const detail = event.detail;
    if (detail.successful) {
        elements.linkedinConnectResult.textContent = 'Started.';
        elements.linkedinConnectDialog.close();
        void loadDeviceTasks();
    }
    else {
        elements.linkedinConnectResult.textContent = detail.xhr?.responseText
            ? 'Could not start — check Activity.'
            : 'Request failed.';
    }
}));
elements.openLinkedInColdConnect.addEventListener('click', () => {
    elements.linkedinColdConnectResult.textContent = '';
    void loadLinkedInLeadCsvs(elements.linkedinColdConnectLeadCsv, 'result');
    elements.linkedinColdConnectDialog.showModal();
});
elements.closeLinkedInColdConnect.addEventListener('click', () => elements.linkedinColdConnectDialog.close());
elements.cancelLinkedInColdConnect.addEventListener('click', () => elements.linkedinColdConnectDialog.close());
elements.linkedinColdConnectCalibrate.addEventListener('click', () => {
    elements.linkedinColdConnectDialog.close();
    void openCalibrate({ app: 'linkedin', workflow: 'cold-connect' });
});
elements.linkedinColdConnectForm.addEventListener('htmx:afterRequest', ((event) => {
    const detail = event.detail;
    if (detail.successful) {
        elements.linkedinColdConnectResult.textContent = 'Started.';
        elements.linkedinColdConnectDialog.close();
        void loadDeviceTasks();
    }
    else {
        elements.linkedinColdConnectResult.textContent = detail.xhr?.responseText
            ? 'Could not start — check Activity.'
            : 'Request failed.';
    }
}));
elements.followingDoomscrollForm.addEventListener('htmx:afterRequest', ((event) => {
    const detail = event.detail;
    if (detail.successful) {
        elements.followingDoomscrollResult.textContent = 'Started.';
        elements.followingDoomscrollDialog.close();
    }
    else {
        elements.followingDoomscrollResult.textContent = detail.xhr?.responseText
            ? 'Could not start — check Activity.'
            : 'Request failed.';
    }
}));
export {};
