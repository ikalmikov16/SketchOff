import { onValue, ref, update } from 'firebase/database';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { LoadingOverlay, OfflineBanner } from '../components/NetworkStatus';
import { database } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import { getRandomTopic } from '../services/TopicService';
import { tapLight } from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import {
  clearPresence,
  isPlayerConnected,
  isValidPlayer,
  migrateHostIfNeeded,
  registerPresence,
} from '../utils/presence';
import { playRoundComplete } from '../utils/sounds';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export default function MultiplayerResultsScreen({ route, navigation }) {
  const { theme } = useTheme();
  const { roomCode, playerId, playerName } = route.params;
  const { isConnected } = useNetworkStatus();
  const [players, setPlayers] = useState([]);
  const [drawings, setDrawings] = useState({});
  const [ratings, setRatings] = useState({});
  const [currentRound, setCurrentRound] = useState(1);
  const [numRounds, setNumRounds] = useState(3);
  const [timeLimit, setTimeLimit] = useState(60);
  const [isHost, setIsHost] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [previousTopic, setPreviousTopic] = useState('');
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const soundPlayed = useRef(false);

  // Play round complete sound once when screen loads
  useEffect(() => {
    if (!soundPlayed.current) {
      soundPlayed.current = true;
      playRoundComplete();
    }
  }, []);

  // Track our presence so other clients stop waiting on us if we drop
  useEffect(() => {
    registerPresence(roomCode, playerId);
  }, [roomCode, playerId]);

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
        setCurrentRound(roomData.currentRound || 1);
        setNumRounds(roomData.settings.numRounds);
        setTimeLimit(roomData.settings.timeLimit || 60);
        setPreviousTopic(roomData.currentTopic || '');

        if (roomData.players) {
          const playersList = Object.values(roomData.players).filter(isValidPlayer);
          setPlayers(playersList);

          // Derive isHost from hostId
          setIsHost(roomData.hostId === playerId);

          // Only the host can advance to the next round - if they went
          // offline, promote a new host so the game doesn't soft-lock here.
          // Any client may trigger this; the transaction inside guarantees a
          // single promotion.
          const host = roomData.players[roomData.hostId];
          if (!host || !isPlayerConnected(host)) {
            migrateHostIfNeeded(roomCode);
          }
        }

        // Store drawings for current round and ratings for display
        const round = roomData.currentRound || 1;
        if (roomData.drawings?.[`round${round}`]) {
          setDrawings(roomData.drawings[`round${round}`]);
        }
        if (roomData.ratings) {
          setRatings(roomData.ratings);
        }

        // Check if moved to next round
        if (roomData.status === 'drawing' && roomData.currentRound > currentRound) {
          navigation.replace('MultiplayerDrawing', {
            roomCode,
            playerId,
            playerName,
          });
        }

        // Check if game finished
        if (roomData.status === 'finished') {
          navigation.replace('MultiplayerFinal', {
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

    // Use the unsubscribe function returned by onValue instead of off()
    return () => unsubscribe();
  }, [roomCode, playerId, currentRound, navigation, playerName]);

  const handleNextRound = async () => {
    if (isLoading || !isConnected) return;

    setIsLoading(true);

    if (currentRound < numRounds) {
      try {
        const nextRound = currentRound + 1;
        // Get a new topic that's different from the previous one
        let topic = getRandomTopic();
        let attempts = 0;
        while (topic === previousTopic && attempts < 10) {
          topic = getRandomTopic();
          attempts++;
        }

        await update(ref(database, `rooms/${roomCode}`), {
          status: 'drawing',
          currentRound: nextRound,
          currentTopic: topic,
          drawingStartTime: Date.now(),
          drawingEndTime: Date.now() + timeLimit * 1000,
          // Don't clear drawings - we keep them for gallery
          ratings: {}, // Clear previous round ratings
          lastActivity: Date.now(),
        });
        // Navigation happens via listener
      } catch (error) {
        console.error('Error starting next round:', error);
        Alert.alert('Error', 'Failed to start next round. Please check your connection.');
        setIsLoading(false);
      }
    } else {
      // Game finished
      try {
        await update(ref(database, `rooms/${roomCode}`), {
          status: 'finished',
          lastActivity: Date.now(),
        });
        // Navigation happens via listener
      } catch (error) {
        console.error('Error finishing game:', error);
        Alert.alert('Error', 'Failed to finish game. Please try again.');
        setIsLoading(false);
      }
    }
  };

  const sortedPlayers = [...players].sort((a, b) => {
    const aRoundScore = a.roundScore || 0;
    const bRoundScore = b.roundScore || 0;
    return bRoundScore - aRoundScore;
  });

  // Get ratings received by a specific player (invert the ratings structure)
  const getRatingsForPlayer = (targetPlayerId) => {
    const receivedRatings = [];
    Object.entries(ratings).forEach(([raterId, raterRatings]) => {
      if (raterRatings[targetPlayerId] !== undefined) {
        const rater = players.find((p) => p.id === raterId);
        if (rater) {
          receivedRatings.push({
            raterName: rater.name,
            raterId,
            score: raterRatings[targetPlayerId],
          });
        }
      }
    });
    return receivedRatings;
  };

  // Toggle expand/collapse for rating breakdown
  const toggleExpand = (playerId) => {
    tapLight();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedPlayer(expandedPlayer === playerId ? null : playerId);
  };

  return (
    <View style={[styles.wrapper, { backgroundColor: theme.background }]}>
      <OfflineBanner visible={!isConnected} />
      <LoadingOverlay
        visible={isLoading}
        message={
          currentRound < numRounds ? 'Starting next round...' : 'Calculating final results...'
        }
      />

      <ScrollView style={styles.container}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: theme.text }]}>🎉 Round {currentRound} Results</Text>
          {previousTopic !== '' && (
            <Text style={[styles.topicSubtitle, { color: theme.textSecondary }]}>
              Topic: “{previousTopic}”
            </Text>
          )}

          <View style={styles.podiumContainer}>
            {sortedPlayers.map((player, position) => {
              const playerDrawing = drawings[player.id];
              const playerRatings = getRatingsForPlayer(player.id);
              const isExpanded = expandedPlayer === player.id;

              return (
                <View
                  key={player.id}
                  style={[
                    styles.playerCard,
                    { backgroundColor: theme.cardBackground, borderColor: theme.border },
                    position === 0 && [styles.firstPlace, { borderColor: theme.accent }],
                  ]}
                >
                  {/* Top row: Position, Drawing, Info */}
                  <View style={styles.playerCardTop}>
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

                    {/* Drawing Thumbnail */}
                    {playerDrawing?.url ? (
                      <TouchableOpacity
                        style={styles.drawingThumbnail}
                        onPress={() => setSelectedImage(playerDrawing.url)}
                        activeOpacity={0.8}
                      >
                        <Image
                          source={{ uri: playerDrawing.url }}
                          style={styles.thumbnailImage}
                          resizeMode="cover"
                        />
                      </TouchableOpacity>
                    ) : (
                      <View style={[styles.noDrawing, { backgroundColor: theme.border }]}>
                        <Text style={styles.noDrawingText}>🎨</Text>
                      </View>
                    )}

                    <View style={styles.playerInfo}>
                      <Text style={[styles.playerNameText, { color: theme.text }]}>
                        {player.name} {player.id === playerId && '(You)'}
                      </Text>
                      <Text style={[styles.roundScoreText, { color: theme.success }]}>
                        {player.roundScore || 0} points this round
                      </Text>
                      <Text style={[styles.totalScoreText, { color: theme.textSecondary }]}>
                        Total: {player.totalScore || 0} points
                      </Text>
                    </View>

                    {/* Expand arrow on right side */}
                    {playerRatings.length > 0 && (
                      <TouchableOpacity
                        style={styles.expandArrow}
                        onPress={() => toggleExpand(player.id)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Show rating breakdown for ${player.name}`}
                      >
                        <Text style={[styles.expandArrowText, { color: theme.textSecondary }]}>
                          {isExpanded ? '▲' : '▼'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Rating breakdown (expanded) */}
                  {isExpanded && playerRatings.length > 0 && (
                    <View style={[styles.ratingBreakdown, { borderTopColor: theme.border }]}>
                      {playerRatings.map((rating) => (
                        <View key={rating.raterId} style={styles.ratingRow}>
                          <Text style={[styles.raterName, { color: theme.textSecondary }]}>
                            {rating.raterName}
                          </Text>
                          <View style={[styles.ratingBadge, { backgroundColor: theme.primary }]}>
                            <Text style={styles.ratingScore}>{rating.score}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {isHost && (
            <TouchableOpacity
              style={[
                styles.continueButton,
                { backgroundColor: theme.primary },
                (!isConnected || isLoading) && styles.buttonDisabled,
              ]}
              onPress={handleNextRound}
              disabled={!isConnected || isLoading}
            >
              <Text style={styles.continueButtonText}>
                {currentRound < numRounds
                  ? `Continue to Round ${currentRound + 1} →`
                  : 'View Final Results 🏆'}
              </Text>
            </TouchableOpacity>
          )}

          {!isHost && (
            <View
              style={[
                styles.waitingCard,
                { backgroundColor: theme.cardBackground, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.waitingText, { color: theme.textSecondary }]}>
                Waiting for host to continue...
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Fullscreen Image Modal */}
      <Modal visible={!!selectedImage} transparent animationType="fade">
        <TouchableOpacity
          style={styles.imageModalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedImage(null)}
        >
          <View style={styles.imageModalContent}>
            {selectedImage && (
              <Image
                source={{ uri: selectedImage }}
                style={styles.fullscreenImage}
                resizeMode="contain"
              />
            )}
            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setSelectedImage(null)}
              accessibilityRole="button"
              accessibilityLabel="Close image"
            >
              <Text style={styles.closeModalText}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  topicSubtitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 22,
  },
  podiumContainer: {
    gap: 15,
    marginBottom: 30,
  },
  playerCard: {
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    overflow: 'hidden',
  },
  playerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  firstPlace: {
    borderWidth: 3,
  },
  positionBadge: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  positionText: {
    fontSize: 24,
  },
  drawingThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 12,
    marginRight: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  noDrawing: {
    width: 60,
    height: 60,
    borderRadius: 12,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDrawingText: {
    fontSize: 24,
  },
  playerInfo: {
    flex: 1,
  },
  playerNameText: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 5,
  },
  roundScoreText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 3,
  },
  totalScoreText: {
    fontSize: 14,
    fontWeight: '500',
  },
  continueButton: {
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  continueButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  waitingCard: {
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 1,
  },
  waitingText: {
    fontSize: 16,
    fontStyle: 'italic',
    fontWeight: '500',
  },
  // Expand arrow on right side
  expandArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  expandArrowText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Rating breakdown
  ratingBreakdown: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  raterName: {
    fontSize: 15,
    fontWeight: '500',
  },
  ratingBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ratingScore: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  // Fullscreen image modal
  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageModalContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullscreenImage: {
    width: '90%',
    height: '70%',
  },
  closeModalButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeModalText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
});
