import { get, ref, remove, set } from 'firebase/database';
import { database, getCurrentUserId } from '../config/firebase';
import { CLEANUP_CONFIG } from './constants';

/**
 * Normalize drawings into one entry per player: { [playerId]: { url, round } }.
 *
 * Rooms store drawings keyed by round (`drawings/round1/{playerId}`), while the
 * archive format is keyed by player. Accepts either shape; when a player has
 * drawings in multiple rounds, the latest round wins.
 */
function flattenDrawingsByPlayer(drawings) {
  const flat = {};

  for (const [key, value] of Object.entries(drawings || {})) {
    const roundMatch = key.match(/^round(\d+)$/);

    if (roundMatch && value && typeof value === 'object') {
      const round = parseInt(roundMatch[1], 10);
      for (const [playerId, drawingData] of Object.entries(value)) {
        if (drawingData?.url && (!flat[playerId] || round >= flat[playerId].round)) {
          flat[playerId] = { url: drawingData.url, round };
        }
      }
    } else if (value?.url) {
      // Already player-keyed; default to round 1 if round is missing (old data)
      flat[key] = { url: value.url, round: value.round ?? 1 };
    }
  }

  return flat;
}

/**
 * Archive a completed game's essential data (preserves drawing URLs)
 * and delete the room data to save space.
 *
 * This keeps the archived data lightweight while preserving
 * references to drawings stored in Firebase Storage.
 */
export async function archiveGameAndCleanup({ roomCode, players, drawings, numRounds }) {
  const userId = getCurrentUserId();
  if (!userId) {
    console.warn('Cannot archive game: not authenticated');
    return false;
  }

  try {
    // Create archive entry with essential data only
    const archiveData = {
      roomCode,
      completedAt: Date.now(),
      numRounds,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        totalScore: p.totalScore || 0,
        isHost: p.isHost || false,
      })),
      // Preserve drawing URLs so images remain accessible
      drawings: flattenDrawingsByPlayer(drawings),
    };

    // Save to archives (indexed by timestamp for easy cleanup later if needed)
    const archiveId = `${Date.now()}_${roomCode}`;
    await set(ref(database, `archives/${archiveId}`), archiveData);

    // Delete the room data
    await remove(ref(database, `rooms/${roomCode}`));

    return true;
  } catch (error) {
    console.error('Error archiving game:', error);
    return false;
  }
}

/**
 * Clean up stale rooms on app start.
 * Runs client-side since Cloud Functions require paid tier.
 *
 * SAFETY: Only deletes rooms that are clearly no longer in use:
 * - Finished games older than 1 hour (game is complete)
 * - Any room older than 24 hours with no activity (abandoned)
 *
 * Rooms that are "still in play" (lobby/drawing/rating/results with recent
 * activity) will NOT be deleted because they won't meet the age thresholds.
 *
 * Should be called once on app start.
 */
export async function cleanupStaleRooms() {
  const userId = getCurrentUserId();
  if (!userId) {
    // Not authenticated yet, skip cleanup
    return { cleaned: 0, archived: 0 };
  }

  try {
    const roomsRef = ref(database, 'rooms');
    const snapshot = await get(roomsRef);

    if (!snapshot.exists()) {
      return { cleaned: 0, archived: 0 };
    }

    const now = Date.now();
    const rooms = snapshot.val();
    let cleaned = 0;
    let archived = 0;

    for (const [roomCode, roomData] of Object.entries(rooms)) {
      const lastActivity = roomData.lastActivity || roomData.createdAt || 0;
      const age = now - lastActivity;

      // Only clean up rooms where the current user has permission
      // (user is host or a player in the room)
      const isHost = roomData.hostId === userId;
      const isPlayer = roomData.players && roomData.players[userId];
      const hasPermission = isHost || isPlayer;

      if (!hasPermission) {
        // Skip rooms we don't have permission to delete
        continue;
      }

      let shouldClean = false;
      let shouldArchive = false;

      // Finished games older than 1 hour - safe to clean (game is over)
      if (roomData.status === 'finished' && age > CLEANUP_CONFIG.FINISHED_ROOM_MAX_AGE_MS) {
        shouldClean = true;
        shouldArchive = true;
      }
      // Any room older than 24 hours - abandoned, safe to clean
      // (active games update lastActivity frequently, so they won't hit this)
      else if (age > CLEANUP_CONFIG.STALE_ROOM_MAX_AGE_MS) {
        shouldClean = true;
        shouldArchive = true;
      }

      if (shouldClean) {
        try {
          if (shouldArchive && roomData.drawings) {
            // Archive before deleting (preserves drawing URLs)
            await archiveGameAndCleanup({
              roomCode,
              players: Object.values(roomData.players || {}),
              drawings: roomData.drawings,
              numRounds: roomData.settings?.numRounds || 0,
            });
            archived++;
          } else {
            // No drawings to archive, just delete
            await remove(ref(database, `rooms/${roomCode}`));
          }
          cleaned++;
        } catch (error) {
          console.warn(`Failed to clean up room ${roomCode}:`, error);
        }
      }
    }

    return { cleaned, archived };
  } catch (error) {
    console.warn('Error during room cleanup:', error);
    return { cleaned: 0, archived: 0 };
  }
}

/**
 * Clean up old archives to prevent unbounded growth.
 * Keeps archives for 30 days, then deletes them.
 * (Drawings in Storage remain - only archive metadata is deleted)
 */
export async function cleanupOldArchives() {
  const userId = getCurrentUserId();
  if (!userId) {
    return { cleaned: 0 };
  }

  try {
    const archivesRef = ref(database, 'archives');
    const snapshot = await get(archivesRef);

    if (!snapshot.exists()) {
      return { cleaned: 0 };
    }

    const now = Date.now();
    const archiveMaxAgeMs = CLEANUP_CONFIG.ARCHIVE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const archiveExpiry = now - archiveMaxAgeMs;
    const archives = snapshot.val();
    let cleaned = 0;

    for (const [archiveId, archiveData] of Object.entries(archives)) {
      if (archiveData.completedAt < archiveExpiry) {
        try {
          await remove(ref(database, `archives/${archiveId}`));
          cleaned++;
        } catch (error) {
          console.warn(`Failed to clean up archive ${archiveId}:`, error);
        }
      }
    }

    return { cleaned };
  } catch (error) {
    console.warn('Error during archive cleanup:', error);
    return { cleaned: 0 };
  }
}

/**
 * Run all cleanup tasks.
 * Call this on app start after authentication.
 */
export async function runCleanupTasks() {
  // Run cleanups in parallel
  const [roomResult, archiveResult] = await Promise.all([
    cleanupStaleRooms(),
    cleanupOldArchives(),
  ]);

  return {
    roomsCleaned: roomResult.cleaned,
    roomsArchived: roomResult.archived,
    archivesCleaned: archiveResult.cleaned,
  };
}
