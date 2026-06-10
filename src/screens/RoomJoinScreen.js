import { get, ref, set } from 'firebase/database';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LoadingOverlay, OfflineBanner } from '../components/NetworkStatus';
import { auth, database, ensureSignedIn } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import { MULTIPLAYER_CONFIG } from '../utils/constants';
import { error as hapticError, success, tapMedium } from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import { isValidRoomCode, normalizeRoomCode } from '../utils/roomCode';

// Map a room status to the screen a returning player should land on
function screenForStatus(status) {
  switch (status) {
    case 'drawing':
      return 'MultiplayerDrawing';
    case 'rating':
      return 'MultiplayerRating';
    case 'results':
      return 'MultiplayerResults';
    case 'finished':
      return 'MultiplayerFinal';
    default:
      return 'Lobby';
  }
}

export default function RoomJoinScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { isConnected } = useNetworkStatus();
  const [playerName, setPlayerName] = useState('');
  // Pre-fill room code from deep link if provided
  const [roomCode, setRoomCode] = useState(route.params?.roomCode || '');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinRoom = async () => {
    if (isJoining) return;

    if (!isConnected) {
      Alert.alert('Offline', 'Please check your internet connection and try again.');
      return;
    }

    const trimmedName = playerName.trim();
    if (trimmedName === '') {
      Alert.alert('Error', 'Please enter your name');
      return;
    }

    if (trimmedName.length > 20) {
      Alert.alert('Name Too Long', 'Name must be 20 characters or less.');
      return;
    }

    if (roomCode.trim() === '') {
      Alert.alert('Error', 'Please enter a room code');
      return;
    }

    const code = normalizeRoomCode(roomCode);

    if (!isValidRoomCode(code)) {
      Alert.alert('Invalid Code', 'Room codes are 6 letters/numbers (O and 0 are never used).');
      return;
    }

    setIsJoining(true);

    try {
      // Make sure we're authenticated - retries if app-start sign-in failed
      // (e.g. the app was first launched while offline)
      let user = auth.currentUser;
      if (!user) {
        try {
          user = await ensureSignedIn();
        } catch (authError) {
          console.error('Auth retry failed:', authError);
          Alert.alert('Connection Error', 'Could not connect to the server. Please try again.');
          setIsJoining(false);
          return;
        }
      }

      // Use the authenticated user's UID as the player ID
      // This is required for Firebase security rules to work properly
      const playerId = user.uid;

      const roomRef = ref(database, `rooms/${code}`);
      const snapshot = await get(roomRef);

      if (!snapshot.exists()) {
        Alert.alert('Room Not Found', 'Please check the code and try again.');
        setIsJoining(false);
        return;
      }

      const roomData = snapshot.val();

      // Rejoin: if this user is already a member, route them back into the
      // game wherever it currently is (works even after an app crash/restart)
      if (roomData.players && roomData.players[playerId]) {
        success();
        navigation.replace(screenForStatus(roomData.status), {
          roomCode: code,
          playerId,
          playerName: roomData.players[playerId].name,
        });
        return;
      }

      if (roomData.status !== 'lobby') {
        Alert.alert(
          'Game Started',
          'This game has already started. Ask the host to create a new room.'
        );
        setIsJoining(false);
        return;
      }

      const playerCount = Object.keys(roomData.players || {}).length;
      if (playerCount >= MULTIPLAYER_CONFIG.MAX_PLAYERS) {
        Alert.alert(
          'Room Full',
          `This room already has ${MULTIPLAYER_CONFIG.MAX_PLAYERS} players.`
        );
        setIsJoining(false);
        return;
      }

      // Write player info directly to their player path
      // (can't update room root because user isn't a player yet - security rules)
      await set(ref(database, `rooms/${code}/players/${playerId}`), {
        id: playerId,
        name: trimmedName,
        totalScore: 0,
        roundScore: 0,
        joinedAt: Date.now(),
        connected: true,
        lastSeen: Date.now(),
      });

      success(); // Haptic feedback on successful join
      navigation.replace('Lobby', {
        roomCode: code,
        playerId,
        playerName: trimmedName,
      });
    } catch (error) {
      console.error('Error joining room:', error);
      hapticError(); // Haptic feedback on error
      Alert.alert('Error', 'Failed to join room. Please check your connection and try again.');
      setIsJoining(false);
    }
  };

  // Live validation feedback once a full code is entered
  const codeComplete = roomCode.length === 6;
  const codeValid = isValidRoomCode(normalizeRoomCode(roomCode));

  return (
    <KeyboardAvoidingView
      style={[styles.wrapper, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OfflineBanner visible={!isConnected} />
      <LoadingOverlay visible={isJoining} message="Joining room..." />

      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>🚪 Join Game Room</Text>

        <View
          style={[
            styles.card,
            { backgroundColor: theme.cardBackground, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.label, { color: theme.textSecondary }]}>Your Name</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: theme.background, color: theme.text, borderColor: theme.border },
            ]}
            placeholder="Enter your name"
            placeholderTextColor={theme.textSecondary}
            value={playerName}
            onChangeText={setPlayerName}
            autoCapitalize="words"
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Room Code</Text>
          <TextInput
            style={[
              styles.codeInput,
              {
                backgroundColor: theme.background,
                color: theme.text,
                borderColor: codeComplete
                  ? codeValid
                    ? theme.success
                    : theme.danger
                  : theme.border,
              },
            ]}
            placeholder="XXXXXX"
            placeholderTextColor={theme.textSecondary}
            value={roomCode}
            onChangeText={(text) => setRoomCode(text.toUpperCase())}
            autoCapitalize="characters"
            maxLength={6}
            accessibilityLabel="Room code"
          />
          {codeComplete && !codeValid && (
            <Text style={[styles.codeHint, { color: theme.danger }]}>
              Codes never contain the letter O or the digit 0
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.joinButton,
            { backgroundColor: theme.primary },
            (!isConnected || isJoining) && styles.buttonDisabled,
          ]}
          onPress={() => {
            tapMedium();
            handleJoinRoom();
          }}
          disabled={!isConnected || isJoining}
        >
          <Text style={styles.joinButtonText}>
            {!isConnected ? 'Offline' : isJoining ? 'Joining...' : 'Join Room'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    textAlign: 'center',
    marginVertical: 30,
  },
  card: {
    borderRadius: 20,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
    borderWidth: 1,
  },
  label: {
    fontSize: 16,
    marginTop: 15,
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
    fontWeight: '500',
  },
  codeInput: {
    borderRadius: 12,
    padding: 18,
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 8,
    borderWidth: 2,
  },
  codeHint: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  joinButton: {
    padding: 20,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 30,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
