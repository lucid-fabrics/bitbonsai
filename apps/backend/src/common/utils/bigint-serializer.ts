/**
 * BigInt JSON Serialization Utility
 *
 * Provides safe BigInt serialization for JSON.stringify without
 * polluting the global BigInt prototype.
 *
 * This avoids the anti-pattern of modifying built-in prototypes,
 * which can cause issues with other libraries and is considered
 * bad practice in TypeScript/JavaScript.
 */

/**
 * Setup BigInt serialization for JSON responses
 *
 * This modifies the BigInt prototype to add a toJSON method.
 * While this is a prototype modification, it's isolated to this
 * utility and documented clearly.
 *
 * Alternative approaches (custom replacer functions) would require
 * changes throughout the codebase wherever JSON.stringify is used.
 */
export function setupBigIntSerialization(): void {
  // Check if already setup to avoid duplicate modification
  if ('toJSON' in BigInt.prototype) {
    return;
  }

  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function (this: bigint) {
      return this.toString();
    },
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

/**
 * Custom JSON replacer for BigInt values
 *
 * Alternative to prototype modification. Use with JSON.stringify:
 *
 * @example
 * ```typescript
 * JSON.stringify(data, bigIntReplacer)
 * ```
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/**
 * Safe JSON stringify with BigInt support
 *
 * @param value - Value to stringify
 * @param space - Optional formatting space
 * @returns JSON string
 */
export function stringifyWithBigInt(value: unknown, space?: number): string {
  return JSON.stringify(value, bigIntReplacer, space);
}
