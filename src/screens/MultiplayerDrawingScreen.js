import * as FileSystem from 'expo-file-system/legacy';
import { onValue, ref, runTransaction, update } from 'firebase/database';
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
  uploadString,
} from 'firebase/storage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DrawingToolbar, { ERASER_COLOR } from '../components/DrawingToolbar';
import EnhancedDrawingCanvas from '../components/EnhancedDrawingCanvas';
import { LoadingOverlay, OfflineBanner } from '../components/NetworkStatus';
import { database, storage } from '../config/firebase';
import { useTheme } from '../context/ThemeContext';
import {
  BLANK_WHITE_PNG_BASE64,
  CANVAS_CAPTURE,
  DRAWING_CONFIG,
  MIN_VALID_DRAWING_LENGTH,
  MULTIPLAYER_CONFIG,
  TIMER_COLORS,
} from '../utils/constants';
import { error as hapticError, success, tapMedium, warning } from '../utils/haptics';
import { useNetworkStatus } from '../utils/network';
import {
  clearPresence,
  isPlayerConnected,
  isValidPlayer,
  registerPresence,
  removeGhostPlayers,
} from '../utils/presence';
import { playClockTickCountdown, playSuccess, stopClockTick } from '../utils/sounds';

/**
 * Helper to upload base64 image to Firebase Storage
 * Works reliably on both iOS and Android by writing to temp file first
 */
async function uploadBase64Image(base64Data, storageReference) {
  // expo-file-system is unavailable on web, but the browser can decode base64 natively
  if (Platform.OS === 'web') {
    await uploadString(storageReference, base64Data, 'base64', { contentType: 'image/png' });
    return getDownloadURL(storageReference);
  }

  // Write base64 to temporary file
  const tempPath = `${FileSystem.cacheDirectory}temp_drawing_${Date.now()}.png`;

  try {
    await FileSystem.writeAsStringAsync(tempPath, base64Data, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Read file as blob-compatible format and upload
    const response = await fetch(tempPath);
    const blob = await response.blob();

    // Upload with resumable to handle network issues better
    const uploadTask = uploadBytesResumable(storageReference, blob, {
      contentType: 'image/png',
    });

    // Wait for upload to complete
    await uploadTask;

    // Get download URL
    const downloadURL = await getDownloadURL(storageReference);

    // Clean up temp file
    await FileSystem.deleteAsync(tempPath, { idempotent: true });

    return downloadURL;
  } catch (error) {
    // Clean up temp file on error
    await FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
    throw error;
  }
}

export default function MultiplayerDrawingScreen({ route, navigation }) {
  const { roomCode, playerId, playerName } = route.params;
  const { theme } = useTheme();
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const canvasRef = useRef(null);

  const [topic, setTopic] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [currentRound, setCurrentRound] = useState(1);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedPlayers, setSubmittedPlayers] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [totalPlayers, setTotalPlayers] = useState(0);

  // Drawing toolbar state
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [isEraser, setIsEraser] = useState(false);
  const [currentStrokeColor, setCurrentStrokeColor] = useState('#000000');

  // Force stroke end state - disables canvas to commit any in-progress stroke
  const [forceStrokeEnd, setForceStrokeEnd] = useState(false);

  // Memoize stroke width to prevent unnecessary canvas re-renders
  const strokeWidth = useMemo(
    () => (isEraser ? DRAWING_CONFIG.ERASER_STROKE_WIDTH : DRAWING_CONFIG.PEN_STROKE_WIDTH),
    [isEraser]
  );

  // Intro animation state
  const [showIntro, setShowIntro] = useState(true);
  const [introAnimationDone, setIntroAnimationDone] = useState(false);
  const [introCountdown, setIntroCountdown] = useState(3);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const introOpacity = useRef(new Animated.Value(1)).current;
  const introPulse = useRef(new Animated.Value(1)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // Timer initialization ref to prevent double-start bug
  const timerInitialized = useRef(false);

  // Store the drawing end time from Firebase for accurate time sync
  const drawingEndTimeRef = useRef(null);

  // Store the last captured canvas data so it's available during auto-submit
  const lastCanvasDataRef = useRef(null);

  // Lock to prevent concurrent canvas captures (fixes race condition)
  const captureInProgressRef = useRef(false);

  // Called when user finishes a stroke (lifts finger) - triggers a capture
  const handleDrawEnd = useCallback(() => {
    // Capture immediately after stroke ends to get the latest state
    if (canvasRef.current && !captureInProgressRef.current) {
      captureInProgressRef.current = true;
      canvasRef.current
        .toBase64(CANVAS_CAPTURE.FORMAT, CANVAS_CAPTURE.QUALITY)
        .then((base64) => {
          if (base64 && base64.length > MIN_VALID_DRAWING_LENGTH) {
            lastCanvasDataRef.current = base64;
          }
        })
        .catch(() => {})
        .finally(() => {
          captureInProgressRef.current = false;
        });
    }
  }, []);

  // Helper function to safely capture canvas with lock
  const captureCanvas = useCallback(async () => {
    // Skip if capture already in progress or canvas not ready
    if (captureInProgressRef.current || !canvasRef.current) {
      return lastCanvasDataRef.current;
    }

    captureInProgressRef.current = true;
    try {
      const base64 = await canvasRef.current.toBase64(
        CANVAS_CAPTURE.FORMAT,
        CANVAS_CAPTURE.QUALITY
      );
      if (base64 && base64.length > MIN_VALID_DRAWING_LENGTH) {
        lastCanvasDataRef.current = base64;
        return base64;
      }
    } catch (_e) {
      // Silent fail - return last known good capture
    } finally {
      captureInProgressRef.current = false;
    }
    return lastCanvasDataRef.current;
  }, []);

  // Periodically capture the canvas while drawing for backup
  useEffect(() => {
    if (Platform.OS === 'web' || showIntro || hasSubmitted) return;

    const captureInterval = setInterval(() => {
      if (!hasSubmitted && !isSubmitting) {
        captureCanvas();
      }
    }, CANVAS_CAPTURE.INTERVAL_MS);

    return () => clearInterval(captureInterval);
  }, [showIntro, hasSubmitted, isSubmitting, captureCanvas]);

  // Track our presence so other clients stop waiting on us if we drop
  useEffect(() => {
    registerPresence(roomCode, playerId);
  }, [roomCode, playerId]);

  // Advance to rating once every *connected* player has submitted.
  // Runs in a transaction so concurrent checks from multiple clients can't
  // double-fire, and so a player disconnecting mid-round can't stall the game.
  const checkAllSubmitted = useCallback(async () => {
    try {
      const roomRef = ref(database, `rooms/${roomCode}`);
      await runTransaction(roomRef, (roomData) => {
        // Local cache miss - return as-is so Firebase refetches and reruns
        if (!roomData) return roomData;
        if (roomData.status !== 'drawing') return undefined;

        const round = roomData.currentRound || 1;
        const roundDrawings = roomData.drawings?.[`round${round}`] || {};
        if (Object.keys(roundDrawings).length === 0) return undefined;

        // Only wait for players who are still connected (players without a
        // connected flag - old clients - are treated as connected)
        const pending = Object.values(roomData.players || {}).filter(
          (p) => isValidPlayer(p) && !roundDrawings[p.id] && isPlayerConnected(p)
        );
        if (pending.length > 0) return undefined;

        removeGhostPlayers(roomData);
        roomData.status = 'rating';
        roomData.lastActivity = Date.now();
        return roomData;
      });
    } catch (error) {
      console.error('Error checking submissions:', error);
    }
  }, [roomCode]);

  // Last-resort fallback: if the drawing timer expired a while ago and the
  // round still hasn't advanced (e.g. a player dropped without the presence
  // flag updating), any client may force the round forward.
  const forceAdvanceIfStale = useCallback(async () => {
    try {
      const roomRef = ref(database, `rooms/${roomCode}`);
      await runTransaction(roomRef, (roomData) => {
        if (!roomData) return roomData;
        if (roomData.status !== 'drawing') return undefined;
        if (!roomData.drawingEndTime) return undefined;
        if (Date.now() < roomData.drawingEndTime + MULTIPLAYER_CONFIG.ROUND_ADVANCE_GRACE_MS) {
          return undefined;
        }

        const round = roomData.currentRound || 1;
        const roundDrawings = roomData.drawings?.[`round${round}`] || {};
        if (Object.keys(roundDrawings).length === 0) return undefined;

        removeGhostPlayers(roomData);
        roomData.status = 'rating';
        roomData.lastActivity = Date.now();
        return roomData;
      });
    } catch (error) {
      console.error('Error force-advancing round:', error);
    }
  }, [roomCode]);

  // While waiting for others, periodically check the stale-round fallback
  useEffect(() => {
    if (!hasSubmitted) return;

    const interval = setInterval(forceAdvanceIfStale, 5000);
    return () => clearInterval(interval);
  }, [hasSubmitted, forceAdvanceIfStale]);

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
        setTopic(roomData.currentTopic || '');
        setCurrentRound(roomData.currentRound || 1);
        const roomTimeLimit = roomData.settings.timeLimit;

        const playersList = Object.values(roomData.players || {}).filter(isValidPlayer);
        setTotalPlayers(playersList.length);
        setAllPlayers(playersList);

        // Get drawings for current round
        const round = roomData.currentRound || 1;
        const roundDrawings = roomData.drawings?.[`round${round}`] || {};
        const submittedIds = Object.keys(roundDrawings);
        const submitted = playersList.filter((p) => submittedIds.includes(p.id)).map((p) => p.name);
        setSubmittedPlayers(submitted);

        // If we've submitted and everyone still connected has too (e.g. a
        // pending player just went offline), try to advance the round.
        // The transaction inside makes this idempotent across clients.
        if (roomData.status === 'drawing' && roundDrawings[playerId]) {
          const pendingActive = playersList.filter(
            (p) => !roundDrawings[p.id] && isPlayerConnected(p)
          );
          if (pendingActive.length === 0) {
            checkAllSubmitted();
          }
        }

        // Initialize timer with the room's time limit setting
        // We use the fixed timeLimit rather than calculating from drawingEndTime
        // to avoid clock skew issues between devices (different Date.now() values)
        if (!timerInitialized.current && (roomData.drawingEndTime || roomData.drawingStartTime)) {
          timerInitialized.current = true;
          // Store the server's end time for background/foreground sync
          const endTime =
            roomData.drawingEndTime || roomData.drawingStartTime + roomTimeLimit * 1000;
          drawingEndTimeRef.current = endTime;

          // Check if player is joining late (more than 5 seconds after drawing started)
          // In this case, we need to calculate remaining time to stay in sync
          const elapsedSinceStart = Date.now() - roomData.drawingStartTime;
          const introAndBufferTime = 5000; // ~5 seconds for intro animation + buffer

          if (elapsedSinceStart > introAndBufferTime) {
            // Late joiner - calculate remaining time from elapsed
            const remainingTime = Math.max(0, roomTimeLimit - Math.floor(elapsedSinceStart / 1000));
            setTimeRemaining(remainingTime);
          } else {
            // Normal join - show exact time limit, countdown starts after intro
            setTimeRemaining(roomTimeLimit);
          }
        }

        if (roomData.status === 'rating') {
          stopClockTick(); // Stop any playing clock tick sound
          navigation.replace('MultiplayerRating', { roomCode, playerId, playerName });
        }
      },
      (error) => {
        console.error('Firebase error:', error);
        Alert.alert('Connection Error', 'Lost connection to the game.');
      }
    );

    // Use the unsubscribe function returned by onValue instead of off()
    return () => unsubscribe();
  }, [roomCode, playerId, navigation, playerName, checkAllSubmitted]);

  // Only start the drawing timer after intro animation is complete
  // Uses simple decrement to avoid clock skew issues between devices
  useEffect(() => {
    if (timeRemaining === 0 || !introAnimationDone) return;

    const timer = setInterval(() => {
      // Simple decrement - avoids clock skew issues between devices
      // Server time (drawingEndTimeRef) is only used for background/foreground recovery
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining, introAnimationDone]);

  // Handle app state changes (backgrounding/foregrounding)
  // Recalculate timer when app comes back to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        nextAppState === 'active' &&
        drawingEndTimeRef.current &&
        introAnimationDone &&
        !hasSubmitted
      ) {
        // App came back to foreground - recalculate time based on end time
        const remaining = Math.max(0, Math.ceil((drawingEndTimeRef.current - Date.now()) / 1000));
        setTimeRemaining(remaining);
      }
    });

    return () => subscription.remove();
  }, [introAnimationDone, hasSubmitted]);

  // Handle time up - wrapped in useCallback to avoid stale closures
  const handleTimeUp = useCallback(async () => {
    if (hasSubmitted || isSubmitting) return;
    if (!isConnected) return;

    setIsSubmitting(true);

    try {
      let downloadURL;
      let isPlaceholder = false;

      // On native platforms, capture the canvas
      if (Platform.OS !== 'web') {
        let base64 = null;

        // Small delay to ensure any stroke has been committed after canvas was disabled
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Try to capture the canvas
        if (canvasRef.current) {
          try {
            base64 = await canvasRef.current.toBase64(
              CANVAS_CAPTURE.FORMAT,
              CANVAS_CAPTURE.QUALITY
            );
          } catch (e) {
            console.warn('Canvas capture failed:', e.message);
          }
        }

        // Fall back to the periodic backup if capture failed or got less content
        if (!base64 || base64.length < MIN_VALID_DRAWING_LENGTH) {
          base64 = lastCanvasDataRef.current;
        } else if (lastCanvasDataRef.current && lastCanvasDataRef.current.length > base64.length) {
          // If the periodic backup has more content, use it instead
          base64 = lastCanvasDataRef.current;
        }

        // Upload if we have valid base64
        if (base64 && base64.length > MIN_VALID_DRAWING_LENGTH) {
          try {
            const drawingRef = storageRef(
              storage,
              `drawings/${roomCode}/${playerId}_round${currentRound}.png`
            );
            downloadURL = await uploadBase64Image(base64, drawingRef);
          } catch (uploadError) {
            console.error('Auto-submit upload failed:', uploadError);
          }
        }
      }

      // If no drawing captured (web or empty canvas), submit blank white canvas
      if (!downloadURL) {
        try {
          const drawingRef = storageRef(
            storage,
            `drawings/${roomCode}/${playerId}_round${currentRound}.png`
          );
          downloadURL = await uploadBase64Image(BLANK_WHITE_PNG_BASE64, drawingRef);
          isPlaceholder = true;
        } catch (uploadError) {
          console.error('Auto-submit: failed to upload placeholder:', uploadError);
        }
      }

      // Only update database if we have a valid URL
      if (downloadURL) {
        await update(ref(database, `rooms/${roomCode}/drawings/round${currentRound}/${playerId}`), {
          url: downloadURL,
          submittedAt: Date.now(),
          ...(isPlaceholder && { isPlaceholder: true }),
        });

        setHasSubmitted(true);
        setIsSubmitting(false);
        success();
        playSuccess();

        // Check if all players have submitted
        checkAllSubmitted();
      } else {
        // Upload completely failed - show error to user
        console.error('Auto-submit: All upload attempts failed');
        setIsSubmitting(false);
        hapticError();
        Alert.alert(
          'Upload Failed',
          'Could not submit your drawing due to network issues. Please check your connection and try again.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error auto-submitting drawing:', error);
      setIsSubmitting(false);
      hapticError();
    }
  }, [
    hasSubmitted,
    isSubmitting,
    isConnected,
    roomCode,
    playerId,
    currentRound,
    checkAllSubmitted,
  ]);

  // Handle time up separately
  useEffect(() => {
    if (timeRemaining === 0 && introAnimationDone && !hasSubmitted && !isSubmitting) {
      handleTimeUp();
    }
  }, [timeRemaining, introAnimationDone, hasSubmitted, isSubmitting, handleTimeUp]);

  // Force stroke to end ~500ms before timer hits 0
  // Disabling pointer events interrupts the touch, which should commit any in-progress stroke
  useEffect(() => {
    if (!introAnimationDone || hasSubmitted || forceStrokeEnd) return;

    if (timeRemaining === 1) {
      // Wait 500ms (so ~500ms remaining), then disable canvas and capture
      const timer = setTimeout(() => {
        if (hasSubmitted) return;

        // Disable canvas
        setForceStrokeEnd(true);

        // Capture 200ms later to let stroke commit
        setTimeout(async () => {
          if (canvasRef.current) {
            try {
              const base64 = await canvasRef.current.toBase64(
                CANVAS_CAPTURE.FORMAT,
                CANVAS_CAPTURE.QUALITY
              );
              if (base64 && base64.length > MIN_VALID_DRAWING_LENGTH) {
                lastCanvasDataRef.current = base64;
              }
            } catch (e) {
              console.warn('Failed to capture after disable:', e.message);
            }
          }
        }, 200);
      }, 500); // Disable at ~500ms before 0

      return () => clearTimeout(timer);
    }
  }, [timeRemaining, introAnimationDone, hasSubmitted, forceStrokeEnd]);

  // Haptic and sound feedback at key timer moments
  useEffect(() => {
    if (!introAnimationDone) return;

    // Feedback at specific time milestones
    if (timeRemaining === 30) {
      warning(); // Light warning at 30 seconds
    } else if (timeRemaining === 10) {
      // Start clock tick countdown at 10 seconds - plays continuously
      tapMedium();
      playClockTickCountdown();
    } else if (timeRemaining === 0) {
      // Stop clock tick when time runs out
      stopClockTick();
    }
  }, [timeRemaining, introAnimationDone]);

  // Intro countdown timer
  useEffect(() => {
    if (topic && showIntro && !introAnimationDone && introCountdown > 0) {
      const countdownTimer = setInterval(() => {
        setIntroCountdown((prev) => prev - 1);
      }, 800);

      return () => clearInterval(countdownTimer);
    }
  }, [topic, showIntro, introAnimationDone, introCountdown]);

  // Intro animation - show prompt then animate to top
  useEffect(() => {
    if (topic && showIntro && !introAnimationDone) {
      // Start a gentle pulse animation on the topic
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(introPulse, {
            toValue: 1.05,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(introPulse, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulseLoop.start();

      return () => {
        pulseLoop.stop();
      };
    }
  }, [topic, showIntro, introAnimationDone, introPulse]);

  // Animate out when countdown reaches 0 - Simple fade transition
  useEffect(() => {
    if (introCountdown === 0 && showIntro && !introAnimationDone) {
      // Simple fade out the intro
      Animated.timing(introOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowIntro(false);
        setIntroAnimationDone(true);
        // Fade in header and content from top down
        Animated.stagger(100, [
          Animated.timing(headerOpacity, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }
  }, [introCountdown, showIntro, introAnimationDone, introOpacity, headerOpacity, contentOpacity]);

  // Pulse animation for timer when <= 10 seconds
  useEffect(() => {
    if (timeRemaining <= 10 && timeRemaining > 0 && !showIntro) {
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [timeRemaining, showIntro, pulseAnim]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleColorChange = (color) => {
    setSelectedColor(color);
    setIsEraser(false);
    setCurrentStrokeColor(color);
  };

  const handlePenSelect = () => {
    setIsEraser(false);
    setCurrentStrokeColor(selectedColor);
  };

  const handleEraserToggle = () => {
    setIsEraser(true);
    setCurrentStrokeColor(ERASER_COLOR);
  };

  const handleUndo = () => {
    canvasRef.current?.undo();
  };

  const handleClear = () => {
    warning();
    Alert.alert('Clear Drawing', 'Are you sure you want to clear your drawing?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => canvasRef.current?.reset(),
      },
    ]);
  };

  const submitPlaceholder = async (isAutoSubmit = false) => {
    if (hasSubmitted || isSubmitting) return;

    if (!isConnected) {
      if (!isAutoSubmit) Alert.alert('Offline', 'Please check your internet connection.');
      return;
    }

    setIsSubmitting(true);

    try {
      const drawingRef = storageRef(
        storage,
        `drawings/${roomCode}/${playerId}_round${currentRound}.png`
      );
      const downloadURL = await uploadBase64Image(BLANK_WHITE_PNG_BASE64, drawingRef);

      await update(ref(database, `rooms/${roomCode}/drawings/round${currentRound}/${playerId}`), {
        url: downloadURL,
        submittedAt: Date.now(),
        isPlaceholder: true,
      });

      setHasSubmitted(true);
      setIsSubmitting(false);
      checkAllSubmitted();
    } catch (error) {
      console.error('Error submitting placeholder:', error);
      setIsSubmitting(false);
      if (!isAutoSubmit) Alert.alert('Error', 'Failed to submit. Please try again.');
    }
  };

  const handleSubmitDrawing = async (base64Data = null) => {
    if (hasSubmitted || isSubmitting) return;

    if (Platform.OS === 'web') {
      Alert.alert('Drawing Not Available', 'Drawing is not supported on web.');
      return;
    }

    if (!isConnected) {
      Alert.alert('Offline', 'Please check your internet connection.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Use provided data or capture from canvas using our synchronized helper
      let base64 = base64Data || (await captureCanvas());

      // If still no drawing, use blank white canvas
      if (!base64 || base64.length < MIN_VALID_DRAWING_LENGTH) {
        try {
          const drawingRef = storageRef(
            storage,
            `drawings/${roomCode}/${playerId}_round${currentRound}.png`
          );
          const downloadURL = await uploadBase64Image(BLANK_WHITE_PNG_BASE64, drawingRef);

          await update(
            ref(database, `rooms/${roomCode}/drawings/round${currentRound}/${playerId}`),
            {
              url: downloadURL,
              submittedAt: Date.now(),
              isPlaceholder: true,
            }
          );

          setHasSubmitted(true);
          setIsSubmitting(false);
          success();
          playSuccess();
          checkAllSubmitted();
          return;
        } catch (uploadError) {
          console.error('Manual submit: failed to upload placeholder:', uploadError);
          throw uploadError;
        }
      }

      const drawingRef = storageRef(
        storage,
        `drawings/${roomCode}/${playerId}_round${currentRound}.png`
      );
      const downloadURL = await uploadBase64Image(base64, drawingRef);

      await update(ref(database, `rooms/${roomCode}/drawings/round${currentRound}/${playerId}`), {
        url: downloadURL,
        submittedAt: Date.now(),
      });

      setHasSubmitted(true);
      setIsSubmitting(false);
      success();
      playSuccess();
      checkAllSubmitted();
    } catch (error) {
      console.error('Error uploading drawing:', error);
      setIsSubmitting(false);
      hapticError();
      Alert.alert('Error', 'Failed to submit drawing. Please try again.');
    }
  };

  const handleSkipDrawing = async () => {
    await submitPlaceholder(false);
  };

  // Confirm before submitting early
  const confirmSubmitDrawing = () => {
    tapMedium();
    Alert.alert(
      'Submit Drawing?',
      'Are you sure you want to submit your drawing? You still have time remaining.',
      [
        { text: 'Keep Drawing', style: 'cancel' },
        {
          text: 'Submit',
          style: 'default',
          onPress: () => handleSubmitDrawing(),
        },
      ]
    );
  };

  // Submitted waiting view (check this first so it works on all platforms including web)
  if (hasSubmitted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.waitingContainer, { backgroundColor: theme.cardBackground }]}>
          <Text style={styles.waitingIcon}>✅</Text>
          <Text style={[styles.waitingTitle, { color: theme.success }]}>Drawing Submitted!</Text>
          <Text style={[styles.waitingSubtext, { color: theme.textSecondary }]}>
            Waiting for others... ({submittedPlayers.length}/{totalPlayers})
          </Text>

          <ScrollView style={styles.playerStatusList} showsVerticalScrollIndicator={false}>
            {allPlayers.map((player) => {
              const hasPlayerSubmitted = submittedPlayers.includes(player.name);
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
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  // Time's up view
  if (timeRemaining === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.timeUpContainer, { backgroundColor: theme.cardBackground }]}>
          <Text style={styles.timeUpIcon}>⏰</Text>
          <Text style={[styles.timeUpTitle, { color: theme.warning }]}>Time&apos;s Up!</Text>
          <Text style={[styles.timeUpSubtext, { color: theme.textSecondary }]}>
            Submitting your drawing...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Web not supported view (after hasSubmitted check so waiting view shows after skip)
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <OfflineBanner visible={!isConnected} />
        <View style={styles.webNotSupported}>
          <Text style={styles.webNotSupportedIcon}>🎨</Text>
          <Text style={[styles.webNotSupportedTitle, { color: theme.text }]}>
            Drawing Not Available on Web
          </Text>
          <Text style={[styles.webNotSupportedText, { color: theme.textSecondary }]}>
            Please use the mobile app (iOS/Android) to draw.
          </Text>
          <TouchableOpacity
            style={[styles.webSkipButton, { backgroundColor: theme.primary }]}
            onPress={handleSkipDrawing}
            disabled={!isConnected || isSubmitting}
          >
            <Text style={styles.webSkipButtonText}>
              {isSubmitting ? 'Submitting...' : '⏭️ Skip Round'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Timer color based on urgency
  const getTimerColor = () => {
    if (timeRemaining <= 10) return TIMER_COLORS.CRITICAL;
    if (timeRemaining <= 30) return TIMER_COLORS.WARNING;
    return theme.primary;
  };

  // Main drawing view
  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      <OfflineBanner visible={!isConnected} />
      <LoadingOverlay visible={isSubmitting} message="Submitting drawing..." />

      {/* Intro Overlay - shows prompt centered before animating to header */}
      {showIntro && (
        <Animated.View
          style={[
            styles.introOverlay,
            {
              paddingTop: insets.top,
              opacity: introOpacity,
            },
          ]}
        >
          <View style={styles.introContent}>
            <Text style={styles.introLabel}>DRAW</Text>
            <Animated.Text style={[styles.introTopic, { transform: [{ scale: introPulse }] }]}>
              {topic}
            </Animated.Text>
            <View style={styles.introPulseContainer}>
              <View style={styles.countdownCircle}>
                <Text style={styles.countdownNumber}>
                  {introCountdown > 0 ? introCountdown : '🎨'}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>
      )}

      {/* Header: Topic + Timer - with safe area padding */}
      <Animated.View
        style={[
          styles.header,
          {
            backgroundColor: theme.cardBackground,
            borderColor: theme.border,
            paddingTop: insets.top + 10,
            opacity: headerOpacity,
          },
        ]}
      >
        {/* Topic on left, Timer on right */}
        <View style={styles.topicContainer}>
          <Text style={[styles.topicText, { color: theme.text }]} numberOfLines={2}>
            {topic}
          </Text>
          {submittedPlayers.length > 0 && (
            <Text style={[styles.submitProgressText, { color: theme.textSecondary }]}>
              {submittedPlayers.length}/{totalPlayers} finished
            </Text>
          )}
        </View>

        <Animated.View
          style={[
            styles.timerContainer,
            { backgroundColor: getTimerColor() },
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Text style={styles.timerText}>{formatTime(timeRemaining)}</Text>
        </Animated.View>
      </Animated.View>

      {/* Toolbar */}
      <Animated.View style={{ opacity: contentOpacity }}>
        <DrawingToolbar
          selectedColor={selectedColor}
          onColorChange={handleColorChange}
          isEraser={isEraser}
          onEraserToggle={handleEraserToggle}
          onPenSelect={handlePenSelect}
          onUndo={handleUndo}
          disabled={isSubmitting || showIntro}
        />
      </Animated.View>

      {/* Canvas with floating buttons - full width, no margins */}
      <Animated.View style={[styles.canvasWrapper, { opacity: contentOpacity }]}>
        <View style={styles.canvasContainer} pointerEvents={forceStrokeEnd ? 'none' : 'auto'}>
          <EnhancedDrawingCanvas
            ref={canvasRef}
            strokeColor={currentStrokeColor}
            strokeWidth={strokeWidth}
            backgroundColor="#FFFFFF"
            isEraser={isEraser}
            onDrawEnd={handleDrawEnd}
          />
        </View>

        {/* Floating Clear Button - Bottom Left */}
        <TouchableOpacity
          style={[
            styles.floatingButton,
            styles.floatingButtonLeft,
            styles.clearButton,
            { bottom: Math.max(insets.bottom, 16) + 8 },
          ]}
          onPress={handleClear}
          disabled={isSubmitting || showIntro}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Clear drawing"
        >
          <Text style={styles.clearButtonText}>↺</Text>
        </TouchableOpacity>

        {/* Floating Submit Button - Bottom Right */}
        <TouchableOpacity
          style={[
            styles.floatingButton,
            styles.floatingButtonRight,
            { backgroundColor: theme.success, bottom: Math.max(insets.bottom, 16) + 8 },
            (!isConnected || isSubmitting || showIntro) && styles.buttonDisabled,
          ]}
          onPress={confirmSubmitDrawing}
          disabled={!isConnected || isSubmitting || showIntro}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Submit drawing"
        >
          <Text style={styles.floatingButtonIcon}>✓</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Header styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  topicContainer: {
    flex: 1,
    marginRight: 12,
  },
  topicText: {
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  submitProgressText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  timerContainer: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 70,
    alignItems: 'center',
  },
  timerText: {
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    color: '#FFFFFF',
  },
  // Canvas styles
  canvasWrapper: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#FFFFFF',
  },
  canvasContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  // Floating buttons
  floatingButton: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  floatingButtonLeft: {
    left: 20,
  },
  floatingButtonRight: {
    right: 20,
  },
  floatingButtonIcon: {
    fontSize: 22,
    color: '#fff',
  },
  clearButton: {
    backgroundColor: '#e74c3c',
  },
  clearButtonText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  // Web not supported styles
  webNotSupported: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  webNotSupportedIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  webNotSupportedTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  webNotSupportedText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  webSkipButton: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
  },
  webSkipButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  // Waiting styles
  waitingContainer: {
    flex: 1,
    margin: 20,
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingIcon: {
    fontSize: 64,
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
    marginBottom: 20,
  },
  playerStatusList: {
    width: '100%',
    maxHeight: 200,
  },
  playerStatusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  playerStatusIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  playerStatusName: {
    fontSize: 15,
    fontWeight: '600',
  },
  // Time up styles
  timeUpContainer: {
    flex: 1,
    margin: 20,
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeUpIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  timeUpTitle: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 8,
  },
  timeUpSubtext: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Intro overlay styles
  introOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  introContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  introLabel: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 4,
    color: '#8b8b9e',
  },
  introTopic: {
    fontSize: 38,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 48,
    marginBottom: 24,
    color: '#FFFFFF',
  },
  introPulseContainer: {
    marginTop: 32,
  },
  countdownCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#6c5ce7',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(108, 92, 231, 0.15)',
  },
  countdownNumber: {
    fontSize: 38,
    fontWeight: '900',
    color: '#a29bfe',
  },
});
