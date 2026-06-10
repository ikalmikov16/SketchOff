/**
 * Tests for room cleanup utilities
 *
 * These tests verify the cleanup logic for stale rooms and archives.
 * We mock Firebase completely to test the business logic.
 */

import { get, ref, remove, set } from 'firebase/database';
import { getCurrentUserId } from '../../../src/config/firebase';

// We need to mock the entire module before importing the functions
jest.mock('firebase/database', () => ({
  get: jest.fn(),
  ref: jest.fn((db, path) => ({ path })),
  remove: jest.fn(() => Promise.resolve()),
  set: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../src/config/firebase', () => ({
  database: {},
  getCurrentUserId: jest.fn(),
}));

// Import after mocking
import {
  archiveGameAndCleanup,
  cleanupStaleRooms,
  cleanupOldArchives,
  runCleanupTasks,
} from '../../../src/utils/roomCleanup';

describe('roomCleanup utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: user is authenticated
    getCurrentUserId.mockReturnValue('test-user-123');
  });

  describe('cleanupStaleRooms', () => {
    it('should return early when not authenticated', async () => {
      getCurrentUserId.mockReturnValue(null);

      const result = await cleanupStaleRooms();

      expect(result).toEqual({ cleaned: 0, archived: 0 });
      expect(get).not.toHaveBeenCalled();
    });

    it('should return zeros when no rooms exist', async () => {
      get.mockResolvedValue({
        exists: () => false,
        val: () => null,
      });

      const result = await cleanupStaleRooms();

      expect(result).toEqual({ cleaned: 0, archived: 0 });
    });

    it('should delete finished rooms older than 1 hour', async () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'finished',
            hostId: 'test-user-123',
            lastActivity: twoHoursAgo,
            players: {
              'test-user-123': { id: 'test-user-123', name: 'Host' },
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(1);
      expect(remove).toHaveBeenCalled();
    });

    it('should NOT delete finished rooms less than 1 hour old', async () => {
      const now = Date.now();
      const thirtyMinutesAgo = now - 30 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'finished',
            hostId: 'test-user-123',
            lastActivity: thirtyMinutesAgo,
            players: {
              'test-user-123': { id: 'test-user-123', name: 'Host' },
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(0);
      expect(remove).not.toHaveBeenCalled();
    });

    it('should delete any room older than 24 hours', async () => {
      const now = Date.now();
      const twoDaysAgo = now - 48 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'lobby', // Not finished, but very old
            hostId: 'test-user-123',
            lastActivity: twoDaysAgo,
            players: {
              'test-user-123': { id: 'test-user-123', name: 'Host' },
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(1);
    });

    it('should preserve active rooms with recent activity', async () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'drawing', // Active game
            hostId: 'test-user-123',
            lastActivity: fiveMinutesAgo,
            players: {
              'test-user-123': { id: 'test-user-123', name: 'Host' },
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(0);
      expect(remove).not.toHaveBeenCalled();
    });

    it('should NOT clean rooms where user has no permission', async () => {
      const now = Date.now();
      const twoDaysAgo = now - 48 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'finished',
            hostId: 'other-user', // Not our user
            lastActivity: twoDaysAgo,
            players: {
              'other-user': { id: 'other-user', name: 'Someone' },
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(0);
    });

    it('should allow cleanup if user is a player (not host)', async () => {
      const now = Date.now();
      const twoDaysAgo = now - 48 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'finished',
            hostId: 'other-user',
            lastActivity: twoDaysAgo,
            players: {
              'other-user': { id: 'other-user', name: 'Host' },
              'test-user-123': { id: 'test-user-123', name: 'Player' }, // We're a player
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(1);
    });

    it('should archive rooms with drawings before deleting', async () => {
      const now = Date.now();
      const twoDaysAgo = now - 48 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'finished',
            hostId: 'test-user-123',
            lastActivity: twoDaysAgo,
            players: {
              'test-user-123': { id: 'test-user-123', name: 'Host' },
            },
            drawings: {
              round1: {
                'test-user-123': { url: 'https://example.com/drawing.png' },
              },
            },
            settings: { numRounds: 3 },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.archived).toBe(1);
      expect(set).toHaveBeenCalled(); // Archive was created
    });

    it('should use createdAt if lastActivity is missing', async () => {
      const now = Date.now();
      const twoDaysAgo = now - 48 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          ROOM123: {
            status: 'lobby',
            hostId: 'test-user-123',
            createdAt: twoDaysAgo, // No lastActivity, fall back to createdAt
            players: {
              'test-user-123': { id: 'test-user-123', name: 'Host' },
            },
          },
        }),
      });

      const result = await cleanupStaleRooms();

      expect(result.cleaned).toBe(1);
    });
  });

  describe('archiveGameAndCleanup', () => {
    it('should return false when not authenticated', async () => {
      getCurrentUserId.mockReturnValue(null);

      const result = await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings: {},
        numRounds: 3,
      });

      expect(result).toBe(false);
    });

    it('should create archive with essential data', async () => {
      const players = [
        { id: 'user1', name: 'Alice', totalScore: 25, isHost: true },
        { id: 'user2', name: 'Bob', totalScore: 20, isHost: false },
      ];

      const drawings = {
        user1: { url: 'https://example.com/alice.png', round: 1 },
        user2: { url: 'https://example.com/bob.png', round: 1 },
      };

      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players,
        drawings,
        numRounds: 3,
      });

      expect(set).toHaveBeenCalled();
      const archiveCall = set.mock.calls[0];
      const archiveData = archiveCall[1];

      expect(archiveData.roomCode).toBe('ROOM123');
      expect(archiveData.numRounds).toBe(3);
      expect(archiveData.players).toHaveLength(2);
      expect(archiveData.completedAt).toBeDefined();
    });

    it('should preserve drawing URLs in archive', async () => {
      const drawings = {
        user1: { url: 'https://example.com/drawing1.png', round: 1 },
        user2: { url: 'https://example.com/drawing2.png', round: 2 },
      };

      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [{ id: 'user1', name: 'Alice' }],
        drawings,
        numRounds: 3,
      });

      const archiveData = set.mock.calls[0][1];

      expect(archiveData.drawings.user1.url).toBe('https://example.com/drawing1.png');
      expect(archiveData.drawings.user2.url).toBe('https://example.com/drawing2.png');
    });

    it('should filter out drawings without URLs', async () => {
      const drawings = {
        user1: { url: 'https://example.com/drawing.png', round: 1 },
        user2: { round: 1 }, // No URL
        user3: null, // Null entry
      };

      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings,
        numRounds: 3,
      });

      const archiveData = set.mock.calls[0][1];

      expect(archiveData.drawings.user1).toBeDefined();
      expect(archiveData.drawings.user2).toBeUndefined();
      expect(archiveData.drawings.user3).toBeUndefined();
    });

    it('should flatten round-keyed drawings from room data', async () => {
      // Rooms store drawings as drawings/round{N}/{playerId}
      const drawings = {
        round1: {
          user1: { url: 'https://example.com/r1-alice.png', submittedAt: 1 },
          user2: { url: 'https://example.com/r1-bob.png', submittedAt: 2 },
        },
        round2: {
          user1: { url: 'https://example.com/r2-alice.png', submittedAt: 3 },
        },
      };

      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings,
        numRounds: 2,
      });

      const archiveData = set.mock.calls[0][1];

      // Latest round wins per player
      expect(archiveData.drawings.user1).toEqual({
        url: 'https://example.com/r2-alice.png',
        round: 2,
      });
      expect(archiveData.drawings.user2).toEqual({
        url: 'https://example.com/r1-bob.png',
        round: 1,
      });
    });

    it('should default round to 1 if missing', async () => {
      const drawings = {
        user1: { url: 'https://example.com/drawing.png' }, // No round specified
      };

      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings,
        numRounds: 3,
      });

      const archiveData = set.mock.calls[0][1];

      expect(archiveData.drawings.user1.round).toBe(1);
    });

    it('should delete the room after archiving', async () => {
      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings: {},
        numRounds: 3,
      });

      expect(remove).toHaveBeenCalled();
      const removeCall = remove.mock.calls[0][0];
      expect(removeCall.path).toContain('ROOM123');
    });

    it('should handle empty drawings object', async () => {
      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings: {},
        numRounds: 3,
      });

      const archiveData = set.mock.calls[0][1];
      expect(archiveData.drawings).toEqual({});
    });

    it('should handle undefined drawings', async () => {
      await archiveGameAndCleanup({
        roomCode: 'ROOM123',
        players: [],
        drawings: undefined,
        numRounds: 3,
      });

      const archiveData = set.mock.calls[0][1];
      expect(archiveData.drawings).toEqual({});
    });
  });

  describe('cleanupOldArchives', () => {
    it('should return early when not authenticated', async () => {
      getCurrentUserId.mockReturnValue(null);

      const result = await cleanupOldArchives();

      expect(result).toEqual({ cleaned: 0 });
    });

    it('should return zeros when no archives exist', async () => {
      get.mockResolvedValue({
        exists: () => false,
        val: () => null,
      });

      const result = await cleanupOldArchives();

      expect(result).toEqual({ cleaned: 0 });
    });

    it('should delete archives older than 30 days', async () => {
      const now = Date.now();
      const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          'archive-1': { completedAt: fortyDaysAgo },
        }),
      });

      const result = await cleanupOldArchives();

      expect(result.cleaned).toBe(1);
      expect(remove).toHaveBeenCalled();
    });

    it('should NOT delete archives less than 30 days old', async () => {
      const now = Date.now();
      const twentyDaysAgo = now - 20 * 24 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          'archive-1': { completedAt: twentyDaysAgo },
        }),
      });

      const result = await cleanupOldArchives();

      expect(result.cleaned).toBe(0);
      expect(remove).not.toHaveBeenCalled();
    });

    it('should clean multiple old archives', async () => {
      const now = Date.now();
      const fortyDaysAgo = now - 40 * 24 * 60 * 60 * 1000;
      const fiftyDaysAgo = now - 50 * 24 * 60 * 60 * 1000;

      get.mockResolvedValue({
        exists: () => true,
        val: () => ({
          'archive-1': { completedAt: fortyDaysAgo },
          'archive-2': { completedAt: fiftyDaysAgo },
        }),
      });

      const result = await cleanupOldArchives();

      expect(result.cleaned).toBe(2);
    });
  });

  describe('runCleanupTasks', () => {
    it('should run both cleanup tasks in parallel', async () => {
      get.mockResolvedValue({
        exists: () => false,
        val: () => null,
      });

      const result = await runCleanupTasks();

      expect(result).toEqual({
        roomsCleaned: 0,
        roomsArchived: 0,
        archivesCleaned: 0,
      });
      // get should be called twice (once for rooms, once for archives)
      expect(get).toHaveBeenCalledTimes(2);
    });
  });
});
