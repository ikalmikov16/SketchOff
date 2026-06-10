/**
 * Mock implementation of Firebase services for testing
 */

// Mock data store for database
let mockDatabase = {};

// Mock current user
let mockCurrentUser = { uid: 'test-user-123' };

// Helper to set mock database state
export const __setMockDatabase = (data) => {
  mockDatabase = JSON.parse(JSON.stringify(data));
};

// Helper to get mock database state
export const __getMockDatabase = () => JSON.parse(JSON.stringify(mockDatabase));

// Helper to reset mock database
export const __resetMockDatabase = () => {
  mockDatabase = {};
};

// Helper to set current user
export const __setMockCurrentUser = (user) => {
  mockCurrentUser = user;
};

// Mock auth object
export const auth = {
  get currentUser() {
    return mockCurrentUser;
  },
};

// Mock database reference
export const database = {};

// Mock storage
export const storage = {};

// Mock getCurrentUserId
export const getCurrentUserId = jest.fn(() => {
  return mockCurrentUser?.uid || null;
});

// Mock signInAnonymouslyIfNeeded
export const signInAnonymouslyIfNeeded = jest.fn(() => {
  return Promise.resolve(mockCurrentUser);
});

// Mock firebase/database functions
export const mockRef = jest.fn((db, path) => ({ path }));
export const mockGet = jest.fn((refObj) => {
  const path = refObj.path;
  const parts = path.split('/').filter(Boolean);

  let value = mockDatabase;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      value = null;
      break;
    }
  }

  return Promise.resolve({
    exists: () => value !== null && value !== undefined,
    val: () => value,
  });
});

export const mockSet = jest.fn((refObj, data) => {
  const path = refObj.path;
  const parts = path.split('/').filter(Boolean);

  let current = mockDatabase;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = data;

  return Promise.resolve();
});

export const mockUpdate = jest.fn((refObj, data) => {
  const path = refObj.path;
  const parts = path.split('/').filter(Boolean);

  let current = mockDatabase;
  for (const part of parts) {
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  Object.assign(current, data);

  return Promise.resolve();
});

export const mockRemove = jest.fn((refObj) => {
  const path = refObj.path;
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    mockDatabase = {};
    return Promise.resolve();
  }

  let current = mockDatabase;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) {
      return Promise.resolve();
    }
    current = current[parts[i]];
  }
  delete current[parts[parts.length - 1]];

  return Promise.resolve();
});

export const mockOnValue = jest.fn((refObj, callback, errorCallback) => {
  // Simulate immediate callback with current value
  const path = refObj.path;
  const parts = path.split('/').filter(Boolean);

  let value = mockDatabase;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      value = null;
      break;
    }
  }

  // Call the callback asynchronously
  setTimeout(() => {
    callback({
      exists: () => value !== null && value !== undefined,
      val: () => value,
    });
  }, 0);

  // Return unsubscribe function
  return jest.fn();
});

// Re-export mock functions for firebase/database
jest.mock('firebase/database', () => ({
  ref: (...args) => require('./__tests__/__mocks__/firebase').mockRef(...args),
  get: (...args) => require('./__tests__/__mocks__/firebase').mockGet(...args),
  set: (...args) => require('./__tests__/__mocks__/firebase').mockSet(...args),
  update: (...args) => require('./__tests__/__mocks__/firebase').mockUpdate(...args),
  remove: (...args) => require('./__tests__/__mocks__/firebase').mockRemove(...args),
  onValue: (...args) => require('./__tests__/__mocks__/firebase').mockOnValue(...args),
  getDatabase: jest.fn(),
}));

// Mock firebase/storage
jest.mock('firebase/storage', () => ({
  ref: jest.fn(),
  uploadBytes: jest.fn(() => Promise.resolve({ ref: {} })),
  getDownloadURL: jest.fn(() => Promise.resolve('https://example.com/image.png')),
  getStorage: jest.fn(),
}));

// Mock firebase/auth
jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(),
  getReactNativePersistence: jest.fn(),
  browserLocalPersistence: {},
  onAuthStateChanged: jest.fn((auth, callback) => {
    callback({ uid: 'test-user-123' });
    return jest.fn();
  }),
  signInAnonymously: jest.fn(() => Promise.resolve({ user: { uid: 'test-user-123' } })),
}));

export default {
  auth,
  database,
  storage,
  getCurrentUserId,
  signInAnonymouslyIfNeeded,
};
