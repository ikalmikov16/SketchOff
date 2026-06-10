import { onValue, ref, runTransaction, update } from 'firebase/database';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import RatingCard from '../components/RatingCard';
import { LoadingOverlay, OfflineBanner } from '../components/NetworkStatus';
import { database } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import { error as hapticError, success, tapMedium } from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import {
  clearPresence,
  isPlayerConnected,
  isValidPlayer,
  registerPresence,
  removeGhostPlayers,
} from '../utils/presence';

export default function MultiplayerRatingScreen({ route, navigation }) {
  const { roomCode, playerId, playerName } = route.params;
  const { theme } = useTheme();
  const { isConnected } = useNetworkStatus();
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [players, setPlayers] = useState([]);
  const [drawings, setDrawings] = useState({});
  const [ratings, setRatings] = useState({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);
  const [submittedPlayerIds, setSubmittedPlayerIds] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);

  const flatListRef = useRef(null);
  const [isSliderActive, setIsSliderActive] = useState(false);

  // Hide the navigation header
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Track our presence so other clients stop waiting on us if we drop
  useEffect(() => {
    registerPresence(roomCode, playerId);
  }, [roomCode, playerId]);

  // Get current player (self)
  const currentPlayer = players.find((p) => p.id === playerId);

  // Get players to rate: everyone else who actually submitted a drawing this
  // round (a player who dropped before submitting has nothing to rate)
  const playersToRate = players.filter((p) => p.id !== playerId && drawings[p.id]?.url);

  // All drawings to show: own drawing first, then others to rate
  const allDrawings = currentPlayer
    ? [{ ...currentPlayer, isOwnDrawing: true }, ...playersToRate]
    : playersToRate;

  // Finalize the round once everyone who can rate has rated. Runs inside a
  // transaction because every client performs this check - without it, two
  // players submitting at the same time could both add round scores to
  // totalScore. Players who disconnected, and players with nothing to rate,
  // are not waited on.
  const checkAllRatingsSubmitted = useCallback(async () => {
    try {
      const roomRef = ref(database, `rooms/${roomCode}`);
      await runTransaction(roomRef, (roomData) => {
        // Local cache miss - return as-is so Firebase refetches and reruns
        if (!roomData) return roomData;

        // Another client already finalized this round - abort
        if (roomData.status !== 'rating') return undefined;

        // Repair partial player nodes - they'd fail rule validation and
        // block this transaction's write
        removeGhostPlayers(roomData);

        const playersMap = roomData.players || {};
        const playerIds = Object.keys(playersMap);
        const allRatings = roomData.ratings || {};
        const round = roomData.currentRound || 1;
        const roundDrawings = roomData.drawings?.[`round${round}`] || {};

        // A player still owes ratings only if they're connected and there is
        // at least one other player's drawing for them to rate
        const pendingRaters = playerIds.filter((pId) => {
          if (allRatings[pId]) return false;
          if (!isPlayerConnected(playersMap[pId])) return false;
          return Object.keys(roundDrawings).some((id) => id !== pId);
        });
        if (pendingRaters.length > 0) return undefined;

        playerIds.forEach((pId) => {
          let roundScore = 0;
          Object.values(allRatings).forEach((raterRatings) => {
            const score = raterRatings?.[pId];
            if (typeof score === 'number') {
              roundScore += score;
            }
          });
          roomData.players[pId].roundScore = roundScore;
          roomData.players[pId].totalScore = (roomData.players[pId].totalScore || 0) + roundScore;
        });

        roomData.status = 'results';
        roomData.lastActivity = Date.now();
        return roomData;
      });
    } catch (error) {
      console.error('Error finalizing ratings:', error);
    }
  }, [roomCode]);

  useEffect(() => {
    const roomRef = ref(database, `rooms/${roomCode}`);

    const unsubscribe = onValue(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          clearPresence();
          Alert.alert('Room Closed', 'The room has been closed.');
          navigation.replace('Welcome');
          return;
        }

        const roomData = snapshot.val();

        let playersList = [];
        if (roomData.players) {
          playersList = Object.values(roomData.players).filter(isValidPlayer);
          setPlayers(playersList);
          setTotalPlayers(playersList.length);
        }

        // Get current round
        const round = roomData.currentRound || 1;

        // Get drawings for current round
        const roundDrawings = roomData.drawings?.[`round${round}`] || {};
        if (Object.keys(roundDrawings).length > 0) {
          setDrawings(roundDrawings);
        }

        // Track who has submitted ratings
        const allRatings = roomData.ratings || {};
        const submittedIds = Object.keys(allRatings);
        setSubmittedPlayerIds(submittedIds);
        setSubmittedCount(submittedIds.length);

        if (roomData.status === 'rating') {
          // If nobody else submitted a drawing this round, we have nothing to
          // rate - go straight to the waiting state
          const othersWithDrawings = playersList.filter(
            (p) => p.id !== playerId && roundDrawings[p.id]
          );
          if (othersWithDrawings.length === 0) {
            setHasSubmitted(true);
          }

          // Re-check completion whenever the room changes (covers a pending
          // rater going offline). The transaction makes this idempotent.
          const pendingRaters = playersList.filter((p) => {
            if (allRatings[p.id]) return false;
            if (!isPlayerConnected(p)) return false;
            return Object.keys(roundDrawings).some((id) => id !== p.id);
          });
          if (pendingRaters.length === 0) {
            checkAllRatingsSubmitted();
          }
        }

        // Check if moved to results
        if (roomData.status === 'results') {
          navigation.replace('MultiplayerResults', {
            roomCode,
            playerId,
            playerName,
          });
        }
      },
      (error) => {
        console.error('Firebase error:', error);
        Alert.alert('Connection Error', 'Lost connection to the game.');
      }
    );

    return () => unsubscribe();
  }, [roomCode, playerId, navigation, playerName, checkAllRatingsSubmitted]);

  const handleRating = (targetPlayerId, score) => {
    if (targetPlayerId === playerId) return;
    setRatings((prev) => ({
      ...prev,
      [targetPlayerId]: score,
    }));
  };

  const handleSubmitRatings = async () => {
    if (isSubmitting || hasSubmitted) return;

    if (!isConnected) {
      Alert.alert('Offline', 'Please check your internet connection and try again.');
      return;
    }

    // Check if all players have been rated
    const ratedPlayers = Object.keys(ratings);
    if (ratedPlayers.length < playersToRate.length) {
      // Find unrated players
      const unratedPlayers = playersToRate.filter((p) => ratings[p.id] === undefined);
      const unratedNames = unratedPlayers.map((p) => p.name).join(', ');
      Alert.alert(
        'Incomplete Ratings',
        `Please rate all drawings before submitting.\n\nMissing: ${unratedNames}`
      );
      return;
    }

    setIsSubmitting(true);

    try {
      await update(ref(database, `rooms/${roomCode}/ratings/${playerId}`), ratings);
      setHasSubmitted(true);
      setIsSubmitting(false);
      success();
      await checkAllRatingsSubmitted();
    } catch (error) {
      console.error('Error submitting ratings:', error);
      setIsSubmitting(false);
      hapticError();
      Alert.alert('Error', 'Failed to submit ratings. Please check your connection and try again.');
    }
  };

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index);
    }
  }, []);

  const viewabilityConfig = {
    itemVisiblePercentThreshold: 50,
  };

  const renderRatingCard = ({ item: player }) => {
    const drawingUrl = drawings[player.id]?.url;

    return (
      <RatingCard
        player={player}
        drawingUrl={drawingUrl}
        currentRating={ratings[player.id]}
        onRatingChange={(score) => handleRating(player.id, score)}
        disabled={hasSubmitted}
        isOwnDrawing={player.isOwnDrawing || false}
        onSliderActiveChange={setIsSliderActive}
      />
    );
  };

  const allRated = Object.keys(ratings).length === playersToRate.length;

  // Waiting screen after submission
  if (hasSubmitted) {
    return (
      <View style={[styles.wrapper, { backgroundColor: theme.background, paddingTop: insets.top }]}>
        <OfflineBanner visible={!isConnected} />

        <View style={styles.waitingContainer}>
          <View style={[styles.waitingCard, { backgroundColor: theme.cardBackground }]}>
            <Text style={styles.waitingEmoji}>✅</Text>
            <Text style={[styles.waitingTitle, { color: theme.success }]}>Ratings Submitted!</Text>
            <Text style={[styles.waitingSubtext, { color: theme.textSecondary }]}>
              Waiting for others... ({submittedCount}/{totalPlayers})
            </Text>

            <View style={styles.playerStatusContainer}>
              {players.map((player) => {
                const hasPlayerSubmitted = submittedPlayerIds.includes(player.id);
                const isOnline = isPlayerConnected(player);
                return (
                  <View
                    key={player.id}
                    style={[
                      styles.playerStatusItem,
                      {
                        backgroundColor: hasPlayerSubmitted
                          ? theme.success + '20'
                          : theme.border + '40',
                      },
                    ]}
                  >
                    <Text style={styles.playerStatusIcon}>
                      {hasPlayerSubmitted ? '✅' : isOnline ? '⏳' : '📵'}
                    </Text>
                    <Text
                      style={[
                        styles.playerStatusName,
                        { color: hasPlayerSubmitted ? theme.success : theme.textSecondary },
                      ]}
                    >
                      {player.name}
                      {player.id === playerId && ' (you)'}
                      {!hasPlayerSubmitted && !isOnline && ' · offline'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <GestureHandlerRootView
      style={[styles.wrapper, { backgroundColor: theme.background, paddingTop: insets.top }]}
    >
      <OfflineBanner visible={!isConnected} />
      <LoadingOverlay visible={isSubmitting} message="Submitting ratings..." />

      {/* Progress dots */}
      <View style={styles.header}>
        <View style={styles.progressContainer}>
          {allDrawings.map((drawing, index) => {
            const isOwn = drawing.isOwnDrawing;
            const isRated = !isOwn && ratings[drawing.id] !== undefined;
            const isCurrent = index === currentIndex;

            return (
              <View
                key={index}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: isOwn ? theme.accent : isRated ? theme.success : theme.border,
                    borderWidth: isCurrent ? 3 : 0,
                    borderColor: theme.primary,
                  },
                ]}
              />
            );
          })}
        </View>
        <Text style={[styles.progressLabel, { color: theme.textSecondary }]}>
          {allRated
            ? 'All drawings rated!'
            : `Rated ${Object.keys(ratings).length} of ${playersToRate.length} — swipe to see more`}
        </Text>
      </View>

      {/* Horizontal swipe list */}
      <FlatList
        ref={flatListRef}
        data={allDrawings}
        renderItem={renderRatingCard}
        keyExtractor={(item) => `${item.id}-${item.isOwnDrawing ? 'own' : 'rate'}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: screenWidth,
          offset: screenWidth * index,
          index,
        })}
        style={styles.flatList}
        scrollEnabled={!isSliderActive}
      />

      {/* Submit button - only show when there is something rated */}
      {allRated && playersToRate.length > 0 && (
        <View style={[styles.submitContainer, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: theme.success },
              (!isConnected || isSubmitting) && styles.buttonDisabled,
            ]}
            onPress={() => {
              tapMedium();
              handleSubmitRatings();
            }}
            disabled={!isConnected || isSubmitting}
          >
            <Text style={styles.submitButtonText}>Submit All Ratings ✓</Text>
          </TouchableOpacity>
        </View>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  progressContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  flatList: {
    flex: 1,
  },
  submitContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  submitButton: {
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Waiting screen
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  waitingCard: {
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  waitingEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  waitingTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  waitingSubtext: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 24,
  },
  playerStatusContainer: {
    width: '100%',
  },
  playerStatusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  playerStatusIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  playerStatusName: {
    fontSize: 15,
    fontWeight: '600',
  },
});
