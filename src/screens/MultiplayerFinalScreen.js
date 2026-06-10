import { get, onValue, ref, set, update } from 'firebase/database';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DrawingGallery from '../components/DrawingGallery';
import { database } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import { error as hapticError, success, tapMedium } from '../utils/haptics';
import { clearPresence, isValidPlayer } from '../utils/presence';
import { archiveGameAndCleanup } from '../utils/roomCleanup';
import { generateRoomCode } from '../utils/roomCode';
import { shareResultsAsText } from '../utils/sharing';
import { playCelebration } from '../utils/sounds';
import { recordGameComplete } from '../utils/storage';

export default function MultiplayerFinalScreen({ route, navigation }) {
  const { theme } = useTheme();
  const { roomCode, playerId, playerName } = route.params;
  const [players, setPlayers] = useState([]);
  const [drawings, setDrawings] = useState({});
  const [numRounds, setNumRounds] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [settings, setSettings] = useState(null);
  const [isCreatingNewRoom, setIsCreatingNewRoom] = useState(false);
  const [nextRoomCode, setNextRoomCode] = useState(null);
  const celebrationPlayed = useRef(false);
  const hasNavigatedToNewRoom = useRef(false);
  const statsRecorded = useRef(false);
  const cleanupDone = useRef(false);

  // Play celebration sound once when screen loads
  useEffect(() => {
    if (!celebrationPlayed.current) {
      celebrationPlayed.current = true;
      playCelebration();
    }
  }, []);

  // The game is over - stop presence tracking. This also cancels the pending
  // onDisconnect handler, which would otherwise write into the room after the
  // host deletes it (re-creating a ghost room).
  useEffect(() => {
    clearPresence();
  }, []);

  // Record game stats once when players are loaded
  useEffect(() => {
    if (players.length > 0 && numRounds > 0 && !statsRecorded.current) {
      statsRecorded.current = true;

      // Find current player's position
      const sorted = [...players].sort((a, b) => b.totalScore - a.totalScore);
      const currentPlayer = sorted.find((p) => p.id === playerId);
      const position = sorted.findIndex((p) => p.id === playerId) + 1;

      if (currentPlayer) {
        recordGameComplete({
          playerName: playerName,
          position: position,
          totalPlayers: players.length,
          totalScore: currentPlayer.totalScore || 0,
          rounds: numRounds,
          isMultiplayer: true,
        });
      }
    }
  }, [players, numRounds, playerId, playerName]);

  useEffect(() => {
    const roomRef = ref(database, `rooms/${roomCode}`);

    const unsubscribe = onValue(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        return;
      }

      const roomData = snapshot.val();
      setNumRounds(roomData.settings.numRounds);
      setSettings(roomData.settings);

      if (roomData.players) {
        const playersList = Object.values(roomData.players).filter(isValidPlayer);
        setPlayers(playersList);

        // Check if current user is host
        // Derive isHost from hostId
        setIsHost(roomData.hostId === playerId);
      }

      if (roomData.drawings) {
        setDrawings(roomData.drawings);
      }

      // Check for nextRoomCode - if another player created a new room
      if (roomData.nextRoomCode && !hasNavigatedToNewRoom.current) {
        setNextRoomCode(roomData.nextRoomCode);
      }
    });

    // Use the unsubscribe function returned by onValue instead of off()
    return () => unsubscribe();
  }, [roomCode, playerId]);

  // Cleanup function that can be called from multiple places
  const performCleanup = useCallback(async () => {
    if (isHost && !cleanupDone.current && players.length > 0) {
      cleanupDone.current = true;
      try {
        await archiveGameAndCleanup({
          roomCode,
          players,
          drawings,
          numRounds,
        });
      } catch (error) {
        console.error('Error cleaning up room:', error);
      }
    }
  }, [isHost, players, drawings, numRounds, roomCode]);

  // Ensure cleanup happens when navigating away (back button, gestures, etc.)
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      // Fire and forget - don't block navigation
      performCleanup();
    });

    return unsubscribe;
  }, [navigation, performCleanup]);

  const handlePlayAgain = async () => {
    if (isCreatingNewRoom) return;

    setIsCreatingNewRoom(true);
    tapMedium();

    try {
      // First check if another player already created a new room
      const currentRoomRef = ref(database, `rooms/${roomCode}`);
      const currentRoomSnapshot = await get(currentRoomRef);

      if (currentRoomSnapshot.exists()) {
        const currentRoomData = currentRoomSnapshot.val();

        // If nextRoomCode exists, join that room instead
        if (currentRoomData.nextRoomCode) {
          await joinExistingNewRoom(currentRoomData.nextRoomCode);
          return;
        }
      }

      // Create new room - this player becomes host
      let newRoomCode = generateRoomCode();
      let roomCreated = false;
      let attempts = 0;

      while (!roomCreated && attempts < 5) {
        const newRoomRef = ref(database, `rooms/${newRoomCode}`);
        const snapshot = await get(newRoomRef);

        if (snapshot.exists()) {
          newRoomCode = generateRoomCode();
          attempts++;
          continue;
        }

        // Create the new room with same settings
        await set(newRoomRef, {
          code: newRoomCode,
          hostId: playerId,
          settings: settings || { numRounds: 3, timeLimit: 60 },
          status: 'lobby',
          currentRound: 1,
          currentTopic: '',
          players: {
            [playerId]: {
              id: playerId,
              name: playerName,
              totalScore: 0,
              roundScore: 0,
              joinedAt: Date.now(),
              connected: true,
              lastSeen: Date.now(),
            },
          },
          createdAt: Date.now(),
          lastActivity: Date.now(),
        });

        roomCreated = true;
      }

      if (!roomCreated) {
        hapticError();
        Alert.alert('Error', 'Unable to create new room. Please try again.');
        setIsCreatingNewRoom(false);
        return;
      }

      // Update old room with the new room code so others can follow
      await update(ref(database, `rooms/${roomCode}`), {
        nextRoomCode: newRoomCode,
      });

      success();
      hasNavigatedToNewRoom.current = true;

      // Navigate to the new room's lobby
      navigation.replace('Lobby', {
        roomCode: newRoomCode,
        playerId,
        playerName,
        isHost: true,
      });
    } catch (error) {
      console.error('Error creating new room:', error);
      hapticError();
      Alert.alert('Error', 'Failed to create new room. Please try again.');
      setIsCreatingNewRoom(false);
    }
  };

  const joinExistingNewRoom = async (newRoomCode) => {
    try {
      const newRoomRef = ref(database, `rooms/${newRoomCode}`);
      const snapshot = await get(newRoomRef);

      if (!snapshot.exists()) {
        Alert.alert('Error', 'New room no longer exists.');
        setIsCreatingNewRoom(false);
        return;
      }

      // Join as a player
      await set(ref(database, `rooms/${newRoomCode}/players/${playerId}`), {
        id: playerId,
        name: playerName,
        totalScore: 0,
        roundScore: 0,
        joinedAt: Date.now(),
        connected: true,
        lastSeen: Date.now(),
      });

      success();
      hasNavigatedToNewRoom.current = true;

      // Navigate to the new room's lobby
      navigation.replace('Lobby', {
        roomCode: newRoomCode,
        playerId,
        playerName,
        isHost: false,
      });
    } catch (error) {
      console.error('Error joining new room:', error);
      hapticError();
      Alert.alert('Error', 'Failed to join new room. Please try again.');
      setIsCreatingNewRoom(false);
    }
  };

  const handleBackToHome = async () => {
    await performCleanup();
    navigation.navigate('Welcome');
  };

  const handleShare = async () => {
    tapMedium();
    await shareResultsAsText(players, numRounds, true);
  };

  const sortedPlayers = [...players].sort((a, b) => b.totalScore - a.totalScore);

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

        {winners.length > 0 && (
          <View
            style={[
              styles.winnerContainer,
              {
                backgroundColor: theme.cardBackground,
                borderColor: isTie ? '#0ea5e9' : theme.accent,
              },
              isTie && styles.tieContainer,
            ]}
          >
            <Text style={styles.winnerEmoji}>{isTie ? '🤝' : '👑'}</Text>
            <Text style={[styles.winnerLabel, { color: theme.textSecondary }]}>
              {isTie ? "It's a Tie!" : 'Champion'}
            </Text>
            {isTie ? (
              <View style={styles.tieWinnersContainer}>
                {winners.map((winner, idx) => (
                  <Text key={winner.id} style={[styles.winnerName, { color: theme.text }]}>
                    {winner.name}
                    {winner.id === playerId ? ' (You)' : ''}
                    {idx < winners.length - 1 ? ' &' : ''}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={[styles.winnerName, { color: theme.text }]}>
                {winners[0].name}
                {winners[0].id === playerId ? ' (You)' : ''}
              </Text>
            )}
            <Text style={[styles.winnerScore, { color: theme.accent }]}>{topScore} points</Text>
          </View>
        )}

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
                key={player.id}
                style={[
                  styles.leaderboardRow,
                  { borderBottomColor: theme.border },
                  displayPosition === 0 && [
                    styles.leaderboardRowFirst,
                    { backgroundColor: theme.background },
                  ],
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
                  <Text style={[styles.leaderboardName, { color: theme.text }]}>
                    {player.name} {player.id === playerId && '(You)'}
                  </Text>
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

        {/* Gallery button */}
        {Object.keys(drawings).length > 0 && (
          <TouchableOpacity
            style={[
              styles.galleryButton,
              { backgroundColor: theme.cardBackground, borderColor: theme.border },
            ]}
            onPress={() => {
              tapMedium();
              setShowGallery(true);
            }}
          >
            <Text style={[styles.galleryButtonText, { color: theme.text }]}>
              🖼️ View All Drawings
            </Text>
          </TouchableOpacity>
        )}

        {/* Play Again button */}
        <TouchableOpacity
          style={[
            styles.playAgainButton,
            { backgroundColor: theme.success },
            isCreatingNewRoom && styles.buttonDisabled,
          ]}
          onPress={nextRoomCode ? () => joinExistingNewRoom(nextRoomCode) : handlePlayAgain}
          disabled={isCreatingNewRoom}
        >
          <Text style={styles.playAgainButtonText}>
            {isCreatingNewRoom
              ? '⏳ Creating...'
              : nextRoomCode
                ? '🎮 Join New Game'
                : '🔄 Play Again'}
          </Text>
        </TouchableOpacity>

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

          <TouchableOpacity
            style={[styles.homeButton, { backgroundColor: theme.primary }]}
            onPress={handleBackToHome}
          >
            <Text style={styles.homeButtonText}>🏠 Home</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Drawing Gallery Modal */}
      <DrawingGallery
        visible={showGallery}
        onClose={() => setShowGallery(false)}
        drawings={drawings}
        players={players}
      />
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
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 3,
    shadowColor: '#fbbf24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  tieContainer: {
    shadowColor: '#0ea5e9',
  },
  tieWinnersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  winnerEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  winnerLabel: {
    fontSize: 18,

    fontWeight: '600',
    marginBottom: 5,
  },
  winnerName: {
    fontSize: 32,
    fontWeight: 'bold',

    marginBottom: 10,
  },
  winnerScore: {
    fontSize: 24,

    fontWeight: 'bold',
  },
  leaderboardContainer: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
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
    borderBottomColor: '#f1f5f9',
  },
  leaderboardRowFirst: {
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
  galleryButton: {
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
  },
  galleryButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  playAgainButton: {
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    marginBottom: 12,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
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
    color: '#fff',
  },
  homeButton: {
    flex: 1,
    padding: 18,
    borderRadius: 15,
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  homeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
