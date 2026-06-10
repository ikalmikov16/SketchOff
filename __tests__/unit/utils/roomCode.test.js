import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  CHARS,
  LENGTH,
} from '../../../src/utils/roomCode';

describe('roomCode utils', () => {
  describe('generateRoomCode', () => {
    it('should generate a code of correct length', () => {
      const code = generateRoomCode();
      expect(code.length).toBe(LENGTH);
    });

    it('should only use allowed characters', () => {
      // Generate multiple codes to increase confidence
      for (let i = 0; i < 100; i++) {
        const code = generateRoomCode();
        for (const char of code) {
          expect(CHARS).toContain(char);
        }
      }
    });

    it('should never include O (letter)', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateRoomCode();
        expect(code).not.toContain('O');
      }
    });

    it('should never include 0 (zero)', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateRoomCode();
        expect(code).not.toContain('0');
      }
    });

    it('should generate only uppercase characters', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateRoomCode();
        expect(code).toBe(code.toUpperCase());
      }
    });

    it('should generate different codes (randomness test)', () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(generateRoomCode());
      }
      // With 33 possible chars and 6 positions, collisions should be extremely rare
      // Expect at least 95 unique codes out of 100
      expect(codes.size).toBeGreaterThanOrEqual(95);
    });

    it('should have good character distribution', () => {
      const charCounts = {};
      const iterations = 1000;

      for (let i = 0; i < iterations; i++) {
        const code = generateRoomCode();
        for (const char of code) {
          charCounts[char] = (charCounts[char] || 0) + 1;
        }
      }

      // Each character should appear roughly equally
      // Total characters generated: iterations * LENGTH
      const totalChars = iterations * LENGTH;
      const expectedPerChar = totalChars / CHARS.length;

      // Allow 50% deviation (generous for random)
      const minExpected = expectedPerChar * 0.5;
      const maxExpected = expectedPerChar * 1.5;

      for (const char of CHARS) {
        const count = charCounts[char] || 0;
        expect(count).toBeGreaterThan(minExpected);
        expect(count).toBeLessThan(maxExpected);
      }
    });
  });

  describe('isValidRoomCode', () => {
    it('should return true for valid codes', () => {
      expect(isValidRoomCode('ABCD12')).toBe(true);
      expect(isValidRoomCode('XYZ789')).toBe(true);
      expect(isValidRoomCode('HHHHH1')).toBe(true);
    });

    it('should return false for codes with wrong length', () => {
      expect(isValidRoomCode('ABCDE')).toBe(false); // Too short
      expect(isValidRoomCode('ABCDEFG')).toBe(false); // Too long
      expect(isValidRoomCode('')).toBe(false); // Empty
    });

    it('should return false for codes containing O', () => {
      expect(isValidRoomCode('ABCDO1')).toBe(false);
      expect(isValidRoomCode('OAAAAA')).toBe(false);
    });

    it('should return false for codes containing 0 (zero)', () => {
      expect(isValidRoomCode('ABCD01')).toBe(false);
      expect(isValidRoomCode('0AAAAA')).toBe(false);
    });

    it('should return false for lowercase codes', () => {
      expect(isValidRoomCode('abcd12')).toBe(false);
      expect(isValidRoomCode('Abcd12')).toBe(false);
    });

    it('should return false for codes with special characters', () => {
      expect(isValidRoomCode('ABC-12')).toBe(false);
      expect(isValidRoomCode('ABC 12')).toBe(false);
      expect(isValidRoomCode('ABC!12')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isValidRoomCode(null)).toBe(false);
      expect(isValidRoomCode(undefined)).toBe(false);
    });

    it('should return false for non-strings', () => {
      expect(isValidRoomCode(123456)).toBe(false);
      expect(isValidRoomCode(['A', 'B', 'C', 'D', '1', '2'])).toBe(false);
      expect(isValidRoomCode({})).toBe(false);
    });

    it('should accept generated codes as valid', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateRoomCode();
        expect(isValidRoomCode(code)).toBe(true);
      }
    });
  });

  describe('normalizeRoomCode', () => {
    it('should convert to uppercase', () => {
      expect(normalizeRoomCode('abcd12')).toBe('ABCD12');
      expect(normalizeRoomCode('AbCd12')).toBe('ABCD12');
    });

    it('should trim whitespace', () => {
      expect(normalizeRoomCode('  ABCD12  ')).toBe('ABCD12');
      expect(normalizeRoomCode('ABCD12\n')).toBe('ABCD12');
      expect(normalizeRoomCode('\tABCD12')).toBe('ABCD12');
    });

    it('should handle both trim and uppercase', () => {
      expect(normalizeRoomCode('  abcd12  ')).toBe('ABCD12');
    });

    it('should return empty string for null/undefined', () => {
      expect(normalizeRoomCode(null)).toBe('');
      expect(normalizeRoomCode(undefined)).toBe('');
    });

    it('should return empty string for non-strings', () => {
      expect(normalizeRoomCode(123456)).toBe('');
      expect(normalizeRoomCode({})).toBe('');
    });
  });

  describe('CHARS constant', () => {
    it('should not contain O (letter)', () => {
      expect(CHARS).not.toContain('O');
    });

    it('should not contain 0 (zero)', () => {
      expect(CHARS).not.toContain('0');
    });

    it('should contain all uppercase letters except O', () => {
      const expectedLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      for (const letter of expectedLetters) {
        expect(CHARS).toContain(letter);
      }
    });

    it('should contain digits 1-9', () => {
      for (let i = 1; i <= 9; i++) {
        expect(CHARS).toContain(String(i));
      }
    });
  });

  describe('LENGTH constant', () => {
    it('should be 6', () => {
      expect(LENGTH).toBe(6);
    });
  });
});
