/**
 * Presence system for multiplayer rooms.
 *
 * Each player keeps a `connected` flag on their player node. A server-side
 * onDisconnect handler flips it to false when the socket drops (app killed,
 * network lost, etc.), so other clients can stop waiting on them. The flag
 * approach (instead of removing the player) preserves scores and lets a
 * player rejoin an in-progress game.
 *
 * Old app versions never write `connected`, so a missing flag must always be
 * treated as "connected" (use `isPlayerConnected`).
 */
import {
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
  update,
} from 'firebase/database';
import { database } from '../config/firebase';

let activePresence = null; // { roomCode, playerId, unsubscribe, playerRef }

/**
 * Treat players without a `connected` flag (old clients, pre-presence data)
 * as connected.
 */
export function isPlayerConnected(player) {
  return player?.connected !== false;
}

/**
 * A player node is valid only with id + name. Partial "ghost" nodes can
 * appear if an onDisconnect write lands after the player was removed
 * (kick/leave); they must be filtered from UI and deleted inside
 * transactions (they fail rule validation and would block the whole write).
 */
export function isValidPlayer(player) {
  return Boolean(player && player.id && player.name);
}

/**
 * Delete ghost player nodes from a room object inside a transaction.
 * Mutates and returns the room.
 */
export function removeGhostPlayers(room) {
  if (!room?.players) return room;
  Object.entries(room.players).forEach(([id, p]) => {
    if (!isValidPlayer(p)) {
      delete room.players[id];
    }
  });
  return room;
}

/**
 * Start tracking presence for the current player in a room.
 * Safe to call repeatedly (e.g. from every multiplayer screen) - re-registering
 * for the same room/player is a no-op. Registering for a new room clears the
 * previous registration first.
 */
export function registerPresence(roomCode, playerId) {
  if (
    activePresence &&
    activePresence.roomCode === roomCode &&
    activePresence.playerId === playerId
  ) {
    return;
  }

  clearPresence();

  const playerRef = ref(database, `rooms/${roomCode}/players/${playerId}`);
  const connectedRef = ref(database, '.info/connected');

  // Firebase recommended pattern: every time the client (re)connects,
  // re-arm the server-side onDisconnect handler, then mark ourselves online.
  const unsubscribe = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() !== true) return;

    onDisconnect(playerRef)
      .update({ connected: false, lastSeen: serverTimestamp() })
      .then(() => update(playerRef, { connected: true, lastSeen: Date.now() }))
      .catch(() => {
        // Room may have been deleted or we were kicked - nothing to do
      });
  });

  activePresence = { roomCode, playerId, unsubscribe, playerRef };
}

/**
 * Stop tracking presence (explicit leave, game over, joining another room).
 * Cancels the pending onDisconnect so leaving cleanly doesn't mark the
 * player offline afterwards.
 */
export function clearPresence() {
  if (!activePresence) return;

  const { unsubscribe, playerRef } = activePresence;
  activePresence = null;

  try {
    unsubscribe();
  } catch (_e) {
    // Listener may already be detached
  }
  onDisconnect(playerRef)
    .cancel()
    .catch(() => {});
}

/**
 * Promote a new host when the current host is offline or missing.
 * Any client may call this - the transaction guarantees only one promotion
 * happens. The earliest-joined connected player becomes host.
 */
export async function migrateHostIfNeeded(roomCode) {
  try {
    const roomRef = ref(database, `rooms/${roomCode}`);
    await runTransaction(roomRef, (room) => {
      // Local cache miss - return as-is so Firebase refetches and reruns
      if (!room) return room;
      if (!room.players) return undefined;

      const host = room.players[room.hostId];
      if (host && isPlayerConnected(host)) return undefined; // Host is fine

      const candidates = Object.values(room.players).filter(
        (p) => isValidPlayer(p) && isPlayerConnected(p)
      );
      if (candidates.length === 0) return undefined; // Nobody to promote

      removeGhostPlayers(room);

      candidates.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || a.id.localeCompare(b.id));
      room.hostId = candidates[0].id;
      room.lastActivity = Date.now();
      return room;
    });
  } catch (error) {
    console.error('Error migrating host:', error);
  }
}
