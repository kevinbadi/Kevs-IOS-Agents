/**
 * LinkedIn touch map. Canonical seed is Phone Farm #1 (iPhone 13, 390×844 pt,
 * scale 3). Other device profiles scale this seed. Points are screen points.
 *
 * Chrome is a 5-tab bar (Home / My Network / Post / Notifications / Jobs),
 * a shared header (Me avatar, Search, Messaging), Grow/Catch up on My Network,
 * and the connection-request path: search or People You May Know → profile →
 * Connect → optional note → Send.
 */

export interface Point { x: number; y: number }

export interface LinkedInSwipe {
    x: number;
    startY: number;
    endY: number;
    durationMs: number;
}

export interface LinkedInCoordinates {
    screenSize: { width: number; height: number };
    homeTab: Point;
    networkTab: Point;
    postTab: Point;
    notificationsTab: Point;
    jobsTab: Point;
    meAvatar: Point;
    searchField: Point;
    messaging: Point;
    back: Point;
    keyboardDone: Point;
    firstPost: Point;
    like: Point;
    comment: Point;
    repost: Point;
    send: Point;
    postMore: Point;
    searchPeopleFilter: Point;
    searchFirstResult: Point;
    connect: Point;
    follow: Point;
    message: Point;
    profileMore: Point;
    /** ⋯ to the right of Message — hidden-connect overflow. */
    profileMenu: Point;
    profileAbout: Point;
    addANote: Point;
    sendWithoutNote: Point;
    noteComposer: Point;
    sendInvitation: Point;
    dismissNote: Point;
    invitations: Point;
    grow: Point;
    catchUp: Point;
    manageNetwork: Point;
    peopleYouMayKnow: Point;
    firstPymkCard: Point;
    firstPymkConnect: Point;
    composeMessage: Point;
    inboxSearch: Point;
    threadComposer: Point;
    threadSend: Point;
    threadBack: Point;
    firstNotification: Point;
    jobsSearch: Point;
    firstJob: Point;
    postText: Point;
    postPhoto: Point;
    postSubmit: Point;
    postDismiss: Point;
    viewProfile: Point;
    settings: Point;
    swipe: LinkedInSwipe;
}

export const LINKEDIN_BUNDLE_ID = 'com.linkedin.LinkedIn';

/** Single-tap targets the Touch points tab can re-point. Swipe stays profile-level. */
export const LINKEDIN_CALIBRATABLE_POINTS = [
    'homeTab', 'networkTab', 'postTab', 'notificationsTab', 'jobsTab',
    'meAvatar', 'searchField', 'messaging', 'back', 'keyboardDone',
    'firstPost', 'like', 'comment', 'repost', 'send', 'postMore',
    'searchPeopleFilter', 'searchFirstResult',
    'connect', 'follow', 'message', 'profileMore', 'profileMenu', 'profileAbout',
    'addANote', 'sendWithoutNote', 'noteComposer', 'sendInvitation', 'dismissNote',
    'invitations', 'grow', 'catchUp', 'manageNetwork',
    'peopleYouMayKnow', 'firstPymkCard', 'firstPymkConnect',
    'composeMessage', 'inboxSearch', 'threadComposer', 'threadSend', 'threadBack',
    'firstNotification', 'jobsSearch', 'firstJob',
    'postText', 'postPhoto', 'postSubmit', 'postDismiss',
    'viewProfile', 'settings',
] as const;

export type LinkedInCalibratablePoint = typeof LINKEDIN_CALIBRATABLE_POINTS[number];

export const LINKEDIN_POINT_LABELS: Record<LinkedInCalibratablePoint, string> = {
    homeTab: 'LinkedIn · Tab · Home',
    networkTab: 'LinkedIn · Tab · My Network',
    postTab: 'LinkedIn · Tab · Post',
    notificationsTab: 'LinkedIn · Tab · Notifications',
    jobsTab: 'LinkedIn · Tab · Jobs',
    meAvatar: 'LinkedIn · Header · Me',
    searchField: 'LinkedIn · Search bar (top middle)',
    messaging: 'LinkedIn · Header · Messaging',
    back: 'LinkedIn · Back',
    keyboardDone: 'LinkedIn · Keyboard · Done',
    firstPost: 'LinkedIn · Feed · first post',
    like: 'LinkedIn · Feed · Like',
    comment: 'LinkedIn · Feed · Comment',
    repost: 'LinkedIn · Feed · Repost',
    send: 'LinkedIn · Feed · Send',
    postMore: 'LinkedIn · Feed · More',
    searchPeopleFilter: 'LinkedIn · Search · People',
    searchFirstResult: 'LinkedIn · Search · first person',
    connect: 'LinkedIn · Hidden connect · Connect',
    follow: 'LinkedIn · Profile · Follow',
    message: 'LinkedIn · Profile · Message',
    profileMore: 'LinkedIn · Profile · More',
    profileMenu: 'Click profile menu',
    profileAbout: 'LinkedIn · Profile · About',
    addANote: 'LinkedIn · Connect · Add note',
    sendWithoutNote: 'LinkedIn · Connect · Send without note',
    noteComposer: 'LinkedIn · Connect · note field',
    sendInvitation: 'LinkedIn · Connect · Add note to invitation',
    dismissNote: 'LinkedIn · Connect · Cancel',
    invitations: 'LinkedIn · Network · Invitations',
    grow: 'LinkedIn · Network · Grow',
    catchUp: 'LinkedIn · Network · Catch up',
    manageNetwork: 'LinkedIn · Network · Manage',
    peopleYouMayKnow: 'LinkedIn · Network · People you may know',
    firstPymkCard: 'LinkedIn · Network · first suggestion',
    firstPymkConnect: 'LinkedIn · Network · first Connect',
    composeMessage: 'LinkedIn · Inbox · compose',
    inboxSearch: 'LinkedIn · Inbox · search',
    threadComposer: 'LinkedIn · Thread · message field',
    threadSend: 'LinkedIn · Thread · Send',
    threadBack: 'LinkedIn · Thread · Back',
    firstNotification: 'LinkedIn · Notifications · first row',
    jobsSearch: 'LinkedIn · Jobs · search',
    firstJob: 'LinkedIn · Jobs · first card',
    postText: 'LinkedIn · Composer · text',
    postPhoto: 'LinkedIn · Composer · photo',
    postSubmit: 'LinkedIn · Composer · Post',
    postDismiss: 'LinkedIn · Composer · Close',
    viewProfile: 'LinkedIn · Me · View profile',
    settings: 'LinkedIn · Me · Settings',
};

/**
 * Measured against LinkedIn's current iOS chrome on 390×844 (iPhone 13/14 /
 * 13 Pro). Tab bar sits above the home indicator; header sits under the notch.
 * Profile and connect-sheet targets are the connection-request path.
 */
export const LINKEDIN_IPHONE13: LinkedInCoordinates = {
    screenSize: { width: 390, height: 844 },
    homeTab: { x: 39, y: 808 },
    networkTab: { x: 117, y: 808 },
    postTab: { x: 195, y: 808 },
    notificationsTab: { x: 273, y: 808 },
    jobsTab: { x: 351, y: 808 },
    meAvatar: { x: 32, y: 68 },
    searchField: { x: 195, y: 68 },
    messaging: { x: 358, y: 68 },
    back: { x: 28, y: 62 },
    keyboardDone: { x: 350, y: 743 },
    firstPost: { x: 195, y: 280 },
    like: { x: 48, y: 548 },
    comment: { x: 118, y: 548 },
    repost: { x: 188, y: 548 },
    send: { x: 258, y: 548 },
    postMore: { x: 358, y: 168 },
    searchPeopleFilter: { x: 70, y: 120 },
    searchFirstResult: { x: 195, y: 220 },
    connect: { x: 195, y: 502 },
    follow: { x: 100, y: 468 },
    message: { x: 250, y: 468 },
    profileMore: { x: 358, y: 468 },
    profileMenu: { x: 358, y: 468 },
    profileAbout: { x: 195, y: 520 },
    addANote: { x: 195, y: 720 },
    sendWithoutNote: { x: 195, y: 774 },
    noteComposer: { x: 195, y: 140 },
    sendInvitation: { x: 195, y: 430 },
    dismissNote: { x: 40, y: 62 },
    invitations: { x: 80, y: 161 },
    grow: { x: 98, y: 115 },
    catchUp: { x: 293, y: 116 },
    manageNetwork: { x: 358, y: 534 },
    peopleYouMayKnow: { x: 195, y: 743 },
    firstPymkCard: { x: 195, y: 360 },
    firstPymkConnect: { x: 328, y: 360 },
    composeMessage: { x: 358, y: 62 },
    inboxSearch: { x: 195, y: 120 },
    threadComposer: { x: 160, y: 780 },
    threadSend: { x: 358, y: 780 },
    threadBack: { x: 28, y: 62 },
    firstNotification: { x: 195, y: 180 },
    jobsSearch: { x: 195, y: 68 },
    firstJob: { x: 195, y: 260 },
    postText: { x: 195, y: 220 },
    postPhoto: { x: 48, y: 760 },
    postSubmit: { x: 350, y: 62 },
    postDismiss: { x: 36, y: 62 },
    viewProfile: { x: 195, y: 200 },
    settings: { x: 358, y: 62 },
    swipe: { x: 195, startY: 700, endY: 250, durationMs: 450 },
};

export function scaleLinkedIn(
    base: LinkedInCoordinates,
    screenSize: { width: number; height: number },
): LinkedInCoordinates {
    const sx = screenSize.width / base.screenSize.width;
    const sy = screenSize.height / base.screenSize.height;
    const p = (pt: Point): Point => ({ x: Math.round(pt.x * sx), y: Math.round(pt.y * sy) });
    const scaled: LinkedInCoordinates = {
        screenSize: { ...screenSize },
        swipe: {
            x: Math.round(base.swipe.x * sx),
            startY: Math.round(base.swipe.startY * sy),
            endY: Math.round(base.swipe.endY * sy),
            durationMs: base.swipe.durationMs,
        },
        homeTab: p(base.homeTab),
        networkTab: p(base.networkTab),
        postTab: p(base.postTab),
        notificationsTab: p(base.notificationsTab),
        jobsTab: p(base.jobsTab),
        meAvatar: p(base.meAvatar),
        searchField: p(base.searchField),
        messaging: p(base.messaging),
        back: p(base.back),
        keyboardDone: p(base.keyboardDone),
        firstPost: p(base.firstPost),
        like: p(base.like),
        comment: p(base.comment),
        repost: p(base.repost),
        send: p(base.send),
        postMore: p(base.postMore),
        searchPeopleFilter: p(base.searchPeopleFilter),
        searchFirstResult: p(base.searchFirstResult),
        connect: p(base.connect),
        follow: p(base.follow),
        message: p(base.message),
        profileMore: p(base.profileMore),
        profileMenu: p(base.profileMenu),
        profileAbout: p(base.profileAbout),
        addANote: p(base.addANote),
        sendWithoutNote: p(base.sendWithoutNote),
        noteComposer: p(base.noteComposer),
        sendInvitation: p(base.sendInvitation),
        dismissNote: p(base.dismissNote),
        invitations: p(base.invitations),
        grow: p(base.grow),
        catchUp: p(base.catchUp),
        manageNetwork: p(base.manageNetwork),
        peopleYouMayKnow: p(base.peopleYouMayKnow),
        firstPymkCard: p(base.firstPymkCard),
        firstPymkConnect: p(base.firstPymkConnect),
        composeMessage: p(base.composeMessage),
        inboxSearch: p(base.inboxSearch),
        threadComposer: p(base.threadComposer),
        threadSend: p(base.threadSend),
        threadBack: p(base.threadBack),
        firstNotification: p(base.firstNotification),
        jobsSearch: p(base.jobsSearch),
        firstJob: p(base.firstJob),
        postText: p(base.postText),
        postPhoto: p(base.postPhoto),
        postSubmit: p(base.postSubmit),
        postDismiss: p(base.postDismiss),
        viewProfile: p(base.viewProfile),
        settings: p(base.settings),
    };
    return scaled;
}

export function linkedinForScreen(screenSize: { width: number; height: number }): LinkedInCoordinates {
    if (screenSize.width === LINKEDIN_IPHONE13.screenSize.width
        && screenSize.height === LINKEDIN_IPHONE13.screenSize.height) {
        return LINKEDIN_IPHONE13;
    }
    return scaleLinkedIn(LINKEDIN_IPHONE13, screenSize);
}
