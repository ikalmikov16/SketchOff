/**
 * Tests for the presence utilities (connected flags, ghost-node repair,
 * host migration).
 */

import { runTransaction } from 'firebase/database';

jest.mock('firebase/database', () => ({
  onDisconnect: jest.fn(() => ({
    update: jest.fn(() => Promise.resolve()),
    cancel: jest.fn(() => Promise.resolve()),
  })),
  onValue: jest.fn(() => jest.fn()),
  ref: jest.fn((db, path) => ({ path })),
  runTransaction: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => ({ '.sv': 'timestamp' })),
  update: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../src/config/firebase', () => ({
  database: {},
}));

// Import after mocking
import {
  isPlayerConnected,
  isValidPlayer,
  migrateHostIfNeeded,
  removeGhostPlayers,
} from '../../../src/utils/presence';

describe('presence utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isPlayerConnected', () => {
    it('treats explicit connected: true as connected', () => {
      expect(isPlayerConnected({ id: 'a', name: 'A', connected: true })).toBe(true);
    });

    it('treats explicit connected: false as disconnected', () => {
      expect(isPlayerConnected({ id: 'a', name: 'A', connected: false })).toBe(false);
    });

    it('treats a missing connected flag (old clients) as connected', () => {
      expect(isPlayerConnected({ id: 'a', name: 'A' })).toBe(true);
    });

    it('treats null/undefined players as connected (no flag)', () => {
      expect(isPlayerConnected(undefined)).toBe(true);
      expect(isPlayerConnected(null)).toBe(true);
    });
  });

  describe('isValidPlayer', () => {
    it('accepts players with id and name', () => {
      expect(isValidPlayer({ id: 'a', name: 'Alice' })).toBe(true);
    });

    it('rejects ghost nodes missing id or name', () => {
      expect(isValidPlayer({ connected: false, lastSeen: 123 })).toBe(false);
      expect(isValidPlayer({ id: 'a' })).toBe(false);
      expect(isValidPlayer({ name: 'Alice' })).toBe(false);
      expect(isValidPlayer(null)).toBe(false);
      expect(isValidPlayer(undefined)).toBe(false);
    });
  });

  describe('removeGhostPlayers', () => {
    it('removes partial player nodes and keeps valid ones', () => {
      const room = {
        players: {
          a: { id: 'a', name: 'Alice', totalScore: 5 },
          ghost: { connected: false, lastSeen: 123 },
          b: { id: 'b', name: 'Bob' },
        },
      };

      removeGhostPlayers(room);

      expect(Object.keys(room.players)).toEqual(['a', 'b']);
    });

    it('handles rooms without players', () => {
      expect(removeGhostPlayers(null)).toBeNull();
      expect(removeGhostPlayers({})).toEqual({});
    });
  });

  describe('migrateHostIfNeeded', () => {
    // Helper to capture the transaction update function and run it
    const runMigration = async (room) => {
      let updateFn;
      runTransaction.mockImplementation((roomRef, fn) => {
        updateFn = fn;
        return Promise.resolve();
      });
      await migrateHostIfNeeded('ABC123');
      return updateFn(room);
    };

    it('aborts when the host is still connected', async () => {
      const result = await runMigration({
        hostId: 'a',
        players: {
          a: { id: 'a', name: 'Alice', connected: true },
          b: { id: 'b', name: 'Bob', connected: true },
        },
      });
      expect(result).toBeUndefined();
    });

    it('promotes the earliest-joined connected player when host is offline', async () => {
      const room = {
        hostId: 'a',
        players: {
          a: { id: 'a', name: 'Alice', connected: false, joinedAt: 1 },
          b: { id: 'b', name: 'Bob', connected: true, joinedAt: 3 },
          c: { id: 'c', name: 'Cara', connected: true, joinedAt: 2 },
        },
      };

      const result = await runMigration(room);

      expect(result.hostId).toBe('c');
      expect(result.lastActivity).toBeDefined();
    });

    it('promotes someone when the host node is missing entirely', async () => {
      const room = {
        hostId: 'gone',
        players: {
          b: { id: 'b', name: 'Bob', connected: true, joinedAt: 2 },
        },
      };

      const result = await runMigration(room);

      expect(result.hostId).toBe('b');
    });

    it('aborts when nobody is connected', async () => {
      const result = await runMigration({
        hostId: 'a',
        players: {
          a: { id: 'a', name: 'Alice', connected: false },
          b: { id: 'b', name: 'Bob', connected: false },
        },
      });
      expect(result).toBeUndefined();
    });

    it('treats players without a connected flag (old clients) as promotable', async () => {
      const room = {
        hostId: 'a',
        players: {
          a: { id: 'a', name: 'Alice', connected: false },
          b: { id: 'b', name: 'Bob' }, // old client, no presence fields
        },
      };

      const result = await runMigration(room);

      expect(result.hostId).toBe('b');
    });
  });
});
