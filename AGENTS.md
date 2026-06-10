# SketchOff — Agent Guide

Multiplayer drawing game built with **React Native 0.81 + Expo SDK 54** (JavaScript, no TypeScript).
Players draw a prompt, rate each other's drawings 0–10, and compete across rounds.

## Commands

**Use `bun` as the package manager and script runner** (lockfile is `bun.lock`; do not create a `package-lock.json`).

| Command | Purpose |
|---|---|
| `bun install` | Install dependencies |
| `bun start` | Expo dev server |
| `bun run test` | Jest (jest-expo preset, tests in `__tests__/`) |
| `bun run lint` | ESLint (`expo lint`, flat config) |
| `bun run format` | Prettier — the formatter for all code (single quotes, 100 col, 2-space, es5 trailing commas) |
| `bun run format:check` | Prettier check without writing |

Always run `bun run test`, `bun run lint`, and `bun run format` after making changes. CI (`.github/workflows/ci.yml`) uses bun and runs lint, format check, and tests on every push/PR to main.

## Architecture

Entry point is `App.js`: consent gate → anonymous Firebase auth → React Navigation native stack.
Two completely separate game modes:

1. **Single-device mode** (offline, pass-the-phone): `Setup → Topic → Rating → RoundResults → FinalResults` screens. State lives in `src/context/GameContext.js` (plain React state, no persistence). Players draw on paper; the app only handles topics, timing, and scoring.
2. **Multiplayer mode** (Firebase Realtime Database): `RoomCreate/RoomJoin → Lobby → MultiplayerDrawing → MultiplayerRating → MultiplayerResults → (loop rounds) → MultiplayerFinal`. All shared state lives in RTDB under `rooms/{roomCode}`; screens subscribe with `onValue` and navigate when `status` changes.

```
src/
  components/   Reusable UI (EnhancedDrawingCanvas wraps react-native-signature-canvas)
  config/       firebase.js init + firebase.rules.json + storage.rules (source of truth for deployed rules)
  context/      GameContext (single-device state), ThemeContext (dark theme only)
  data/         topics.js — hardcoded fallback topics/themes
  screens/      One file per screen; Multiplayer* screens mirror single-device ones
  services/     TopicService — topics from RTDB with AsyncStorage cache + fallback
  utils/        constants, haptics, network, roomCleanup, roomCode, sharing, sounds, storage
```

## Firebase data model (RTDB)

```
rooms/{ROOMCODE}                       6-char code from utils/roomCode.js (no O or 0)
  code, hostId                         hostId === creator's anonymous auth uid
  status                               'lobby' | 'drawing' | 'rating' | 'results' | 'finished'
  settings: { numRounds, timeLimit }   numRounds 1–10, timeLimit 30–300 seconds
  players/{uid}: { id, name, totalScore, roundScore,     name 1–20 chars
                   connected?, lastSeen?, joinedAt? }    presence fields (see invariants)
  drawings/round{N}/{uid}: { url, submittedAt, isPlaceholder? }
  ratings/{raterUid}/{ratedUid}: 0–10  cleared (set to {}) when the next round starts
  currentRound, currentTopic, createdAt, lastActivity,
  drawingStartTime, drawingEndTime, nextRoomCode
topics: { version, themes/{key}: { name, emoji, topics: [] } }   seeded via scripts/seedTopics.js
archives/{timestamp_ROOMCODE}          lightweight record written before room deletion
```

Storage: drawings upload to `drawings/{roomCode}/{uid}_round{N}.png` — the file name **must start with the uploader's uid** (enforced by `storage.rules`), image/* only, < 5 MB.

## Critical invariants

- **`playerId` is always the Firebase anonymous auth uid.** Security rules key every permission off it. Never generate a separate player id.
- **Client-side validation must match `src/config/firebase.rules.json`** (rounds 1–10, timeLimit 30–300 s, names 1–20 chars, ratings 0–10, room code length 6). A client write outside these bounds fails with PERMISSION_DENIED at runtime.
- Rules in `src/config/*.rules*` are **deployed manually** by copy-pasting into the Firebase console. If you change them, say so loudly — the repo copy does nothing until deployed.
- Game-progress writes should refresh `lastActivity` — `utils/roomCleanup.js` deletes rooms idle > 24 h (or finished > 1 h) on app start, client-side (no Cloud Functions; free tier).
- "All players submitted" checks run on **every** client (no server). Any write that finalizes a phase (e.g. computing round scores) must be idempotent or use `runTransaction`, because multiple clients can race.
- **Presence** (`utils/presence.js`): every multiplayer screen calls `registerPresence(roomCode, playerId)`; an `onDisconnect` handler flips `players/{uid}/connected` to false when the socket drops. A **missing `connected` flag means connected** (old clients never write it) — always check via `isPlayerConnected()`. Call `clearPresence()` before removing your own player node or when the game ends, or the armed onDisconnect will re-create a ghost node later.
- Phase-advance checks only wait for **connected** players, and the drawing phase has a force-advance fallback (`ROUND_ADVANCE_GRACE_MS` after `drawingEndTime`). `migrateHostIfNeeded()` promotes the earliest-joined connected player when the host goes offline (lobby + results screens trigger it).
- Room creation is only allowed when the room doesn't exist (`!data.exists()` in the room `.write` rule) — never weaken this; it prevents arbitrary users from hijacking existing rooms.
- Web is view/rate only: no canvas, no haptics, no QR scanning. `Alert.alert` with buttons doesn't work on web — use `window.confirm`/`window.alert` behind a `Platform.OS === 'web'` check.

## Gotchas

- The drawing canvas is `react-native-signature-canvas` (WebView-based). It was migrated from Skia/react-native-free-canvas due to iOS new-arch crashes — don't reintroduce Skia. `toBase64()` resolves via the `onOK` callback with a 500 ms blank-PNG fallback timeout.
- `expo-file-system/legacy` is used intentionally (the new API changed in SDK 54). It does not work on web — web code paths must use `uploadString` to Firebase Storage instead.
- Timers count down with `setInterval` decrements to avoid cross-device clock skew; `drawingEndTime` from RTDB is only used to resync after backgrounding (AppState listener).
- `onValue` listeners must be cleaned up by calling the returned unsubscribe function in the effect cleanup.
- Tests mock all native modules in `jest.setup.js` and Firebase via `__tests__/__mocks__/firebase.js`; `firebase/database` is mocked per-test-file with `jest.mock`.
