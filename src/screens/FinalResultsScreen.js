import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useGame } from '../context/GameContext';
import { useTheme } from '../context/ThemeContext';
import { tapMedium } from '../utils/haptics';
import { shareResultsAsText } from '../utils/sharing';
import { playCelebration } from '../utils/sounds';
import { recordGameComplete } from '../utils/storage';

export default function FinalResultsScreen({ navigation }) {
  const { players, numRounds, resetGame } = useGame();
  const { theme } = useTheme();
  const celebrationPlayed = useRef(false);
  const statsRecorded = useRef(false);

  // Play celebration sound once when screen loads
  useEffect(() => {
    if (!celebrationPlayed.current) {
      celebrationPlayed.current = true;
      playCelebration();
    }
  }, []);

  // Record the game in local stats once (attributed to the winning player,
  // since single-device games are pass-and-play on a shared phone)
  useEffect(() => {
    if (players && players.length > 0 && numRounds > 0 && !statsRecorded.current) {
      statsRecorded.current = true;

      const sorted = [...players].sort((a, b) => b.totalScore - a.totalScore);
      const winner = sorted[0];
      if (winner) {
        recordGameComplete({
          playerName: winner.name,
          position: 1,
          totalPlayers: players.length,
          totalScore: winner.totalScore || 0,
          rounds: numRounds,
          isMultiplayer: false,
        });
      }
    }
  }, [players, numRounds]);

  const handlePlayAgain = () => {
    // Navigate first, then reset to avoid rendering errors
    navigation.replace('Welcome');
    // Reset after a small delay to ensure navigation completes
    setTimeout(() => {
      resetGame();
    }, 100);
  };

  const handleShare = async () => {
    tapMedium();
    await shareResultsAsText(players, numRounds, false);
  };

  // Guard against empty players array
  if (!players || players.length === 0) {
    return null;
  }

  // Sort players by total score, preserving original index for unique keys
  const sortedPlayers = [...players]
    .map((player, originalIndex) => ({ ...player, originalIndex }))
    .sort((a, b) => b.totalScore - a.totalScore);

  // Find all winners (players tied for first place)
  const topScore = sortedPlayers[0]?.totalScore || 0;
  const winners = sortedPlayers.filter((p) => p.totalScore === topScore);
  const isTie = winners.length > 1;

  // Helper function to get display position (handles ties)
  const getDisplayPosition = (index) => {
    if (index === 0) return 0;
    const currentScore = sortedPlayers[index].totalScore;
    // Find the first player with this score
    const firstWithScore = sortedPlayers.findIndex((p) => p.totalScore === currentScore);
    return firstWithScore;
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: theme.text }]}>🏆 Final Results</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          After {numRounds} rounds
        </Text>

        {/* Winner Section */}
        {winners.length > 0 && (
          <View style={[styles.winnerContainer, isTie && styles.tieContainer]}>
            <Text style={styles.winnerEmoji}>{isTie ? '🤝' : '👑'}</Text>
            <Text style={styles.winnerLabel}>{isTie ? "It's a Tie!" : 'Champion'}</Text>
            {isTie ? (
              <View style={styles.tieWinnersContainer}>
                {winners.map((winner, idx) => (
                  <Text key={`winner-${winner.originalIndex}`} style={styles.winnerName}>
                    {winner.name}
                    {idx < winners.length - 1 ? ' &' : ''}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={styles.winnerName}>{winners[0].name}</Text>
            )}
            <Text style={styles.winnerScore}>{topScore} points</Text>
          </View>
        )}

        {/* All Players Leaderboard */}
        <View
          style={[
            styles.leaderboardContainer,
            { backgroundColor: theme.cardBackground, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.leaderboardTitle, { color: theme.text }]}>📊 Final Standings</Text>

          {sortedPlayers.map((player, index) => {
            const displayPosition = getDisplayPosition(index);
            return (
              <View
                key={`player-${player.originalIndex}`}
                style={[
                  styles.leaderboardRow,
                  { borderBottomColor: theme.border },
                  displayPosition === 0 && styles.leaderboardRowFirst,
                ]}
              >
                <View style={styles.positionContainer}>
                  <Text style={styles.positionText}>
                    {displayPosition === 0
                      ? '🥇'
                      : displayPosition === 1
                        ? '🥈'
                        : displayPosition === 2
                          ? '🥉'
                          : `${displayPosition + 1}`}
                  </Text>
                </View>

                <View style={styles.playerInfoContainer}>
                  <Text style={[styles.leaderboardName, { color: theme.text }]}>{player.name}</Text>
                  <Text style={[styles.averageScore, { color: theme.textSecondary }]}>
                    Avg: {numRounds > 0 ? (player.totalScore / numRounds).toFixed(1) : '0'} per
                    round
                  </Text>
                </View>

                <Text style={[styles.leaderboardScore, { color: theme.primary }]}>
                  {player.totalScore}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.shareButton,
              { backgroundColor: theme.cardBackground, borderColor: theme.border },
            ]}
            onPress={handleShare}
          >
            <Text style={[styles.shareButtonText, { color: theme.text }]}>📤 Share</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.playAgainButton} onPress={handlePlayAgain}>
            <Text style={styles.playAgainButtonText}>🎨 Play Again</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.homeButton,
            { backgroundColor: theme.cardBackground, borderColor: theme.border },
          ]}
          onPress={handlePlayAgain}
        >
          <Text style={[styles.homeButtonText, { color: theme.textSecondary }]}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
  },
  winnerContainer: {
    backgroundColor: '#fef3c7',
    borderRadius: 28,
    padding: 40,
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 3,
    borderColor: '#fbbf24',
    shadowColor: '#fbbf24',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  tieContainer: {
    backgroundColor: '#e0f2fe',
    borderColor: '#0ea5e9',
    shadowColor: '#0ea5e9',
  },
  tieWinnersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  winnerEmoji: {
    fontSize: 72,
    marginBottom: 16,
  },
  winnerLabel: {
    fontSize: 16,
    color: '#92400e',
    fontWeight: '900',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  winnerName: {
    fontSize: 42,
    fontWeight: '900',
    color: '#78350f',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  winnerScore: {
    fontSize: 32,
    color: '#92400e',
    fontWeight: '900',
    letterSpacing: 1,
  },
  leaderboardContainer: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1.5,
  },
  leaderboardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
  },
  leaderboardRowFirst: {
    backgroundColor: '#fef9e7',
    marginHorizontal: -20,
    paddingHorizontal: 20,
    borderRadius: 10,
    marginBottom: 10,
    borderBottomWidth: 0,
  },
  positionContainer: {
    width: 50,
    alignItems: 'center',
  },
  positionText: {
    fontSize: 24,
  },
  playerInfoContainer: {
    flex: 1,
  },
  leaderboardName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  averageScore: {
    fontSize: 14,
  },
  leaderboardScore: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 15,
  },
  shareButton: {
    flex: 1,
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    borderWidth: 2,
  },
  shareButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  playAgainButton: {
    flex: 1,
    backgroundColor: '#10b981',
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  playAgainButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  homeButton: {
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    borderWidth: 2,
  },
  homeButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
