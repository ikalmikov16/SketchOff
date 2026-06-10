import { onValue, ref, remove, update } from 'firebase/database';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingOverlay, OfflineBanner } from '../components/NetworkStatus';
import { database } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import { getRandomTopic } from '../services/TopicService';
import {
  error as hapticError,
  success,
  tapHeavy,
  tapLight,
  tapMedium,
  warning,
} from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import {
  clearPresence,
  isPlayerConnected,
  isValidPlayer,
  migrateHostIfNeeded,
  registerPresence,
} from '../utils/presence';
import { shareRoomCode } from '../utils/sharing';

export default function LobbyScreen({ route, navigation }) {
  const { roomCode, playerId, playerName } = route.params;
  const { theme } = useTheme();
  const { isConnected } = useNetworkStatus();
  const [players, setPlayers] = useState([]);
  const [isHost, setIsHost] = useState(false);
  const [roomSettings, setRoomSettings] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editName, setEditName] = useState(playerName);
  const [editRounds, setEditRounds] = useState(3);
  const [editTimeLimit, setEditTimeLimit] = useState(60);
  const [currentPlayerName, setCurrentPlayerName] = useState(playerName);

  // Track our presence in this room (marks us offline if the app dies)
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

        // Check if game has started
        if (roomData.status === 'drawing') {
          // Get current player's name from Firebase to use the updated name
          const updatedPlayerName = roomData.players?.[playerId]?.name || playerName;
          navigation.replace('MultiplayerDrawing', {
            roomCode,
            playerId,
            playerName: updatedPlayerName,
          });
          return;
        }

        // Update players list
        if (roomData.players) {
          const playersList = Object.values(roomData.players)
            .filter(isValidPlayer)
            .map((p) => ({
              ...p,
              isHost: p.id === roomData.hostId, // Derive isHost from hostId
              isOnline: isPlayerConnected(p),
            }));
          setPlayers(playersList);

          // Check if current user is host
          const currentPlayer = playersList.find((p) => p.id === playerId);
          if (currentPlayer) {
            setIsHost(roomData.hostId === playerId);
            // Update current player name from Firebase
            setCurrentPlayerName(currentPlayer.name);
          } else {
            // Player was removed from the room
            clearPresence();
            Alert.alert('Removed', 'You have been removed from the room.');
            navigation.replace('Welcome');
            return;
          }

          // If the host went offline (app killed, network lost), promote a
          // new host so the lobby isn't stuck. Any client may trigger this -
          // the transaction inside guarantees a single promotion.
          const host = roomData.players[roomData.hostId];
          if (!host || !isPlayerConnected(host)) {
            migrateHostIfNeeded(roomCode);
          }
        }

        setRoomSettings(roomData.settings);
      },
      (error) => {
        console.error('Firebase error:', error);
        Alert.alert('Connection Error', 'Lost connection to the game. Please try again.');
        navigation.replace('Welcome');
      }
    );

    // Use the unsubscribe function returned by onValue instead of off()
    return () => unsubscribe();
  }, [roomCode, playerId, navigation, playerName]);

  const handleStartGame = async () => {
    if (isStarting || !isConnected) return;

    if (players.length < 2) {
      Alert.alert('Need More Players', 'You need at least 2 players to start the game.');
      return;
    }

    setIsStarting(true);

    try {
      const topic = getRandomTopic();
      const timeLimit = roomSettings?.timeLimit || 60;
      await update(ref(database, `rooms/${roomCode}`), {
        status: 'drawing',
        currentTopic: topic,
        drawingStartTime: Date.now(),
        drawingEndTime: Date.now() + timeLimit * 1000,
        lastActivity: Date.now(),
      });
      success(); // Haptic feedback on successful game start
      // Navigation will happen automatically via the onValue listener
    } catch (error) {
      console.error('Error starting game:', error);
      hapticError(); // Haptic feedback on error
      Alert.alert('Error', 'Failed to start game. Please check your connection and try again.');
      setIsStarting(false);
    }
  };

  const handleLeaveGame = async () => {
    warning(); // Haptic feedback for warning action

    const otherPlayers = players.filter((p) => p.id !== playerId);
    const willTransferHost = isHost && otherPlayers.length > 0;

    const message =
      isHost && otherPlayers.length === 0
        ? 'You are the only player. Leaving will close the room. Are you sure?'
        : isHost
          ? `Leaving will make ${otherPlayers[0]?.name} the new host. Are you sure?`
          : 'Are you sure you want to leave this game?';

    // Use window.confirm on web since Alert.alert doesn't work properly
    let confirmed = false;
    if (Platform.OS === 'web') {
      confirmed = window.confirm(message);
    } else {
      // On native, use Alert.alert with Promise wrapper
      confirmed = await new Promise((resolve) => {
        Alert.alert('Leave Game', message, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Leave', style: 'destructive', onPress: () => resolve(true) },
        ]);
      });
    }

    if (!confirmed) return;

    setIsLeaving(true);
    try {
      // Cancel the onDisconnect handler first - otherwise it would re-create
      // a ghost player node ({connected: false}) after we remove ourselves
      clearPresence();

      if (isHost && otherPlayers.length === 0) {
        // Host is the last player - delete the entire room
        await remove(ref(database, `rooms/${roomCode}`));
      } else if (willTransferHost) {
        // Host leaving with other players - transfer host to next player
        const newHost = otherPlayers[0];
        await update(ref(database, `rooms/${roomCode}`), {
          hostId: newHost.id,
        });
        // Remove the leaving host from players
        await remove(ref(database, `rooms/${roomCode}/players/${playerId}`));
      } else {
        // Regular player leaving - just remove themselves
        await remove(ref(database, `rooms/${roomCode}/players/${playerId}`));
      }
      navigation.replace('Welcome');
    } catch (error) {
      console.error('Error leaving game:', error);
      hapticError();
      if (Platform.OS === 'web') {
        window.alert('Failed to leave game. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to leave game. Please try again.');
      }
      setIsLeaving(false);
    }
  };

  const handleShareCode = async () => {
    tapLight();
    await shareRoomCode(roomCode);
  };

  const handleKickPlayer = async (playerToKick) => {
    if (!isHost || playerToKick.isHost) return;

    warning();

    const message = `Are you sure you want to remove ${playerToKick.name} from the game?`;

    let confirmed = false;
    if (Platform.OS === 'web') {
      confirmed = window.confirm(message);
    } else {
      confirmed = await new Promise((resolve) => {
        Alert.alert('Remove Player', message, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Remove', style: 'destructive', onPress: () => resolve(true) },
        ]);
      });
    }

    if (!confirmed) return;

    try {
      await remove(ref(database, `rooms/${roomCode}/players/${playerToKick.id}`));
      success();
    } catch (error) {
      console.error('Error kicking player:', error);
      hapticError();
      if (Platform.OS === 'web') {
        window.alert('Failed to remove player. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to remove player. Please try again.');
      }
    }
  };

  const handleUpdateName = async () => {
    const trimmedName = editName.trim();
    if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 20) {
      Alert.alert('Invalid Name', 'Name must be between 1 and 20 characters.');
      return;
    }

    try {
      await update(ref(database, `rooms/${roomCode}/players/${playerId}`), {
        name: trimmedName,
      });
      setCurrentPlayerName(trimmedName);
      setShowNameModal(false);
      success();
    } catch (error) {
      console.error('Error updating name:', error);
      hapticError();
      Alert.alert('Error', 'Failed to update name. Please try again.');
    }
  };

  const handleUpdateSettings = async () => {
    if (editRounds < 1 || editRounds > 10) {
      Alert.alert('Invalid Rounds', 'Number of rounds must be between 1 and 10.');
      return;
    }
    if (editTimeLimit < 30 || editTimeLimit > 300) {
      Alert.alert('Invalid Time', 'Time limit must be between 30 seconds and 5 minutes.');
      return;
    }

    try {
      await update(ref(database, `rooms/${roomCode}/settings`), {
        numRounds: editRounds,
        timeLimit: editTimeLimit,
      });
      setShowSettingsModal(false);
      success();
    } catch (error) {
      console.error('Error updating settings:', error);
      hapticError();
      Alert.alert('Error', 'Failed to update settings. Please try again.');
    }
  };

  const openSettingsModal = () => {
    if (roomSettings) {
      setEditRounds(roomSettings.numRounds);
      setEditTimeLimit(roomSettings.timeLimit);
    }
    setShowSettingsModal(true);
  };

  // Format time limit nicely
  const formatTimeLimit = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    if (secs === 0) return `${mins}m`;
    return `${mins}m ${secs}s`;
  };

  return (
    <SafeAreaView style={[styles.wrapper, { backgroundColor: theme.background }]} edges={['top']}>
      <OfflineBanner visible={!isConnected} />
      <LoadingOverlay visible={isStarting} message="Starting game..." />
      <LoadingOverlay visible={isLeaving} message="Leaving..." />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>Game Lobby</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Share the code to invite friends
            </Text>
            {isHost && (
              <TouchableOpacity
                style={[styles.settingsButton, { backgroundColor: theme.cardBackground }]}
                onPress={() => {
                  tapLight();
                  openSettingsModal();
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Game settings"
              >
                <Text style={styles.settingsButtonIcon}>⚙️</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Room Code Card */}
          <View style={[styles.codeCard, { backgroundColor: theme.primary }]}>
            {/* Share button in corner */}
            <TouchableOpacity
              style={styles.shareCornerButton}
              onPress={handleShareCode}
              accessibilityRole="button"
              accessibilityLabel="Share room code"
            >
              <Text style={styles.shareCornerIcon}>📤</Text>
            </TouchableOpacity>

            <Text style={styles.codeLabel}>ROOM CODE</Text>
            <Text style={styles.roomCode}>{roomCode}</Text>

            {/* QR Code centered */}
            <View style={styles.qrWrapper}>
              <QRCode
                value={`sketchoff://join/${roomCode}`}
                size={100}
                backgroundColor="transparent"
                color="#fff"
              />
            </View>
            <Text style={styles.qrText}>Scan to join</Text>
          </View>

          {/* Game Info Row */}
          {roomSettings && (
            <View style={styles.infoRow}>
              <View style={[styles.infoChip, { backgroundColor: theme.cardBackground }]}>
                <Text style={styles.infoIcon}>🎯</Text>
                <Text style={[styles.infoValue, { color: theme.text }]}>
                  {roomSettings.numRounds}
                </Text>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>rounds</Text>
              </View>
              <View style={[styles.infoChip, { backgroundColor: theme.cardBackground }]}>
                <Text style={styles.infoIcon}>⏱️</Text>
                <Text style={[styles.infoValue, { color: theme.text }]}>
                  {formatTimeLimit(roomSettings.timeLimit)}
                </Text>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>per round</Text>
              </View>
            </View>
          )}

          {/* Players Card */}
          <View
            style={[
              styles.playersCard,
              { backgroundColor: theme.cardBackground, borderColor: theme.border },
            ]}
          >
            <View style={styles.playersHeader}>
              <Text style={[styles.playersTitle, { color: theme.text }]}>Players</Text>
              <View style={[styles.playerCount, { backgroundColor: theme.primary + '20' }]}>
                <Text style={[styles.playerCountText, { color: theme.primary }]}>
                  {players.length}
                </Text>
              </View>
            </View>

            {players.map((player, index) => (
              <View
                key={player.id}
                style={[
                  styles.playerRow,
                  index !== players.length - 1 && { borderBottomColor: theme.border + '50' },
                  index !== players.length - 1 && styles.playerRowBorder,
                ]}
              >
                <View style={[styles.playerInfo, !player.isOnline && styles.playerOffline]}>
                  <View
                    style={[
                      styles.playerAvatar,
                      { backgroundColor: player.isHost ? theme.accent : theme.primary + '30' },
                    ]}
                  >
                    <Text style={styles.playerInitial}>
                      {player.isHost ? '👑' : player.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.playerDetails}>
                    <Text style={[styles.playerName, { color: theme.text }]}>{player.name}</Text>
                    {(player.isHost || !player.isOnline) && (
                      <Text
                        style={[
                          styles.hostLabel,
                          { color: !player.isOnline ? theme.warning : theme.textSecondary },
                        ]}
                      >
                        {!player.isOnline ? 'Offline' : 'Host'}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.playerActions}>
                  {player.id === playerId && (
                    <>
                      <TouchableOpacity
                        style={[styles.editButton, { backgroundColor: theme.primary + '15' }]}
                        onPress={() => {
                          tapLight();
                          setEditName(currentPlayerName);
                          setShowNameModal(true);
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel="Edit your name"
                      >
                        <Text style={[styles.editButtonText, { color: theme.primary }]}>✏️</Text>
                      </TouchableOpacity>
                      <View style={[styles.youBadge, { backgroundColor: theme.success + '20' }]}>
                        <Text style={[styles.youBadgeText, { color: theme.success }]}>You</Text>
                      </View>
                    </>
                  )}
                  {isHost && player.id !== playerId && !player.isHost && (
                    <TouchableOpacity
                      style={[styles.kickButton, { backgroundColor: theme.danger + '15' }]}
                      onPress={() => {
                        tapLight();
                        handleKickPlayer(player);
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${player.name} from the game`}
                    >
                      <Text style={[styles.kickButtonText, { color: theme.danger }]}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}

            {players.length < 2 && (
              <View style={styles.waitingContainer}>
                <Text style={styles.waitingDots}>• • •</Text>
                <Text style={[styles.waitingText, { color: theme.textSecondary }]}>
                  Waiting for players to join
                </Text>
              </View>
            )}
          </View>

          {/* Start Button (Host only) */}
          {isHost && (
            <TouchableOpacity
              style={[
                styles.startButton,
                { backgroundColor: theme.success },
                (players.length < 2 || isStarting || !isConnected) && styles.buttonDisabled,
              ]}
              onPress={() => {
                tapHeavy();
                handleStartGame();
              }}
              disabled={players.length < 2 || isStarting || !isConnected}
              activeOpacity={0.8}
            >
              <Text style={styles.startButtonText}>
                {!isConnected
                  ? 'Offline...'
                  : isStarting
                    ? 'Starting...'
                    : players.length < 2
                      ? 'Need 2+ Players'
                      : 'Start Game'}
              </Text>
              {players.length >= 2 && isConnected && !isStarting && (
                <Text style={styles.startButtonIcon}>🎨</Text>
              )}
            </TouchableOpacity>
          )}

          {/* Waiting Message (Non-host) */}
          {!isHost && (
            <View style={[styles.waitingCard, { backgroundColor: theme.cardBackground }]}>
              <Text style={styles.waitingEmoji}>⏳</Text>
              <Text style={[styles.waitingTitle, { color: theme.text }]}>
                Waiting for host to start
              </Text>
              <Text style={[styles.waitingSubtitle, { color: theme.textSecondary }]}>
                Get ready to draw!
              </Text>
            </View>
          )}

          {/* Leave Button */}
          <TouchableOpacity
            style={styles.leaveButton}
            onPress={() => {
              tapMedium();
              handleLeaveGame();
            }}
            disabled={isLeaving}
            activeOpacity={0.7}
          >
            <Text style={[styles.leaveButtonText, { color: theme.danger }]}>Leave Game</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Name Modal */}
      <Modal visible={showNameModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Edit Your Name</Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: theme.background, color: theme.text, borderColor: theme.border },
              ]}
              value={editName}
              onChangeText={setEditName}
              placeholder="Enter your name"
              placeholderTextColor={theme.textSecondary}
              maxLength={20}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonCancel,
                  { borderColor: theme.border },
                ]}
                onPress={() => setShowNameModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonSave,
                  { backgroundColor: theme.primary },
                ]}
                onPress={handleUpdateName}
              >
                <Text style={[styles.modalButtonText, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Settings Modal */}
      <Modal visible={showSettingsModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Game Settings</Text>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: theme.text }]}>Rounds</Text>
              <View style={styles.settingControls}>
                <TouchableOpacity
                  style={[
                    styles.settingButton,
                    { backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                  onPress={() => setEditRounds(Math.max(1, editRounds - 1))}
                >
                  <Text style={[styles.settingButtonText, { color: theme.text }]}>−</Text>
                </TouchableOpacity>
                <Text style={[styles.settingValue, { color: theme.text }]}>{editRounds}</Text>
                <TouchableOpacity
                  style={[
                    styles.settingButton,
                    { backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                  onPress={() => setEditRounds(Math.min(10, editRounds + 1))}
                >
                  <Text style={[styles.settingButtonText, { color: theme.text }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.settingRow}>
              <Text style={[styles.settingLabel, { color: theme.text }]}>Time per round</Text>
              <View style={styles.settingControls}>
                <TouchableOpacity
                  style={[
                    styles.settingButton,
                    { backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                  onPress={() => setEditTimeLimit(Math.max(30, editTimeLimit - 15))}
                >
                  <Text style={[styles.settingButtonText, { color: theme.text }]}>−</Text>
                </TouchableOpacity>
                <Text style={[styles.settingValue, { color: theme.text }]}>
                  {formatTimeLimit(editTimeLimit)}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.settingButton,
                    { backgroundColor: theme.background, borderColor: theme.border },
                  ]}
                  onPress={() => setEditTimeLimit(Math.min(300, editTimeLimit + 15))}
                >
                  <Text style={[styles.settingButtonText, { color: theme.text }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonCancel,
                  { borderColor: theme.border },
                ]}
                onPress={() => setShowSettingsModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  styles.modalButtonSave,
                  { backgroundColor: theme.primary },
                ]}
                onPress={handleUpdateSettings}
              >
                <Text style={[styles.modalButtonText, { color: '#fff' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
    paddingBottom: 50,
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    marginTop: 6,
    fontWeight: '500',
  },
  settingsButton: {
    position: 'absolute',
    top: 8,
    right: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  settingsButtonIcon: {
    fontSize: 22,
  },
  codeCard: {
    borderRadius: 24,
    padding: 28,
    paddingTop: 20,
    marginBottom: 16,
    alignItems: 'center',
    position: 'relative',
  },
  shareCornerButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareCornerIcon: {
    fontSize: 20,
  },
  codeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 2,
    marginBottom: 8,
    marginTop: 8,
  },
  roomCode: {
    fontSize: 38,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 8,
    marginBottom: 24,
  },
  qrWrapper: {
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
  },
  qrText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 12,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  infoChip: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  infoIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  infoValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  playersCard: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
  },
  playersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  playersTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  playerCount: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerCountText: {
    fontSize: 14,
    fontWeight: '800',
  },
  playerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  playerRowBorder: {
    borderBottomWidth: 1,
  },
  playerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  playerOffline: {
    opacity: 0.5,
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  playerInitial: {
    fontSize: 16,
    fontWeight: '700',
  },
  playerDetails: {
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: '600',
  },
  hostLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  playerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kickButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kickButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  youBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  youBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  waitingContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  waitingDots: {
    fontSize: 20,
    color: '#aaa',
    marginBottom: 8,
    letterSpacing: 4,
  },
  waitingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  startButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    borderRadius: 16,
    gap: 10,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  startButtonIcon: {
    fontSize: 20,
  },
  waitingCard: {
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
  },
  waitingEmoji: {
    fontSize: 32,
    marginBottom: 12,
  },
  waitingTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  waitingSubtitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  leaveButton: {
    marginTop: 16,
    padding: 14,
    alignItems: 'center',
  },
  leaveButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalInput: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalButtonCancel: {
    borderWidth: 1,
  },
  modalButtonSave: {},
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  settingControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingButtonText: {
    fontSize: 20,
    fontWeight: '500',
  },
  settingValue: {
    fontSize: 18,
    fontWeight: '600',
    minWidth: 50,
    textAlign: 'center',
  },
});
