# dsh-session-notification

[![npm version](https://img.shields.io/npm/v/@dingyi222666/dsh-session-notification.svg)](https://www.npmjs.com/package/@dingyi222666/dsh-session-notification)

English | [中文](README.zh.md)

A notification plugin for the dsh web GUI. When a session finishes, hits an error, asks you a question, or needs your permission, you get a heads-up: a sound plays, and when you step away from the tab a system notification keeps you in the loop.

## Screenshots

| The settings panel with the **Notifications** entry in the sidebar and the section content | The sound picker for each kind (the official dropdown) |
| --- | --- |
| ![The Notifications settings section](screenshots/01-notifications-section.png) | ![The sound picker menu](screenshots/02-sound-menu-open.png) |

## Install

```sh
# Install from npm (requires dsh >= 0.1.0-rc.6)
dsh plugin --profile web add @dingyi222666/dsh-session-notification
# Restart dsh web for it to take effect
dsh web
```

Everything lives in this plugin — no harness (host) changes:

- The settings section is registered through the client slot system (`settings.section`), exactly like official sections.
- Preferences persist in the browser (localStorage) and sync across tabs; nothing requires the host's `WEB_SETTINGS_NAMESPACES` or any other host-package change. (The node half still reserves the `dsh-session-notification` namespace host-side through the settings seam; that reservation is inert without exposure.)
- The settings shell maps only its own section ids to nav icons, so the Notifications nav row shows the shell's default gear.

## The four notification kinds

| Kind | When it fires | Default sound |
| --- | --- | --- |
| Session completed | A turn ends normally (`turn/end` completed) | chime |
| Session failed | A turn breaks with an error, or the host reports an agent error | fault |
| Question asked | The agent is waiting for your answer (`question/requested`) | pop |
| Permission requested | The agent requests an authorized operation (`approval/requested`) | alert |

Each kind can be enabled or disabled and reassigned to any of the four built-in sound effects (or muted). The four sounds are synthesized with Web Audio — no audio files are shipped — and the master volume is adjustable with the official-style slider.

## Custom audio

Beyond the four built-in sounds, each kind accepts **your own audio file** (mp3/ogg/wav, up to 1 MB): pick Custom audio on a kind's row to upload one, and it replaces the built-in for that kind — with a Replace and remove affordance, plus the Custom audio in use tag. Custom files are stored browser-locally (they are device media, not shared preferences).

## Browser notifications & the quiet default

Browser (system-level) notifications are **off by default**; turning the switch on asks for the browser's permission first (a user gesture). Once granted, a notification is shown when the event's session is not the one you are reading, or when the tab is in the background. Notifications carry the **page's own icon** (the favicon the harness serves). A completed session's notification carries its **final reply text** (the last assistant message). The Test notification button in the section sends one immediately to verify the channel once permission is granted. The session you are reading stays **quiet by default** — its own events don't interrupt you; flip the Alert for the current session toggle if you want it to alert too.

## The Notifications settings section

The plugin registers a **Notifications** section in the settings panel (Settings ⚙ → Notifications):

- **Browser notifications** master switch (+ permission state and an enable button),
- **Alert for the current session** toggle (opt in to being alerted while reading that session),
- **Sound** master switch,
- **Volume** slider,
- one row per notification kind: enable switch, custom-audio upload, sound picker (the official dropdown menu), and a Preview button,
- a Test notification button on the browser-notifications row (verifies the OS channel once permission is granted).

Preferences are stored **browser-locally** (localStorage) under the `dsh-session-notification` key — no host settings-namespace exposure required — so they persist across sessions and sync across tabs, and never depend on a harness change.

## How it works

The browser half watches the sessions list snapshot and each session's conversation snapshot — no polling, no new wire channels:

- A session's `running` edge true→false ends a run; the run is classified **failed** when a new `turn-error` node or a host `agent-error` appeared during it, otherwise **completed** (a failure that a retry recovered reads as completed).
- A pending-interaction edge (`question` / `approval`) raises the question / permission kinds, with the question text or the tool name+reason in the notification body.
- Sessions already idle (or already pending) when the plugin loads raise nothing.

## Development

- `yarn run build` — builds the browser bundle (`lib/client.js`) and the Node half (`lib/index.js` / `lib/invariant.js`).
- `src/client/notification-service.ts` — the engine (classification) and dispatcher (gating); `src/client/settings-store.ts` — the settings section bridge; `src/client/NotificationsSection.tsx` — the section UI; `src/client/sounds.ts` + `src/client/custom-audio.ts` — the built-in and custom sounds.
- `yarn test` — behavior tests; `yarn run typecheck` — type gate.
- Node-half changes need a `dsh web` restart; browser-bundle changes need a rebuild (`yarn run build`) — a `--dev` server hot-reloads them.

## Known limitations

- Failure detection reads the conversation snapshot, which the client only maintains for sessions that have been opened; a session that runs without ever being opened notifies as completed even on failure.
- Browser notifications require permission, and sound playback requires the page to have user activation (the browser's autoplay policy) — both are normal for browser apps and resolve as soon as the user interacts with the GUI.
- Custom audio files live in the browser (localStorage), so they do not follow you across browsers or profiles.
- The browser half is event-driven from the sessions list; it does not observe the raw event stream, so a run that starts and finishes between two list snapshots could in principle be missed (the host sends a status flip per edge, so this does not happen in practice).

## Model Experience

None. The plugin is a pure client-side observer over the already-logged session state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.
