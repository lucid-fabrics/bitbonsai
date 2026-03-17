import {
  bigIntReplacer,
  setupBigIntSerialization,
  stringifyWithBigInt,
} from '../../bigint-serializer';

describe('BigInt Serializer', () => {
  describe('setupBigIntSerialization', () => {
    it('should add toJSON to BigInt prototype', () => {
      setupBigIntSerialization();

      // Verify toJSON is available
      expect('toJSON' in BigInt.prototype).toBe(true);
    });

    it('should not add duplicate toJSON', () => {
      setupBigIntSerialization();
      setupBigIntSerialization(); // Second call should be no-op

      expect('toJSON' in BigInt.prototype).toBe(true);
    });

    it('should serialize BigInt to string via toJSON', () => {
      setupBigIntSerialization();

      const value = BigInt(12345678901234567890n);
      const result = (value as any).toJSON();

      expect(typeof result).toBe('string');
      expect(result).toBe('12345678901234567890');
    });
  });

  describe('bigIntReplacer', () => {
    it('should convert BigInt values to strings', () => {
      const result = bigIntReplacer('key', BigInt(42));

      expect(result).toBe('42');
    });

    it('should pass through non-BigInt values', () => {
      expect(bigIntReplacer('key', 42)).toBe(42);
      expect(bigIntReplacer('key', 'hello')).toBe('hello');
      expect(bigIntReplacer('key', true)).toBe(true);
      expect(bigIntReplacer('key', null)).toBe(null);
      expect(bigIntReplacer('key', undefined)).toBe(undefined);
    });

    it('should handle large BigInt values', () => {
      const large = BigInt('999999999999999999999999999999');
      const result = bigIntReplacer('key', large);

      expect(result).toBe('999999999999999999999999999999');
    });

    it('should handle zero BigInt', () => {
      expect(bigIntReplacer('key', BigInt(0))).toBe('0');
    });

    it('should handle negative BigInt', () => {
      expect(bigIntReplacer('key', BigInt(-123))).toBe('-123');
    });
  });

  describe('stringifyWithBigInt', () => {
    it('should stringify objects with BigInt values', () => {
      const data = {
        id: 'test',
        savedBytes: BigInt(1234567890),
        count: 42,
      };

      const result = stringifyWithBigInt(data);
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe('test');
      expect(parsed.savedBytes).toBe('1234567890');
      expect(parsed.count).toBe(42);
    });

    it('should handle nested objects with BigInt', () => {
      const data = {
        nested: {
          value: BigInt(100),
        },
      };

      const result = stringifyWithBigInt(data);
      const parsed = JSON.parse(result);

      expect(parsed.nested.value).toBe('100');
    });

    it('should handle arrays with BigInt', () => {
      const data = [BigInt(1), BigInt(2), BigInt(3)];

      const result = stringifyWithBigInt(data);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(['1', '2', '3']);
    });

    it('should support formatting with space parameter', () => {
      const data = { key: 'value' };

      const result = stringifyWithBigInt(data, 2);

      expect(result).toContain('\n');
      expect(result).toContain('  ');
    });

    it('should handle null and undefined', () => {
      expect(stringifyWithBigInt(null)).toBe('null');
    });

    it('should handle primitive values', () => {
      expect(stringifyWithBigInt(42)).toBe('42');
      expect(stringifyWithBigInt('hello')).toBe('"hello"');
      expect(stringifyWithBigInt(true)).toBe('true');
    });
  });
});
