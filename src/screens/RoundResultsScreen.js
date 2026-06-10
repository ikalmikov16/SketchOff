import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useGame } from '../context/GameContext';
import { useTheme } from '../context/ThemeContext';

export default function RoundResultsScreen({ navigation }) {
  const { theme } = useTheme();
  const { players, currentRound, numRounds, nextRound, roundScores, setCurrentTopic } = useGame();

  const handleNextRound = () => {
    if (currentRound < numRounds) {
      nextRound();
      // Clear the topic so TopicScreen generates a fresh one for the new round
      setCurrentTopic('');
      navigation.navigate('Topic');
    } else {
      navigation.navigate('FinalResults');
    }
  };

  // Get current round scores
  const currentRoundScores = roundScores[currentRound - 1] || [];

  // Sort players by current round score
  const sortedPlayers = [...players]
    .map((player, index) => ({
      ...player,
      index,
      roundScore: currentRoundScores.find((s) => s.playerIndex === index)?.score || 0,
    }))
    .sort((a, b) => b.roundScore - a.roundScore);

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.headerContainer}>
          <Text style={styles.celebrationEmoji}>🎉</Text>
          <Text style={[styles.title, { color: theme.text }]}>Round {currentRound} Complete!</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Here&apos;s how everyone did
          </Text>
        </View>

        <View style={styles.podiumContainer}>
          {sortedPlayers.map((player, position) => (
            <View
              key={player.index}
              style={[
                styles.playerCard,
                { backgroundColor: theme.cardBackground, borderColor: theme.border },
                position === 0 && [styles.firstPlace, { borderColor: theme.accent }],
              ]}
            >
              <View style={[styles.positionBadge, { backgroundColor: theme.primary }]}>
                <Text style={styles.positionText}>
                  {position === 0
                    ? '🥇'
                    : position === 1
                      ? '🥈'
                      : position === 2
                        ? '🥉'
                        : `#${position + 1}`}
                </Text>
              </View>

              <View style={styles.playerInfo}>
                <Text style={[styles.playerNameText, { color: theme.text }]}>{player.name}</Text>
                <Text style={[styles.roundScoreText, { color: theme.success }]}>
                  {player.roundScore} points this round
                </Text>
                <Text style={[styles.totalScoreText, { color: theme.textSecondary }]}>
                  Total: {player.totalScore} points
                </Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.continueButton, { backgroundColor: theme.primary }]}
          onPress={handleNextRound}
        >
          <Text style={styles.continueButtonText}>
            {currentRound < numRounds
              ? `Continue to Round ${currentRound + 1} →`
              : 'View Final Results 🏆'}
          </Text>
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
  headerContainer: {
    alignItems: 'center',
    marginBottom: 32,
    paddingTop: 10,
  },
  celebrationEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  podiumContainer: {
    gap: 16,
    marginBottom: 32,
  },
  playerCard: {
    borderRadius: 20,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 2,
  },
  firstPlace: {
    borderWidth: 3,
    shadowOpacity: 0.25,
    elevation: 10,
  },
  positionBadge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  positionText: {
    fontSize: 32,
  },
  playerInfo: {
    flex: 1,
  },
  playerNameText: {
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  roundScoreText: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  totalScoreText: {
    fontSize: 16,
    fontWeight: '600',
  },
  continueButton: {
    padding: 22,
    borderRadius: 20,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
