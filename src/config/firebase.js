import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getReactNativePersistence,
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

// Firebase configuration from environment variables
// In Expo, use EXPO_PUBLIC_ prefix for client-side env vars
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication with platform-specific persistence
let auth;
if (Platform.OS === 'web') {
  // Web uses browser persistence
  auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
  });
} else {
  // Native (iOS/Android) uses AsyncStorage
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
}

export { auth };

// Initialize Realtime Database and get a reference to the service
export const database = getDatabase(app);

// Initialize Cloud Storage and get a reference to the service
export const storage = getStorage(app);

// Sign in anonymously (for production - ensures user is authenticated)
// Call this when the app starts
export const signInAnonymouslyIfNeeded = async () => {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Immediately unsubscribe to prevent memory leak
      unsubscribe();

      if (user) {
        // User is already signed in
        resolve(user);
      } else {
        // Sign in anonymously
        try {
          const result = await signInAnonymously(auth);
          resolve(result.user);
        } catch (error) {
          console.error('Firebase auth failed:', error.code, error.message);
          reject(error);
        }
      }
    });
  });
};

// Ensure the user is signed in, retrying anonymous auth if the initial
// app-start sign-in failed (e.g. first launch while offline).
// Returns the signed-in user or throws.
export const ensureSignedIn = async () => {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  const result = await signInAnonymously(auth);
  return result.user;
};

// Get current user ID (useful for rules)
export const getCurrentUserId = () => {
  return auth.currentUser?.uid || null;
};

export default app;
