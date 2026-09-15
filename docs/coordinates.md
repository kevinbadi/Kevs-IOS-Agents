# Coordinate profiles

**Short answer to "can people add coordinate configs?":** not at runtime. A
coordinate profile is a compiled constant in the source. `devices.json` only
*selects* one that already exists. Adding a new layout means editing two files
and redeploying. Profiles ship with `tiktok`, `instagram`, and `linkedin` tap maps
(`iphone8`, `iphoneX`, `iphone13`, and `iphone17pro` today).

## What a profile is

A profile is a full set of tap targets for one screen geometry, in
**points** (not pixels), defined by the `DeviceCoordinates` interface in
`src/devices/coordinates.ts`:

- `screenSize` — `{ width, height }` in points
- `passcodeKeypad` — column x's and row y's for auto‑unlock
- `tiktok` / `instagram` — every tap/swipe the built‑in social plugins use
  (tabs, create, media picker, caption, like/save/comment, Following tab,
  feed swipe, …)

```ts
export const DEVICE_COORDINATES = {
  iphone8: {
    displayName: 'iPhone 8',
    productTypes: ['iPhone10,1', 'iPhone10,4'],
    screenSize: { width: 375, height: 667 },
    passcodeKeypad: { columnX: [103, 191, 275], rowY: [220, 347, 425, 506] },
    tiktok: { profileTab: { x: 338, y: 656 }, /* … */ },
    instagram: { profileTab: { x: 337, y: 650 }, /* … */ },
  },
} satisfies Record<string, DeviceCoordinates>;
```

Dashboard calibration can target TikTok, Instagram, or LinkedIn
(`GET/PATCH` with `app=tiktok|instagram|linkedin`). TikTok overrides live in
`device.coordinates`; Instagram in `device.instagramCoordinates`; LinkedIn in
`device.linkedinCoordinates`. See [`docs/linkedin.md`](linkedin.md). LinkedIn
Touch points are **per workflow** (`?workflow=cold-connect` is with-note,
`?workflow=connect` is Send without note). Pass `workflow=all` for the full
chrome map.

## How selection works

- `devices.json` → `"coordinateProfile": "<key>"` picks a profile.
- No `coordinateProfile` → `DEFAULT_COORDINATE_PROFILE` (`iphone8`).
- An unknown key throws at load:
  `Unknown coordinate profile "…". Add it to src/devices/coordinates.ts.`
- `coordinateProfiles()` powers the picker in the registration UI;
  `profileForProductType(productType)` can auto‑suggest a profile if the
  device's `productType` is listed in some profile's `productTypes`.

## Adding a profile (e.g. iPhone 13/14, 390 × 844)

1. **`src/devices/coordinates.ts`** — add a key to `DEVICE_COORDINATES`:

   ```ts
   iphone13: {
     displayName: 'iPhone 13/14',
     productTypes: ['iPhone14,5', 'iPhone14,7'],
     screenSize: { width: 390, height: 844 },
     passcodeKeypad: { columnX: [/* … */], rowY: [/* … */] },
     tiktok: { /* every field, re-measured for this screen */ },
     instagram: { /* every field, re-measured for this screen */ },
     linkedin: { /* scaled from src/linkedin/coordinates.ts or re-measured */ },
   },
   ```

2. **`src/tiktok/coordinates.ts`** and **`src/instagram/coordinates.ts`** —
   mirror the matching app block and `passcodeKeypad` under the same key.
   Standalone entrypoints load these self‑contained copies so they can run as
   bare `tsx` scripts. Keep them in sync with `src/devices/coordinates.ts`.

3. `npm run typecheck && npm test`, redeploy `web` + `worker`, then set
   `"coordinateProfile": "iphone13"` on the matching `devices.json` entries.

### Measuring coordinates

Open the device's live screen in the dashboard, or
`GET /api/devices/:udid/remote/screenshot`. The image is in points already
(WDA reports a point‑sized screen). Read off each target's centre. Verify by
firing single taps with `POST /api/devices/:udid/remote/action`
(`{ "type": "tap", "x": …, "y": … }`) and watching the screen.

## Per‑device overrides (dashboard calibration)

The **single-tap calibratable targets** for TikTok and Instagram share one
shape (tabs, create, picker Next, like/save/comment, DMs). LinkedIn has its
own set — Home / My Network / Post / Notifications / Jobs, Search,
Connect / Add a note / Send, People You May Know, Messaging — listed in
`LINKEDIN_CALIBRATABLE_POINTS`. Re-point any of them from the device page →
**Touch points**: choose **TikTok**, **Instagram**, or **LinkedIn**, pick a
target, click where it belongs on the live screen, Save. Reset one point or
all of them back to the profile. Flip **Control device** to drive the phone
with taps/swipes on the preview so you can get to the screen a target lives
on, and the padlock button unlocks it.

Overrides merge over the selected profile at runtime
(`resolveDeviceCoordinates`):

```jsonc
{ "name": "Phone 12", "coordinateProfile": "iphone8",
  "coordinates": { "like": { "x": 350, "y": 320 }, "create": { "x": 190, "y": 642 } },
  "instagramCoordinates": { "like": { "x": 348, "y": 410 } },
  "linkedinCoordinates": { "connect": { "x": 88, "y": 318 } } }
```

API: `GET /api/devices/:udid/coordinates?app=tiktok|instagram|linkedin` (effective
values + which are overridden), `PATCH /api/devices/:udid` with
`{ "coordinates": { … } }`, `{ "instagramCoordinates": { … } }`, and/or
`{ "linkedinCoordinates": { … } }` — each object **merges** into that app's
override map; `{}` clears it. Points are validated against the profile's
screen bounds.

The `picker` grid, `swipe` vector and `passcodeKeypad` are not single points and
stay profile‑level — add a new profile for a materially different layout.

## Why adding a whole profile still needs code

The profile map is a typed `const` so the compiler can guarantee every field
exists and every `devices.json` reference resolves. A JSON/env‑loaded profile
source (validated at startup, same shape) would be a reasonable contribution.
Until then, treat new device geometries as a small PR against
`src/devices/coordinates.ts` plus the mirrored `src/tiktok/coordinates.ts` and
`src/instagram/coordinates.ts` files.

A plugin **cannot** currently register its own coordinate profiles; the
`tiktok` / `instagram` blocks are specific to the built‑in social plugins. A
third‑party plugin that needs screen‑relative taps should ship its own
coordinate map inside the package and key it on `device.productType` or its
own `pluginData`.
