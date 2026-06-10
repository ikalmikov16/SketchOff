import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import TimerProgress from '../components/TimerProgress';
import { useGame } from '../context/GameContext';
import { useTheme } from '../context/ThemeContext';
import { getRandomTopic } from '../services/TopicService';
import { tapHeavy, tapLight, tapMedium, warning } from '../utils/haptics';

export default function TopicScreen({ navigation }) {
  const { currentRound, numRounds, timeLimit, setCurrentTopic, currentTopic } = useGame();
  const { theme } = useTheme();
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(timeLimit);

  // Store the end time for accurate time sync (even after backgrounding)
  const timerEndTimeRef = useRef(null);

  // Define handleTimerEnd first so it can be used in useEffect
  const handleTimerEnd = useCallback(() => {
    setIsTimerRunning(false);
    timerEndTimeRef.current = null;

    Alert.alert("⏰ Time's Up!", "Drawing time is over! Now it's time to rate the drawings.", [
      {
        text: 'Start Rating',
        onPress: () => navigation.navigate('Rating'),
      },
    ]);
  }, [navigation]);

  useEffect(() => {
    // Generate topic when screen loads if not already set
    if (!currentTopic) {
      const topic = getRandomTopic();
      setCurrentTopic(topic);
    }
  }, [currentTopic, setCurrentTopic]);

  // Timer effect using timestamp-based calculation
  useEffect(() => {
    let interval;
    if (isTimerRunning && timeRemaining > 0) {
      interval = setInterval(() => {
        if (timerEndTimeRef.current) {
          // Calculate time based on actual end time for accuracy
          const remaining = Math.max(0, Math.ceil((timerEndTimeRef.current - Date.now()) / 1000));
          setTimeRemaining(remaining);
        } else {
          // Fallback to decrement
          setTimeRemaining((prev) => prev - 1);
        }
      }, 1000);
    } else if (timeRemaining === 0 && isTimerRunning) {
      handleTimerEnd();
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timeRemaining, handleTimerEnd]);

  // Handle app state changes (backgrounding/foregrounding)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && timerEndTimeRef.current && isTimerRunning) {
        // App came back to foreground - recalculate time based on end time
        const remaining = Math.max(0, Math.ceil((timerEndTimeRef.current - Date.now()) / 1000));
        setTimeRemaining(remaining);
      }
    });

    return () => subscription.remove();
  }, [isTimerRunning]);

  const handleStartTimer = () => {
    tapHeavy(); // Strong haptic feedback for starting
    // Store the end time when timer starts
    timerEndTimeRef.current = Date.now() + timeLimit * 1000;
    // Reset the countdown - timeRemaining may still be 0 from a previous round,
    // which would otherwise trigger handleTimerEnd immediately
    setTimeRemaining(timeLimit);
    setIsTimerRunning(true);
  };

  const handleNewTopic = () => {
    tapLight();
    const topic = getRandomTopic();
    setCurrentTopic(topic);
  };

  const handleSkipToRating = () => {
    tapMedium();
    warning();
    Alert.alert('Skip Timer', 'Are you sure everyone is done drawing?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Skip',
        onPress: () => {
          setIsTimerRunning(false);
          timerEndTimeRef.current = null;
          // Use setTimeout to ensure state update completes before navigation
          setTimeout(() => {
            navigation.navigate('Rating');
          }, 50);
        },
      },
    ]);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Header with Round Info */}
      <View style={[styles.header, { backgroundColor: theme.cardBackground }]}>
        <Text style={[styles.roundBadge, { color: theme.primary }]}>
          ROUND {currentRound}/{numRounds}
        </Text>
      </View>

      {/* Topic Card */}
      <View
        style={[
          styles.topicContainer,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        <View style={[styles.topicIconCircle, { backgroundColor: theme.primary + '20' }]}>
          <Text style={styles.topicIcon}>🎨</Text>
        </View>
        <Text style={[styles.topicLabel, { color: theme.textSecondary }]}>Your Drawing Topic</Text>
        <Text style={[styles.topicText, { color: theme.text }]}>{currentTopic}</Text>

        {!isTimerRunning && (
          <TouchableOpacity
            style={[
              styles.newTopicButton,
              { backgroundColor: theme.background, borderColor: theme.border },
            ]}
            onPress={handleNewTopic}
          >
            <Text style={[styles.newTopicButtonText, { color: theme.primary }]}>🔄 New Topic</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Timer Display */}
      <View
        style={[
          styles.timerContainer,
          { backgroundColor: theme.cardBackground, borderColor: theme.border },
        ]}
      >
        {isTimerRunning ? (
          <TimerProgress seconds={timeRemaining} total={timeLimit} isRunning={isTimerRunning} />
        ) : (
          <>
            <Text style={[styles.timerText, { color: theme.primary }]}>
              {formatTime(timeRemaining)}
            </Text>
            <Text style={[styles.timerLabel, { color: theme.textSecondary }]}>
              ⏸️ Ready to Start
            </Text>
          </>
        )}
      </View>

      {!isTimerRunning ? (
        <TouchableOpacity
          style={[styles.startButton, { backgroundColor: theme.success }]}
          onPress={handleStartTimer}
        >
          <Text style={styles.startButtonText}>▶️ Start Timer</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.drawingInfo, { backgroundColor: theme.cardBackground }]}>
          <Text style={[styles.drawingInfoText, { color: theme.text }]}>
            ✏️ Everyone is drawing now!
          </Text>
          <Text style={[styles.drawingInfoSubtext, { color: theme.textSecondary }]}>
            Draw on paper and wait for the timer to end
          </Text>
        </View>
      )}

      {isTimerRunning && (
        <TouchableOpacity
          style={[styles.skipButton, { backgroundColor: theme.warning }]}
          onPress={handleSkipToRating}
        >
          <Text style={styles.skipButtonText}>⏭️ Skip to Rating</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  roundBadge: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 1.5,
  },
  topicContainer: {
    borderRadius: 24,
    padding: 36,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  topicIconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  topicIcon: {
    fontSize: 36,
  },
  topicLabel: {
    fontSize: 16,
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  topicText: {
    fontSize: 32,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 0.5,
    lineHeight: 40,
  },
  newTopicButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 2,
  },
  newTopicButtonText: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  timerContainer: {
    alignItems: 'center',
    marginBottom: 28,
    paddingVertical: 28,
    paddingHorizontal: 24,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1.5,
  },
  timerText: {
    fontSize: 80,
    fontWeight: '900',
    letterSpacing: 2,
  },
  timerTextWarning: {
    color: '#ef4444',
  },
  timerLabel: {
    fontSize: 18,
    marginTop: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  startButton: {
    padding: 22,
    borderRadius: 20,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  drawingInfo: {
    padding: 28,
    borderRadius: 20,
    alignItems: 'center',
  },
  drawingInfoText: {
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  drawingInfoSubtext: {
    fontSize: 17,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 24,
  },
  skipButton: {
    marginTop: 20,
    padding: 20,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  skipButtonText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
});
