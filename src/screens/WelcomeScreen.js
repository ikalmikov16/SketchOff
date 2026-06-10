import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { tapLight, tapMedium } from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import { isSoundMuted, playTap, toggleMute } from '../utils/sounds';
import { hasSeenHowToPlay, markHowToPlaySeen } from '../utils/storage';

const HOW_TO_PLAY_STEPS = [
  {
    emoji: '🏠',
    title: 'Create or join a room',
    text: 'Share the 6-letter code or QR with friends',
  },
  {
    emoji: '✏️',
    title: 'Draw the topic',
    text: 'Everyone draws the same thing before time runs out',
  },
  { emoji: '⭐', title: 'Rate the art', text: "Score each other's masterpieces from 0 to 10" },
  { emoji: '🏆', title: 'Crown a champion', text: 'Highest total score after all rounds wins' },
];

export default function WelcomeScreen({ navigation }) {
  const { theme } = useTheme();
  const { isConnected, isChecking } = useNetworkStatus();
  const [isMuted, setIsMuted] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  useEffect(() => {
    // Load initial mute state
    setIsMuted(isSoundMuted());

    // Show the how-to-play guide automatically on first launch
    hasSeenHowToPlay().then((seen) => {
      if (!seen) {
        setShowHowToPlay(true);
      }
    });
  }, []);

  const handleCloseHowToPlay = () => {
    tapLight();
    setShowHowToPlay(false);
    markHowToPlaySeen();
  };

  const handleMuteToggle = async () => {
    tapLight();
    const newMutedState = await toggleMute();
    setIsMuted(newMutedState);
    // Play a tap sound to confirm unmute (if we just unmuted)
    if (!newMutedState) {
      playTap();
    }
  };

  const handleNavigate = (screen) => {
    tapMedium();
    navigation.navigate(screen);
  };

  // Don't show offline UI until we've confirmed the connection status
  // This prevents the flash of offline mode on app start
  const showOfflineUI = !isConnected && !isChecking;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headerContainer}>
          {/* Settings Buttons - Top Right */}
          <View style={styles.settingsRow}>
            {/* How to Play */}
            <TouchableOpacity
              style={[
                styles.settingsButton,
                { backgroundColor: theme.cardBackground, borderColor: theme.border },
              ]}
              onPress={() => {
                tapLight();
                setShowHowToPlay(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="How to play"
            >
              <Text style={styles.settingsButtonText}>❓</Text>
            </TouchableOpacity>

            {/* Sound Toggle */}
            <TouchableOpacity
              style={[
                styles.settingsButton,
                { backgroundColor: theme.cardBackground, borderColor: theme.border },
              ]}
              onPress={handleMuteToggle}
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Unmute sounds' : 'Mute sounds'}
            >
              <Text style={styles.settingsButtonText}>{isMuted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>

            {/* Stats Button */}
            <TouchableOpacity
              style={[
                styles.settingsButton,
                { backgroundColor: theme.cardBackground, borderColor: theme.border },
              ]}
              onPress={() => handleNavigate('Stats')}
              accessibilityRole="button"
              accessibilityLabel="Your stats"
            >
              <Text style={styles.settingsButtonText}>📊</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.titleContainer}>
            <Text style={styles.title}>🎨</Text>
            <Text style={[styles.titleText, { color: theme.text }]}>SketchOff</Text>
            <View
              style={[
                styles.subtitleBadge,
                { backgroundColor: theme.primary + '20', borderColor: theme.primary + '40' },
              ]}
            >
              <Text style={[styles.subtitle, { color: theme.primary }]}>
                ✨ Draw • Rate • Compete ✨
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.modeContainer}>
          {/* Multiplayer Mode */}
          <TouchableOpacity
            style={styles.modeButtonWrapper}
            onPress={() => !showOfflineUI && handleNavigate('RoomCreate')}
            activeOpacity={showOfflineUI ? 1 : 0.8}
            disabled={showOfflineUI}
          >
            <View
              style={[
                styles.modeButton,
                styles.multiplayerButton,
                showOfflineUI && styles.disabledButton,
              ]}
            >
              <View style={[styles.iconCircle, showOfflineUI && styles.disabledIconCircle]}>
                <Text style={styles.modeButtonEmoji}>{showOfflineUI ? '📡' : '🌐'}</Text>
              </View>
              <Text style={styles.modeButtonTitle}>Create Multiplayer</Text>
              <Text style={styles.modeButtonDesc}>
                {showOfflineUI
                  ? 'Requires internet connection'
                  : 'Each player draws on their phone'}
              </Text>
              {showOfflineUI && (
                <View style={styles.offlineBadge}>
                  <Text style={styles.offlineBadgeText}>OFFLINE</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.modeButtonWrapper}
            onPress={() => !showOfflineUI && handleNavigate('RoomJoin')}
            activeOpacity={showOfflineUI ? 1 : 0.8}
            disabled={showOfflineUI}
          >
            <View
              style={[styles.modeButton, styles.joinButton, showOfflineUI && styles.disabledButton]}
            >
              <View style={[styles.iconCircle, showOfflineUI && styles.disabledIconCircle]}>
                <Text style={styles.modeButtonEmoji}>{showOfflineUI ? '📡' : '🚪'}</Text>
              </View>
              <Text style={styles.modeButtonTitle}>Join Game</Text>
              <Text style={styles.modeButtonDesc}>
                {showOfflineUI ? 'Requires internet connection' : 'Enter room code to play'}
              </Text>
              {showOfflineUI && (
                <View style={styles.offlineBadge}>
                  <Text style={styles.offlineBadgeText}>OFFLINE</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Single Phone Mode - Always Available */}
          <TouchableOpacity
            style={styles.modeButtonWrapper}
            onPress={() => handleNavigate('Setup')}
            activeOpacity={0.8}
          >
            <View style={[styles.modeButton, styles.singlePhoneButton]}>
              <View style={styles.iconCircle}>
                <Text style={styles.modeButtonEmoji}>📱</Text>
              </View>
              <Text style={styles.modeButtonTitle}>Single Device</Text>
              <Text style={styles.modeButtonDesc}>Draw on paper, score together</Text>
              {showOfflineUI && (
                <View style={styles.availableBadge}>
                  <Text style={styles.availableBadgeText}>AVAILABLE OFFLINE</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* Offline Notice */}
        {showOfflineUI && (
          <View
            style={[
              styles.offlineNotice,
              { backgroundColor: theme.cardBackground, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.offlineNoticeText, { color: theme.textSecondary }]}>
              📡 You&apos;re offline. Connect to the internet to play multiplayer.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* How to Play Modal */}
      <Modal visible={showHowToPlay} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.howToCard, { backgroundColor: theme.cardBackground }]}>
            <Text style={[styles.howToTitle, { color: theme.text }]}>How to Play</Text>

            {HOW_TO_PLAY_STEPS.map((step, index) => (
              <View key={index} style={styles.howToStep}>
                <View style={[styles.howToStepIcon, { backgroundColor: theme.primary + '20' }]}>
                  <Text style={styles.howToStepEmoji}>{step.emoji}</Text>
                </View>
                <View style={styles.howToStepText}>
                  <Text style={[styles.howToStepTitle, { color: theme.text }]}>{step.title}</Text>
                  <Text style={[styles.howToStepDesc, { color: theme.textSecondary }]}>
                    {step.text}
                  </Text>
                </View>
              </View>
            ))}

            <Text style={[styles.howToFootnote, { color: theme.textSecondary }]}>
              No second phone? Single Device mode works offline — draw on paper and score together.
            </Text>

            <TouchableOpacity
              style={[styles.howToButton, { backgroundColor: theme.primary }]}
              onPress={handleCloseHowToPlay}
              accessibilityRole="button"
              accessibilityLabel="Close how to play"
            >
              <Text style={styles.howToButtonText}>Let&apos;s Draw! 🎨</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 10,
    paddingBottom: 30,
  },
  headerContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  settingsRow: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
  },
  settingsButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1,
  },
  settingsButtonText: {
    fontSize: 22,
  },
  titleContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  title: {
    fontSize: 72,
    marginBottom: 12,
  },
  titleText: {
    fontSize: 42,
    fontWeight: '900',
    marginBottom: 16,
    letterSpacing: 1,
  },
  subtitleBadge: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modeContainer: {
    gap: 18,
    paddingBottom: 10,
  },
  modeButtonWrapper: {
    borderRadius: 24,
  },
  modeButton: {
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  multiplayerButton: {
    backgroundColor: '#6366f1',
  },
  joinButton: {
    backgroundColor: '#10b981',
  },
  singlePhoneButton: {
    backgroundColor: '#f59e0b',
  },
  disabledButton: {
    opacity: 0.5,
    backgroundColor: '#64748b',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  disabledIconCircle: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  modeButtonEmoji: {
    fontSize: 40,
  },
  modeButtonTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  modeButtonDesc: {
    fontSize: 15,
    color: '#fff',
    textAlign: 'center',
    opacity: 0.9,
    fontWeight: '600',
    lineHeight: 20,
  },
  offlineBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  offlineBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  availableBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  availableBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  offlineNotice: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  offlineNoticeText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  // How to Play modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  howToCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 28,
  },
  howToTitle: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 24,
  },
  howToStep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  howToStepIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  howToStepEmoji: {
    fontSize: 22,
  },
  howToStepText: {
    flex: 1,
  },
  howToStepTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  howToStepDesc: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  howToFootnote: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 20,
  },
  howToButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  howToButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
});
