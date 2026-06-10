import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getStats,
  saveStats,
  getGameHistory,
  saveGameToHistory,
  recordGameComplete,
  getComputedStats,
  clearAllStats,
} from '../../../src/utils/storage';

describe('storage utils', () => {
  beforeEach(() => {
    // Reset mock storage before each test by clearing the internal state
    // This needs to happen synchronously before any tests run
    AsyncStorage.__setMockStorage({});
    jest.clearAllMocks();
  });

  describe('getStats', () => {
    it('should return default stats when storage is empty', async () => {
      const stats = await getStats();

      expect(stats).toEqual({
        gamesPlayed: 0,
        wins: 0,
        totalScore: 0,
        totalRounds: 0,
        bestScore: 0,
        bestScoreTopic: '',
      });
    });

    it('should return stored stats merged with defaults', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          gamesPlayed: 5,
          wins: 2,
        }),
      });

      const stats = await getStats();

      expect(stats).toEqual({
        gamesPlayed: 5,
        wins: 2,
        totalScore: 0,
        totalRounds: 0,
        bestScore: 0,
        bestScoreTopic: '',
      });
    });

    it('should return complete stored stats', async () => {
      const storedStats = {
        gamesPlayed: 10,
        wins: 4,
        totalScore: 250,
        totalRounds: 30,
        bestScore: 10,
        bestScoreTopic: 'A Cat Wearing a Hat',
      };

      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify(storedStats),
      });

      const stats = await getStats();

      expect(stats).toEqual(storedStats);
    });
  });

  describe('saveStats', () => {
    it('should save stats to storage', async () => {
      const stats = {
        gamesPlayed: 5,
        wins: 2,
        totalScore: 100,
        totalRounds: 15,
        bestScore: 10,
        bestScoreTopic: 'Dragon',
      };

      await saveStats(stats);

      expect(AsyncStorage.setItem).toHaveBeenCalledWith('@game_stats', JSON.stringify(stats));
    });
  });

  describe('getGameHistory', () => {
    it('should return empty array when no history exists', async () => {
      const history = await getGameHistory();

      expect(history).toEqual([]);
    });

    it('should return stored game history', async () => {
      const storedHistory = [
        { id: '1', playerName: 'Alice', position: 1, isWin: true },
        { id: '2', playerName: 'Bob', position: 2, isWin: false },
      ];

      AsyncStorage.__setMockStorage({
        '@game_history': JSON.stringify(storedHistory),
      });

      const history = await getGameHistory();

      expect(history).toEqual(storedHistory);
    });
  });

  describe('saveGameToHistory', () => {
    it('should add new game at the beginning of history', async () => {
      const existingHistory = [
        { id: '1', playerName: 'Alice' },
        { id: '2', playerName: 'Bob' },
      ];

      AsyncStorage.__setMockStorage({
        '@game_history': JSON.stringify(existingHistory),
      });

      const newGame = { playerName: 'Charlie', position: 1 };
      const result = await saveGameToHistory(newGame);

      // New game should be first
      expect(result[0].playerName).toBe('Charlie');
      expect(result[0].id).toBeDefined();
      expect(result[0].date).toBeDefined();
      expect(result.length).toBe(3);
    });

    it('should limit history to 10 games', async () => {
      // Create 10 existing games
      const existingHistory = Array.from({ length: 10 }, (_, i) => ({
        id: `game-${i}`,
        playerName: `Player ${i}`,
      }));

      AsyncStorage.__setMockStorage({
        '@game_history': JSON.stringify(existingHistory),
      });

      const newGame = { playerName: 'NewPlayer' };
      const result = await saveGameToHistory(newGame);

      expect(result.length).toBe(10);
      expect(result[0].playerName).toBe('NewPlayer');
      // Last old game should be removed
      expect(result.find((g) => g.playerName === 'Player 9')).toBeUndefined();
    });

    it('should add id and date to saved game', async () => {
      const newGame = { playerName: 'Alice', position: 1 };
      const result = await saveGameToHistory(newGame);

      expect(result[0].id).toBeDefined();
      expect(result[0].date).toBeDefined();
      expect(typeof result[0].id).toBe('string');
    });
  });

  describe('recordGameComplete', () => {
    it('should increment gamesPlayed', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({ gamesPlayed: 5, wins: 2 }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 2,
        totalPlayers: 3,
        totalScore: 25,
        rounds: 3,
        isMultiplayer: true,
      });

      const stats = await getStats();
      expect(stats.gamesPlayed).toBe(6);
    });

    it('should increment wins when position is 1', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({ gamesPlayed: 5, wins: 2 }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 1, // Winner!
        totalPlayers: 3,
        totalScore: 30,
        rounds: 3,
        isMultiplayer: true,
      });

      const stats = await getStats();
      expect(stats.wins).toBe(3);
    });

    it('should NOT increment wins when position is not 1', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({ gamesPlayed: 5, wins: 2 }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 2, // Not winner
        totalPlayers: 3,
        totalScore: 25,
        rounds: 3,
        isMultiplayer: true,
      });

      const stats = await getStats();
      expect(stats.wins).toBe(2); // Unchanged
    });

    it('should accumulate totalScore', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({ totalScore: 100 }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 1,
        totalPlayers: 2,
        totalScore: 50,
        rounds: 3,
        isMultiplayer: true,
      });

      const stats = await getStats();
      expect(stats.totalScore).toBe(150);
    });

    it('should accumulate totalRounds', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({ totalRounds: 10 }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 1,
        totalPlayers: 2,
        totalScore: 50,
        rounds: 5,
        isMultiplayer: true,
      });

      const stats = await getStats();
      expect(stats.totalRounds).toBe(15);
    });

    it('should update bestScore when new score is higher', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          bestScore: 8,
          bestScoreTopic: 'Old Topic',
        }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 1,
        totalPlayers: 2,
        totalScore: 50,
        rounds: 3,
        isMultiplayer: true,
        bestRoundScore: 10,
        bestRoundTopic: 'New Topic',
      });

      const stats = await getStats();
      expect(stats.bestScore).toBe(10);
      expect(stats.bestScoreTopic).toBe('New Topic');
    });

    it('should NOT update bestScore when new score is lower', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          bestScore: 10,
          bestScoreTopic: 'Best Topic',
        }),
      });

      await recordGameComplete({
        playerName: 'Alice',
        position: 1,
        totalPlayers: 2,
        totalScore: 50,
        rounds: 3,
        isMultiplayer: true,
        bestRoundScore: 7,
        bestRoundTopic: 'Worse Topic',
      });

      const stats = await getStats();
      expect(stats.bestScore).toBe(10);
      expect(stats.bestScoreTopic).toBe('Best Topic');
    });

    it('should add game to history with isWin flag', async () => {
      await recordGameComplete({
        playerName: 'Alice',
        position: 1,
        totalPlayers: 3,
        totalScore: 30,
        rounds: 3,
        isMultiplayer: true,
      });

      const history = await getGameHistory();
      expect(history[0].isWin).toBe(true);
      expect(history[0].playerName).toBe('Alice');
    });

    it('should return updated stats', async () => {
      // Get initial stats
      const initialStats = await getStats();
      const initialGamesPlayed = initialStats.gamesPlayed;
      const initialWins = initialStats.wins;
      const initialTotalScore = initialStats.totalScore;

      const result = await recordGameComplete({
        playerName: 'Alice',
        position: 1,
        totalPlayers: 2,
        totalScore: 25,
        rounds: 3,
        isMultiplayer: true,
      });

      // Verify stats increased correctly from initial values
      expect(result.gamesPlayed).toBe(initialGamesPlayed + 1);
      expect(result.wins).toBe(initialWins + 1);
      expect(result.totalScore).toBe(initialTotalScore + 25);
    });
  });

  describe('getComputedStats', () => {
    it('should calculate averageScore correctly', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          totalScore: 100,
          totalRounds: 10,
        }),
      });

      const computed = await getComputedStats();

      expect(computed.averageScore).toBe(10);
    });

    it('should return 0 for averageScore when no rounds played', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          totalScore: 0,
          totalRounds: 0,
        }),
      });

      const computed = await getComputedStats();

      expect(computed.averageScore).toBe(0);
    });

    it('should calculate winRate correctly', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          gamesPlayed: 10,
          wins: 4,
        }),
      });

      const computed = await getComputedStats();

      expect(computed.winRate).toBe(40);
    });

    it('should return 0 for winRate when no games played', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          gamesPlayed: 0,
          wins: 0,
        }),
      });

      const computed = await getComputedStats();

      expect(computed.winRate).toBe(0);
    });

    it('should round averageScore to integer', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({
          totalScore: 33,
          totalRounds: 10,
        }),
      });

      const computed = await getComputedStats();

      expect(computed.averageScore).toBe(3); // 3.3 rounded
    });

    it('should include recentGames from history', async () => {
      const history = [
        { id: '1', playerName: 'Alice' },
        { id: '2', playerName: 'Bob' },
      ];

      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({}),
        '@game_history': JSON.stringify(history),
      });

      const computed = await getComputedStats();

      expect(computed.recentGames).toEqual(history);
    });
  });

  describe('clearAllStats', () => {
    it('should remove all stats and history from storage', async () => {
      AsyncStorage.__setMockStorage({
        '@game_stats': JSON.stringify({ gamesPlayed: 10 }),
        '@game_history': JSON.stringify([{ id: '1' }]),
      });

      await clearAllStats();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['@game_stats', '@game_history']);
    });
  });
});
