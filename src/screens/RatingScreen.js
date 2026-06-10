import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { useGame } from '../context/GameContext';
import { useTheme } from '../context/ThemeContext';

export default function RatingScreen({ navigation }) {
  const { players, submitRoundScores } = useGame();
  const { theme } = useTheme();
  const [ratings, setRatings] = useState({});

  // Initialize ratings for all players
  React.useEffect(() => {
    if (players.length === 0) return;

    const initialRatings = {};
    players.forEach((_, index) => {
      initialRatings[index] = {};
      players.forEach((_, raterIndex) => {
        if (index !== raterIndex) {
          initialRatings[index][raterIndex] = 0;
        }
      });
    });
    setRatings(initialRatings);
  }, [players]);

  const handleRating = (playerIndex, raterIndex, score) => {
    setRatings({
      ...ratings,
      [playerIndex]: {
        ...ratings[playerIndex],
        [raterIndex]: score,
      },
    });
  };

  const calculateTotalScore = (playerIndex) => {
    const playerRatings = ratings[playerIndex] || {};
    return Object.values(playerRatings).reduce((sum, rating) => sum + rating, 0);
  };

  const handleSubmitRatings = () => {
    // Check if all ratings are complete (including 0 as valid rating)
    let allRated = true;
    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      for (let raterIndex = 0; raterIndex < players.length; raterIndex++) {
        if (playerIndex !== raterIndex) {
          if (!ratings[playerIndex] || ratings[playerIndex][raterIndex] === undefined) {
            allRated = false;
            break;
          }
        }
      }
      if (!allRated) break;
    }

    if (!allRated) {
      Alert.alert('Incomplete Ratings', 'Please rate all drawings before continuing.', [
        { text: 'OK' },
      ]);
      return;
    }

    // Calculate scores for each player
    const scores = players.map((player, index) => ({
      playerIndex: index,
      score: calculateTotalScore(index),
    }));

    submitRoundScores(scores);
    navigation.navigate('RoundResults');
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <View style={styles.pageHeader}>
          <Text style={[styles.title, { color: theme.text }]}>Rate the Drawings</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Give each drawing a score from 0-10
          </Text>
        </View>

        {players.map((player, playerIndex) => (
          <View
            key={playerIndex}
            style={[
              styles.playerSection,
              { backgroundColor: theme.cardBackground, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.playerName, { color: theme.text }]}>
              {player.name}&apos;s Drawing
            </Text>

            <View style={styles.ratersContainer}>
              {players.map((rater, raterIndex) => {
                if (playerIndex === raterIndex) {
                  return null; // Players don't rate themselves
                }

                const currentRating = ratings[playerIndex]?.[raterIndex] || 0;

                return (
                  <View key={raterIndex} style={styles.raterRow}>
                    <View style={styles.raterHeader}>
                      <Text style={[styles.raterName, { color: theme.textSecondary }]}>
                        {rater.name} rates:
                      </Text>
                      <View style={[styles.ratingBadge, { backgroundColor: theme.primary }]}>
                        <Text style={styles.ratingValue}>{currentRating}</Text>
                      </View>
                    </View>
                    <Slider
                      style={styles.slider}
                      minimumValue={0}
                      maximumValue={10}
                      step={1}
                      value={currentRating}
                      onValueChange={(value) => handleRating(playerIndex, raterIndex, value)}
                      minimumTrackTintColor={theme.primary}
                      maximumTrackTintColor={theme.border}
                      thumbTintColor={theme.primary}
                    />
                    <View style={styles.sliderLabels}>
                      <Text style={[styles.sliderLabel, { color: theme.textSecondary }]}>0</Text>
                      <Text style={[styles.sliderLabel, { color: theme.textSecondary }]}>10</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={[styles.totalScoreContainer, { borderTopColor: theme.border }]}>
              <Text style={[styles.totalScoreText, { color: theme.primary }]}>
                Total: {calculateTotalScore(playerIndex)} points
              </Text>
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: theme.primary }]}
          onPress={handleSubmitRatings}
        >
          <Text style={styles.submitButtonText}>Submit Ratings →</Text>
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
  pageHeader: {
    marginBottom: 28,
    alignItems: 'center',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 17,
    textAlign: 'center',
    fontWeight: '600',
  },
  playerSection: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
    borderWidth: 1.5,
  },
  playerName: {
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 18,
    letterSpacing: 0.5,
  },
  ratersContainer: {
    gap: 18,
  },
  raterRow: {
    marginBottom: 20,
  },
  raterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  raterName: {
    fontSize: 17,
    fontWeight: '700',
  },
  ratingBadge: {
    minWidth: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 5,
  },
  ratingValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
  },
  slider: {
    width: '100%',
    height: 50,
    marginVertical: 8,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  totalScoreContainer: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 2,
    alignItems: 'center',
  },
  totalScoreText: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  submitButton: {
    padding: 22,
    borderRadius: 20,
    alignItems: 'center',
    marginTop: 20,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
