import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { GameProvider, useGame } from '../../../src/context/GameContext';

// Helper to render the hook with the provider
const wrapper = ({ children }) => <GameProvider>{children}</GameProvider>;

describe('GameContext', () => {
  describe('initial state', () => {
    it('should have empty players array initially', () => {
      const { result } = renderHook(() => useGame(), { wrapper });
      expect(result.current.players).toEqual([]);
    });

    it('should have default game settings', () => {
      const { result } = renderHook(() => useGame(), { wrapper });
      expect(result.current.numRounds).toBe(3);
      expect(result.current.timeLimit).toBe(60);
      expect(result.current.currentRound).toBe(1);
      expect(result.current.currentTopic).toBe('');
    });
  });

  describe('addPlayer', () => {
    it('should add a player with name and zero score', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.addPlayer('Alice');
      });

      expect(result.current.players).toHaveLength(1);
      expect(result.current.players[0]).toEqual({
        name: 'Alice',
        totalScore: 0,
      });
    });

    it('should add multiple players', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.addPlayer('Alice');
      });
      act(() => {
        result.current.addPlayer('Bob');
      });
      act(() => {
        result.current.addPlayer('Charlie');
      });

      expect(result.current.players).toHaveLength(3);
      expect(result.current.players.map((p) => p.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('should initialize totalScore to 0 for each player', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.addPlayer('Alice');
        result.current.addPlayer('Bob');
      });

      result.current.players.forEach((player) => {
        expect(player.totalScore).toBe(0);
      });
    });
  });

  describe('removePlayer', () => {
    it('should remove player at specified index', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));
      act(() => result.current.addPlayer('Charlie'));

      act(() => {
        result.current.removePlayer(1); // Remove Bob
      });

      expect(result.current.players).toHaveLength(2);
      expect(result.current.players.map((p) => p.name)).toEqual(['Alice', 'Charlie']);
    });

    it('should remove first player correctly', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));

      act(() => {
        result.current.removePlayer(0);
      });

      expect(result.current.players).toHaveLength(1);
      expect(result.current.players[0].name).toBe('Bob');
    });

    it('should remove last player correctly', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));

      act(() => {
        result.current.removePlayer(1);
      });

      expect(result.current.players).toHaveLength(1);
      expect(result.current.players[0].name).toBe('Alice');
    });

    it('should handle removing only player', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.addPlayer('Alice');
      });

      act(() => {
        result.current.removePlayer(0);
      });

      expect(result.current.players).toHaveLength(0);
    });
  });

  describe('submitRoundScores', () => {
    it('should aggregate scores to players correctly', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));

      act(() => {
        result.current.submitRoundScores([
          { playerIndex: 0, score: 8 },
          { playerIndex: 1, score: 6 },
        ]);
      });

      expect(result.current.players[0].totalScore).toBe(8);
      expect(result.current.players[1].totalScore).toBe(6);
    });

    it('should accumulate scores across multiple rounds', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));

      // Round 1
      act(() => {
        result.current.submitRoundScores([
          { playerIndex: 0, score: 8 },
          { playerIndex: 1, score: 6 },
        ]);
      });

      // Round 2
      act(() => result.current.nextRound());
      act(() => {
        result.current.submitRoundScores([
          { playerIndex: 0, score: 5 },
          { playerIndex: 1, score: 9 },
        ]);
      });

      expect(result.current.players[0].totalScore).toBe(13); // 8 + 5
      expect(result.current.players[1].totalScore).toBe(15); // 6 + 9
    });

    it('should handle missing player scores gracefully', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));
      act(() => result.current.addPlayer('Charlie'));

      // Only submit scores for some players
      act(() => {
        result.current.submitRoundScores([
          { playerIndex: 0, score: 8 },
          // playerIndex 1 (Bob) is missing
          { playerIndex: 2, score: 7 },
        ]);
      });

      expect(result.current.players[0].totalScore).toBe(8);
      expect(result.current.players[1].totalScore).toBe(0); // Missing score defaults to 0
      expect(result.current.players[2].totalScore).toBe(7);
    });

    it('should store round scores in roundScores array', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));

      const scores = [
        { playerIndex: 0, score: 8 },
        { playerIndex: 1, score: 6 },
      ];

      act(() => {
        result.current.submitRoundScores(scores);
      });

      expect(result.current.roundScores[0]).toEqual(scores);
    });
  });

  describe('nextRound', () => {
    it('should increment currentRound by 1', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      expect(result.current.currentRound).toBe(1);

      act(() => {
        result.current.nextRound();
      });

      expect(result.current.currentRound).toBe(2);
    });

    it('should increment correctly across multiple rounds', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => result.current.nextRound());
      act(() => result.current.nextRound());
      act(() => result.current.nextRound());

      expect(result.current.currentRound).toBe(4);
    });
  });

  describe('resetGame', () => {
    it('should reset all state to initial values', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      // Modify state
      act(() => result.current.addPlayer('Alice'));
      act(() => result.current.addPlayer('Bob'));
      act(() => result.current.setNumRounds(5));
      act(() => result.current.setTimeLimit(120));
      act(() => result.current.setCurrentTopic('Test Topic'));
      act(() => result.current.nextRound());
      act(() => {
        result.current.submitRoundScores([
          { playerIndex: 0, score: 8 },
          { playerIndex: 1, score: 6 },
        ]);
      });

      // Verify state was modified
      expect(result.current.players.length).toBeGreaterThan(0);

      // Reset
      act(() => {
        result.current.resetGame();
      });

      // Verify reset
      expect(result.current.players).toEqual([]);
      expect(result.current.numRounds).toBe(3);
      expect(result.current.timeLimit).toBe(60);
      expect(result.current.currentRound).toBe(1);
      expect(result.current.currentTopic).toBe('');
      expect(result.current.roundScores).toEqual([]);
    });
  });

  describe('setters', () => {
    it('should update numRounds', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.setNumRounds(5);
      });

      expect(result.current.numRounds).toBe(5);
    });

    it('should update timeLimit', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.setTimeLimit(120);
      });

      expect(result.current.timeLimit).toBe(120);
    });

    it('should update currentTopic', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.setCurrentTopic('Draw a cat');
      });

      expect(result.current.currentTopic).toBe('Draw a cat');
    });
  });

  describe('useGame outside provider', () => {
    it('should throw error when used outside GameProvider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        renderHook(() => useGame());
      }).toThrow('useGame must be used within a GameProvider');

      consoleSpy.mockRestore();
    });
  });
});
