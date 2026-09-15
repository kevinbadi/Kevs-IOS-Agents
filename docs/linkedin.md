# LinkedIn

Seeded on Phone Farm #1 geometry (iPhone 13, 390×844 pt, scale 3). Coordinates
live in `src/linkedin/coordinates.ts`; screen detection in
`src/linkedin/screen.ts`; workflow maps in `src/linkedin/workflows.ts`. Bundle
id `com.linkedin.LinkedIn`.

Touch points are **per workflow**, not one dump of every chrome target.
Device page → **Touch points** → App **LinkedIn** → Cold connect or Connection
request. The LinkedIn workflow tiles start a run from a CSV in
`data/linkedin/leads`. Per-device tweaks still save to `devices.json` as
`linkedinCoordinates`.

Every device profile (`iphone8`, `iphoneX`, `iphone13`, `iphone17pro`) ships a
scaled copy of the seed.

## Cold connect

Search a person, then **hidden connect** (Follow + Message + ⋯): Click profile
menu → Connect → Add note → type (200 chars) → Add note to invitation → Home.

If Connect is already on the profile (2nd degree), that button is tapped
instead of the menu.

| Step | Point | Seed (390×844) |
|---|---|---|
| 1. Open LinkedIn | `homeTab` | (39, 808) |
| 2. Search bar (top middle) | `searchField` | (195, 68) |
| 3. People filter | `searchPeopleFilter` | (70, 120) |
| 4. Select person | `searchFirstResult` | (195, 220) |
| 5. Click profile menu | `profileMenu` | (358, 468) |
| 6. Connect | `connect` | (195, 502) |
| 7. Add note | `addANote` | (195, 720) |
| 8. Note field | `noteComposer` | (195, 140) |
| 9. Add note to invitation | `sendInvitation` | (195, 430) |

```
IOS_UDID=00008110-000E403E1AC2401E WDA_URL=http://127.0.0.1:8101 \
  LINKEDIN_LEADS_CSV=data/linkedin/leads/result.csv \
  LINKEDIN_CONNECT_NOTE='Hi {firstName}, we are doing some cool things in marketing and want to connect' \
  npm run linkedin:cold-connect
```

Cap is **5 connects per run**, 5 runs/day (25). The note is supplied per run
(`{firstName}` is filled in). After Send the runner taps Home. Anyone already
`sent` is crossed off and skipped on the next run. A failed verify is skipped
and we move on — **Add note to invitation is never tapped unless OCR says we
are on the note composer**.

`GET /api/devices/:udid/coordinates?app=linkedin&workflow=cold-connect` returns
these nine taps.

## Connection request

Same search path as Cold connect. While a free account still has monthly
notes left, Connect always opens **Add a note or connect now**. This
workflow taps **Send without note**. After the 5 notes are used, LinkedIn
may skip the composer; the same tap still sends the request.

| Step | Point | Seed (390×844) |
|---|---|---|
| 1. Open LinkedIn | `homeTab` | (39, 808) |
| 2. Search bar (top middle) | `searchField` | (195, 68) |
| 3. People filter | `searchPeopleFilter` | (70, 120) |
| 4. Select person | `searchFirstResult` | (195, 220) |
| 5. Click profile menu | `profileMenu` | (358, 468) |
| 6. Connect | `connect` | (195, 502) |
| 7. Send without note | `sendWithoutNote` | (195, 774) |

```
IOS_UDID=00008110-000E403E1AC2401E WDA_URL=http://127.0.0.1:8101 \
  LINKEDIN_LEADS_CSV=data/linkedin/leads/connect.csv \
  npm run linkedin:connect
```

Cap is still **5 connects per run**. After Send without note the runner waits
for **Pending** on that person's profile or an **Invitation sent** banner.
Still on the add-note sheet, the note composer, or a profile without Pending
is skipped — we never tap Add note on this path.

`GET /api/devices/:udid/coordinates?app=linkedin&workflow=connect` returns
these seven taps.

## Screens

| Screen | How we recognise it (OCR) | Notes |
|---|---|---|
| Home | header `Search` without a People filter row | tab bar + Me / Search / Messaging |
| My Network | `Grow` / `Catch up` under Search, or `Invitations` | Grow is the default; PYMK is below the fold |
| Notifications | title `Notifications` | |
| Jobs | title `Jobs` plus Easy Apply / search jobs | |
| Search | `Search` + `People` filter chip | first result is the connection-request entry |
| Profile (hidden connect) | `Follow` + `Message` on the CTA row | ⋯ is `profileMenu` |
| Profile menu | `Personalize` / `Contact` + `Connect` | Connect is mid-list |
| Connect sheet | `Send without note` | Cold connect taps **Add note**; Connection request taps **Send without note** |
| Connect sent | `Invitation` + `sent` (no 200-char composer) | confirmation after a no-note invite |
| Connect note | `invitation` + `Premium` / `200` | Add note to invitation, 200 cap |
| Messaging | title `Messaging` | compose is top-right |
| Profile (other) | `Connect`/`Follow`/`Pending` plus `About`/`Message` | Connect is the left CTA |
| Post composer | `Anyone` + `Post`/`Photo` | dismiss, do not publish in mapping |
| Me | `View` + `profile` | settings top-right |

## Chrome

Bottom tabs, left to right: **Home · My Network · Post · Notifications · Jobs**.
On 390×844 the row sits at y≈808.

Home header: Me avatar (32, 68), Search bar (195, 68), Messaging (358, 68).

My Network (measured on Farm #1, Grow tab): **Grow** (98, 115) / **Catch up** (293, 116), **Invitations** (80, 161), **Manage my network** chevron (358, 534), **People you may know** header (195, 743). Invitation ignore/accept sit at x≈306 / 354 on each row. PYMK cards are under the tab bar — scroll before tapping Connect.

## Tour

```
IOS_UDID=00008110-000E403E1AC2401E WDA_URL=http://127.0.0.1:8101 npm run linkedin:tour
```

Walks the bottom tabs. Writes screenshots under `data/linkedin/tour/<session>/`.
Never sends a connection request.
