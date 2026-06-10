import AsyncStorage from '@react-native-async-storage/async-storage';

const STATS_KEY = '@game_stats';
const HISTORY_KEY = '@game_history';
const CONSENT_KEY = '@user_consent';
const HOWTO_KEY = '@howto_seen';

// First-launch onboarding
export async function hasSeenHowToPlay() {
  try {
    const seen = await AsyncStorage.getItem(HOWTO_KEY);
    return seen === 'true';
  } catch (_error) {
    return true; // Don't nag if storage is unavailable
  }
}

export async function markHowToPlaySeen() {
  try {
    await AsyncStorage.setItem(HOWTO_KEY, 'true');
  } catch (error) {
    console.warn('Failed to save onboarding state:', error);
  }
}

// Privacy consent management
export async function hasUserConsent() {
  try {
    const consent = await AsyncStorage.getItem(CONSENT_KEY);
    return consent === 'true';
  } catch (error) {
    console.warn('Failed to check consent:', error);
    return false;
  }
}

export async function setUserConsent(accepted) {
  try {
    await AsyncStorage.setItem(CONSENT_KEY, accepted ? 'true' : 'false');
    return true;
  } catch (error) {
    console.warn('Failed to save consent:', error);
    return false;
  }
}

export async function getConsentTimestamp() {
  try {
    const timestamp = await AsyncStorage.getItem(`${CONSENT_KEY}_timestamp`);
    return timestamp ? parseInt(timestamp, 10) : null;
  } catch (_error) {
    return null;
  }
}

export async function saveConsentWithTimestamp(accepted) {
  try {
    await AsyncStorage.setItem(CONSENT_KEY, accepted ? 'true' : 'false');
    await AsyncStorage.setItem(`${CONSENT_KEY}_timestamp`, Date.now().toString());
    return true;
  } catch (error) {
    console.warn('Failed to save consent:', error);
    return false;
  }
}

// Default stats structure
const defaultStats = {
  gamesPlayed: 0,
  wins: 0,
  totalScore: 0,
  totalRounds: 0,
  bestScore: 0,
  bestScoreTopic: '',
};

// Get current stats
export async function getStats() {
  try {
    const statsJson = await AsyncStorage.getItem(STATS_KEY);
    if (statsJson) {
      return { ...defaultStats, ...JSON.parse(statsJson) };
    }
    return defaultStats;
  } catch (error) {
    console.warn('Failed to load stats:', error);
    return defaultStats;
  }
}

// Save stats
export async function saveStats(stats) {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (error) {
    console.warn('Failed to save stats:', error);
  }
}

// Get game history (last 10 games)
export async function getGameHistory() {
  try {
    const historyJson = await AsyncStorage.getItem(HISTORY_KEY);
    if (historyJson) {
      return JSON.parse(historyJson);
    }
    return [];
  } catch (error) {
    console.warn('Failed to load game history:', error);
    return [];
  }
}

// Save a game to history
export async function saveGameToHistory(game) {
  try {
    const history = await getGameHistory();

    // Add new game at the beginning
    const updatedHistory = [
      {
        ...game,
        id: Date.now().toString(),
        date: new Date().toISOString(),
      },
      ...history,
    ].slice(0, 10); // Keep only last 10 games

    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
    return updatedHistory;
  } catch (error) {
    console.warn('Failed to save game to history:', error);
    return [];
  }
}

// Record a completed game and update stats
export async function recordGameComplete({
  playerName,
  position, // 1 = first place, 2 = second, etc.
  totalPlayers,
  totalScore,
  rounds,
  isMultiplayer,
  bestRoundScore = 0,
  bestRoundTopic = '',
}) {
  try {
    // Update stats
    const stats = await getStats();

    stats.gamesPlayed += 1;
    if (position === 1) {
      stats.wins += 1;
    }
    stats.totalScore += totalScore;
    stats.totalRounds += rounds;

    if (bestRoundScore > stats.bestScore) {
      stats.bestScore = bestRoundScore;
      stats.bestScoreTopic = bestRoundTopic;
    }

    await saveStats(stats);

    // Add to history
    await saveGameToHistory({
      playerName,
      position,
      totalPlayers,
      totalScore,
      rounds,
      isMultiplayer,
      isWin: position === 1,
    });

    return stats;
  } catch (error) {
    console.warn('Failed to record game:', error);
    return null;
  }
}

// Get computed statistics
export async function getComputedStats() {
  const stats = await getStats();
  const history = await getGameHistory();

  const averageScore = stats.totalRounds > 0 ? Math.round(stats.totalScore / stats.totalRounds) : 0;

  const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;

  return {
    ...stats,
    averageScore,
    winRate,
    recentGames: history,
  };
}

// Clear all stats (for testing/reset)
export async function clearAllStats() {
  try {
    await AsyncStorage.multiRemove([STATS_KEY, HISTORY_KEY]);
  } catch (error) {
    console.warn('Failed to clear stats:', error);
  }
}
