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
import WheelPicker from '../components/WheelPicker';
import { auth, database, ensureSignedIn } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import { error as hapticError, selection, success, tapMedium } from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import { generateRoomCode } from '../utils/roomCode';

export default function RoomCreateScreen({ navigation }) {
  const { theme } = useTheme();
  const { isConnected } = useNetworkStatus();
  const [playerName, setPlayerName] = useState('');
  const [numRounds, setNumRounds] = useState(3);
  const [minutes, setMinutes] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  // Calculate total time limit in seconds
  const timeLimit = minutes * 60 + seconds;

  const handleCreateRoom = async () => {
    if (isCreating) return;

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

    if (timeLimit < 30) {
      Alert.alert('Error', 'Time limit must be at least 30 seconds');
      return;
    }

    // Firebase security rules reject timeLimit > 300, so block it client-side too
    if (timeLimit > 300) {
      Alert.alert('Error', 'Time limit can be at most 5 minutes');
      return;
    }

    setIsCreating(true);

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
          setIsCreating(false);
          return;
        }
      }

      // Use the authenticated user's UID as the player ID
      // This is required for Firebase security rules to work properly
      const playerId = user.uid;

      let roomCode = generateRoomCode();
      let roomCreated = false;
      let attempts = 0;
      const maxAttempts = 5;

      // Check if room exists and create it
      while (!roomCreated && attempts < maxAttempts) {
        const roomRef = ref(database, `rooms/${roomCode}`);

        // Check if room already exists
        const snapshot = await get(roomRef);
        if (snapshot.exists()) {
          // Room code collision, generate a new one
          roomCode = generateRoomCode();
          attempts++;
          continue;
        }

        // Create the room
        await set(roomRef, {
          code: roomCode,
          hostId: playerId,
          settings: {
            numRounds,
            timeLimit,
          },
          status: 'lobby',
          currentRound: 1,
          currentTopic: '',
          players: {
            [playerId]: {
              id: playerId,
              name: trimmedName,
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
        Alert.alert('Error', 'Unable to create room. Please try again.');
        setIsCreating(false);
        return;
      }

      success(); // Haptic feedback on successful room creation
      navigation.replace('Lobby', {
        roomCode,
        playerId,
        playerName: trimmedName,
      });
    } catch (error) {
      console.error('Error creating room:', error);
      hapticError(); // Haptic feedback on error
      Alert.alert('Error', 'Failed to create room. Please check your connection and try again.');
      setIsCreating(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.wrapper, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OfflineBanner visible={!isConnected} />
      <LoadingOverlay visible={isCreating} message="Creating room..." />

      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>🎨 Create Game Room</Text>

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

          <Text style={[styles.label, { color: theme.textSecondary }]}>Number of Rounds</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity
              style={[styles.counterButton, { backgroundColor: theme.primary }]}
              onPress={() => {
                selection();
                setNumRounds(Math.max(1, numRounds - 1));
              }}
            >
              <Text style={styles.counterButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={[styles.counterValue, { color: theme.text }]}>{numRounds}</Text>
            <TouchableOpacity
              style={[styles.counterButton, { backgroundColor: theme.primary }]}
              onPress={() => {
                selection();
                setNumRounds(Math.min(10, numRounds + 1));
              }}
            >
              <Text style={styles.counterButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.label, { color: theme.textSecondary }]}>Time Limit</Text>
          <View style={styles.timeRow}>
            <WheelPicker value={minutes} onChange={setMinutes} maxValue={5} label="min" />
            <Text style={[styles.timeSeparator, { color: theme.text }]}>:</Text>
            <WheelPicker value={seconds} onChange={setSeconds} maxValue={59} label="sec" />
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.createButton,
            { backgroundColor: theme.success },
            (!isConnected || isCreating) && styles.buttonDisabled,
          ]}
          onPress={() => {
            tapMedium();
            handleCreateRoom();
          }}
          disabled={!isConnected || isCreating}
        >
          <Text style={styles.createButtonText}>
            {!isConnected ? 'Offline' : isCreating ? 'Creating...' : 'Create Room'}
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
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  counterButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  counterValue: {
    fontSize: 22,
    fontWeight: '800',
    marginHorizontal: 30,
    minWidth: 60,
    textAlign: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  timeSeparator: {
    fontSize: 32,
    fontWeight: '800',
    marginHorizontal: 8,
  },
  createButton: {
    padding: 20,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
    marginBottom: 30,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
