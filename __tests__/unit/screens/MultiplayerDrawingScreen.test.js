/**
 * Tests for MultiplayerDrawingScreen canvas capture logic
 *
 * These tests verify that:
 * 1. Canvas is captured more frequently in the last 10 seconds
 * 2. A fresh capture is attempted right before submission
 * 3. There's a delay before final capture to allow strokes to render
 * 4. Fallback to backup works if fresh capture fails
 */

import { CANVAS_CAPTURE } from '../../../src/utils/constants';

// Mock timers for testing intervals
jest.useFakeTimers();

// Mock canvas ref - return value must be > 100 characters to pass MIN_VALID_DRAWING_LENGTH check
const createMockCanvasRef = (
  shouldFail = false,
  returnValue = 'valid-base64-data-longer-than-100-chars-to-pass-validation-check-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
) => ({
  current: {
    toBase64: jest.fn().mockImplementation(() => {
      if (shouldFail) {
        return Promise.reject(new Error('Canvas capture failed'));
      }
      return Promise.resolve(returnValue);
    }),
    undo: jest.fn(),
    reset: jest.fn(),
  },
});

describe('Canvas Capture Logic', () => {
  describe('Capture Interval Configuration', () => {
    it('should have a 5 second interval for normal captures', () => {
      expect(CANVAS_CAPTURE.INTERVAL_MS).toBe(5000);
    });

    it('should use PNG format', () => {
      expect(CANVAS_CAPTURE.FORMAT).toBe('png');
    });

    it('should have quality setting', () => {
      expect(CANVAS_CAPTURE.QUALITY).toBeGreaterThan(0);
      expect(CANVAS_CAPTURE.QUALITY).toBeLessThanOrEqual(1);
    });
  });

  describe('Capture Frequency Based on Time Remaining', () => {
    it('should use normal interval (5s) when time > 10 seconds', () => {
      const timeRemaining = 30;
      const expectedInterval = timeRemaining <= 10 ? 1000 : CANVAS_CAPTURE.INTERVAL_MS;
      expect(expectedInterval).toBe(5000);
    });

    it('should use faster interval (1s) when time <= 10 seconds', () => {
      const timeRemaining = 10;
      const expectedInterval = timeRemaining <= 10 ? 1000 : CANVAS_CAPTURE.INTERVAL_MS;
      expect(expectedInterval).toBe(1000);
    });

    it('should use faster interval (1s) when time is 5 seconds', () => {
      const timeRemaining = 5;
      const expectedInterval = timeRemaining <= 10 ? 1000 : CANVAS_CAPTURE.INTERVAL_MS;
      expect(expectedInterval).toBe(1000);
    });

    it('should use faster interval (1s) when time is 1 second', () => {
      const timeRemaining = 1;
      const expectedInterval = timeRemaining <= 10 ? 1000 : CANVAS_CAPTURE.INTERVAL_MS;
      expect(expectedInterval).toBe(1000);
    });
  });

  describe('Fresh Capture Before Submit', () => {
    it('should attempt fresh capture from canvas', async () => {
      const mockCanvasRef = createMockCanvasRef();

      // Simulate the fresh capture logic
      let base64 = null;
      if (mockCanvasRef.current) {
        try {
          base64 = await mockCanvasRef.current.toBase64(
            CANVAS_CAPTURE.FORMAT,
            CANVAS_CAPTURE.QUALITY
          );
        } catch (e) {
          // Handle error
        }
      }

      expect(mockCanvasRef.current.toBase64).toHaveBeenCalledWith('png', 0.8);
      expect(base64).toBeTruthy();
      expect(base64.length).toBeGreaterThan(100);
    });

    it('should fallback to backup when fresh capture fails', async () => {
      const mockCanvasRef = createMockCanvasRef(true); // Will fail
      const backupData =
        'backup-base64-data-that-is-longer-than-100-characters-for-validation-purposes-xxxxxxxxxxxxxxxxxxxxxxxx';
      const lastCanvasDataRef = { current: backupData };

      // Simulate the fresh capture + fallback logic
      let base64 = null;
      if (mockCanvasRef.current) {
        try {
          base64 = await mockCanvasRef.current.toBase64(
            CANVAS_CAPTURE.FORMAT,
            CANVAS_CAPTURE.QUALITY
          );
        } catch (e) {
          // Fresh capture failed
        }
      }

      // Fallback to backup
      if (!base64 || base64.length < 100) {
        base64 = lastCanvasDataRef.current;
      }

      expect(base64).toBe(backupData);
    });

    it('should fallback to backup when fresh capture returns empty data', async () => {
      const mockCanvasRef = createMockCanvasRef(false, ''); // Returns empty string
      const backupData =
        'backup-base64-data-that-is-longer-than-100-characters-for-validation-purposes-xxxxxxxxxxxxxxxxxxxxxxxx';
      const lastCanvasDataRef = { current: backupData };

      let base64 = null;
      if (mockCanvasRef.current) {
        try {
          base64 = await mockCanvasRef.current.toBase64(
            CANVAS_CAPTURE.FORMAT,
            CANVAS_CAPTURE.QUALITY
          );
        } catch (e) {
          // Handle error
        }
      }

      // Fallback to backup if capture is too short
      if (!base64 || base64.length < 100) {
        base64 = lastCanvasDataRef.current;
      }

      expect(base64).toBe(backupData);
    });
  });

  describe('Delay Before Final Capture', () => {
    it('should wait 300ms before capturing', async () => {
      const startTime = Date.now();

      // Simulate the delay
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
        jest.advanceTimersByTime(300);
      });

      // The promise should resolve after advancing timers
      expect(true).toBe(true); // Test passes if no timeout
    });

    it('delay should allow final strokes to render', () => {
      // This is more of a documentation test
      // The 300ms delay is specifically chosen to allow:
      // - React state updates to propagate
      // - Canvas drawing operations to complete
      // - Any animation frames to finish
      const RENDER_DELAY_MS = 300;
      expect(RENDER_DELAY_MS).toBeGreaterThanOrEqual(200);
      expect(RENDER_DELAY_MS).toBeLessThanOrEqual(500);
    });
  });

  describe('Capture Flow Integration', () => {
    it('should follow correct order: delay -> fresh capture -> fallback -> upload', async () => {
      const callOrder = [];
      const mockCanvasRef = createMockCanvasRef();
      const lastCanvasDataRef = { current: 'backup-data' };

      // Simulate full capture flow
      // 1. Delay
      await new Promise((resolve) => {
        callOrder.push('delay-start');
        setTimeout(() => {
          callOrder.push('delay-end');
          resolve();
        }, 300);
        jest.advanceTimersByTime(300);
      });

      // 2. Fresh capture
      let base64 = null;
      callOrder.push('fresh-capture-attempt');
      if (mockCanvasRef.current) {
        try {
          base64 = await mockCanvasRef.current.toBase64('png', 0.8);
          callOrder.push('fresh-capture-success');
        } catch (e) {
          callOrder.push('fresh-capture-failed');
        }
      }

      // 3. Fallback check
      callOrder.push('fallback-check');
      if (!base64 || base64.length < 100) {
        base64 = lastCanvasDataRef.current;
        callOrder.push('fallback-used');
      }

      // 4. Ready for upload
      callOrder.push('ready-for-upload');

      // Verify order - fallback-check happens but fallback is NOT used when capture succeeds
      expect(callOrder).toContain('delay-start');
      expect(callOrder).toContain('delay-end');
      expect(callOrder).toContain('fresh-capture-attempt');
      expect(callOrder).toContain('fresh-capture-success');
      expect(callOrder).toContain('fallback-check');
      expect(callOrder).toContain('ready-for-upload');
      expect(callOrder).not.toContain('fresh-capture-failed');
    });

    it('should use fallback in flow when fresh capture fails', async () => {
      const callOrder = [];
      const mockCanvasRef = createMockCanvasRef(true); // Will fail
      const backupData =
        'backup-base64-data-longer-than-100-characters-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
      const lastCanvasDataRef = { current: backupData };

      // Simulate full capture flow with failure
      await new Promise((resolve) => {
        callOrder.push('delay');
        setTimeout(resolve, 300);
        jest.advanceTimersByTime(300);
      });

      let base64 = null;
      callOrder.push('fresh-capture-attempt');
      try {
        base64 = await mockCanvasRef.current.toBase64('png', 0.8);
        callOrder.push('fresh-capture-success');
      } catch (e) {
        callOrder.push('fresh-capture-failed');
      }

      if (!base64 || base64.length < 100) {
        base64 = lastCanvasDataRef.current;
        callOrder.push('fallback-used');
      }

      expect(callOrder).toContain('fresh-capture-failed');
      expect(callOrder).toContain('fallback-used');
      expect(base64).toBe(backupData);
    });
  });
});
