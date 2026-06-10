/**
 * Mock implementation of @react-native-async-storage/async-storage
 * Provides an in-memory storage for testing
 */

// Use a getter/setter pattern to ensure the storage is accessible
const createMockStorage = () => {
  let storage = {};

  return {
    get data() {
      return storage;
    },
    set data(newData) {
      storage = newData;
    },
    reset() {
      storage = {};
    },
  };
};

const mockStorageInstance = createMockStorage();

const AsyncStorageMock = {
  getItem: jest.fn((key) => {
    const value = mockStorageInstance.data[key];
    return Promise.resolve(value !== undefined ? value : null);
  }),

  setItem: jest.fn((key, value) => {
    mockStorageInstance.data[key] = value;
    return Promise.resolve();
  }),

  removeItem: jest.fn((key) => {
    const newData = { ...mockStorageInstance.data };
    delete newData[key];
    mockStorageInstance.data = newData;
    return Promise.resolve();
  }),

  multiRemove: jest.fn((keys) => {
    const newData = { ...mockStorageInstance.data };
    keys.forEach((key) => delete newData[key]);
    mockStorageInstance.data = newData;
    return Promise.resolve();
  }),

  clear: jest.fn(() => {
    mockStorageInstance.reset();
    return Promise.resolve();
  }),

  getAllKeys: jest.fn(() => {
    return Promise.resolve(Object.keys(mockStorageInstance.data));
  }),

  multiGet: jest.fn((keys) => {
    return Promise.resolve(keys.map((key) => [key, mockStorageInstance.data[key] || null]));
  }),

  multiSet: jest.fn((keyValuePairs) => {
    const newData = { ...mockStorageInstance.data };
    keyValuePairs.forEach(([key, value]) => {
      newData[key] = value;
    });
    mockStorageInstance.data = newData;
    return Promise.resolve();
  }),

  // Helper methods for tests
  __resetMockStorage: () => {
    mockStorageInstance.reset();
  },

  __setMockStorage: (data) => {
    mockStorageInstance.data = { ...data };
  },

  __getMockStorage: () => ({ ...mockStorageInstance.data }),
};

export default AsyncStorageMock;
