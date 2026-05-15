import { Request } from 'express';

/**
 * Detects if a given IP address belongs to a local/private network.
 *
 * Supports both IPv4 and IPv6 addresses and checks against standard private network ranges:
 * - IPv4: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - IPv6: ::1, fc00::/7
 *
 * @param ip - The IP address string to check (IPv4 or IPv6)
 * @returns true if the IP is within a local/private network range, false otherwise
 *
 * @example
 * ```typescript
 * isLocalNetworkIp('192.168.1.100'); // true
 * isLocalNetworkIp('10.0.0.5'); // true
 * isLocalNetworkIp('8.8.8.8'); // false
 * isLocalNetworkIp('::1'); // true (IPv6 localhost)
 * isLocalNetworkIp('fc00::1'); // true (IPv6 unique local)
 * isLocalNetworkIp('2001:db8::1'); // false (IPv6 public)
 * ```
 *
 * @example Unit test cases:
 * ```typescript
 * describe('isLocalNetworkIp', () => {
 *   describe('IPv4 localhost (127.0.0.0/8)', () => {
 *     it('should return true for 127.0.0.1', () => {
 *       expect(isLocalNetworkIp('127.0.0.1')).toBe(true);
 *     });
 *     it('should return true for any 127.x.x.x', () => {
 *       expect(isLocalNetworkIp('127.255.255.255')).toBe(true);
 *     });
 *   });
 *
 *   describe('IPv4 Class A private (10.0.0.0/8)', () => {
 *     it('should return true for 10.0.0.0', () => {
 *       expect(isLocalNetworkIp('10.0.0.0')).toBe(true);
 *     });
 *     it('should return true for 10.255.255.255', () => {
 *       expect(isLocalNetworkIp('10.255.255.255')).toBe(true);
 *     });
 *     it('should return false for 11.0.0.1', () => {
 *       expect(isLocalNetworkIp('11.0.0.1')).toBe(false);
 *     });
 *   });
 *
 *   describe('IPv4 Class B private (172.16.0.0/12)', () => {
 *     it('should return true for 172.16.0.0', () => {
 *       expect(isLocalNetworkIp('172.16.0.0')).toBe(true);
 *     });
 *     it('should return true for 172.31.255.255', () => {
 *       expect(isLocalNetworkIp('172.31.255.255')).toBe(true);
 *     });
 *     it('should return false for 172.15.255.255', () => {
 *       expect(isLocalNetworkIp('172.15.255.255')).toBe(false);
 *     });
 *     it('should return false for 172.32.0.0', () => {
 *       expect(isLocalNetworkIp('172.32.0.0')).toBe(false);
 *     });
 *   });
 *
 *   describe('IPv4 Class C private (192.168.0.0/16)', () => {
 *     it('should return true for 192.168.0.0', () => {
 *       expect(isLocalNetworkIp('192.168.0.0')).toBe(true);
 *     });
 *     it('should return true for 192.168.255.255', () => {
 *       expect(isLocalNetworkIp('192.168.255.255')).toBe(true);
 *     });
 *     it('should return false for 192.167.0.0', () => {
 *       expect(isLocalNetworkIp('192.167.0.0')).toBe(false);
 *     });
 *   });
 *
 *   describe('IPv6 localhost', () => {
 *     it('should return true for ::1', () => {
 *       expect(isLocalNetworkIp('::1')).toBe(true);
 *     });
 *     it('should return true for 0:0:0:0:0:0:0:1', () => {
 *       expect(isLocalNetworkIp('0:0:0:0:0:0:0:1')).toBe(true);
 *     });
 *   });
 *
 *   describe('IPv6 unique local (fc00::/7)', () => {
 *     it('should return true for fc00::1', () => {
 *       expect(isLocalNetworkIp('fc00::1')).toBe(true);
 *     });
 *     it('should return true for fd00::1', () => {
 *       expect(isLocalNetworkIp('fd00::1')).toBe(true);
 *     });
 *     it('should return false for fe00::1', () => {
 *       expect(isLocalNetworkIp('fe00::1')).toBe(false);
 *     });
 *   });
 *
 *   describe('Public IPs', () => {
 *     it('should return false for 8.8.8.8', () => {
 *       expect(isLocalNetworkIp('8.8.8.8')).toBe(false);
 *     });
 *     it('should return false for 2001:db8::1', () => {
 *       expect(isLocalNetworkIp('2001:db8::1')).toBe(false);
 *     });
 *   });
 *
 *   describe('Edge cases', () => {
 *     it('should return false for undefined', () => {
 *       expect(isLocalNetworkIp(undefined as any)).toBe(false);
 *     });
 *     it('should return false for null', () => {
 *       expect(isLocalNetworkIp(null as any)).toBe(false);
 *     });
 *     it('should return false for empty string', () => {
 *       expect(isLocalNetworkIp('')).toBe(false);
 *     });
 *     it('should return false for malformed IP', () => {
 *       expect(isLocalNetworkIp('not.an.ip')).toBe(false);
 *     });
 *   });
 * });
 * ```
 */
export function isLocalNetworkIp(ip: string): boolean {
  // Handle edge cases
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  const trimmedIp = ip.trim();
  if (!trimmedIp) {
    return false;
  }

  // Check IPv6 localhost
  if (trimmedIp === '::1' || trimmedIp === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // Check IPv6 unique local addresses (fc00::/7)
  // This includes fc00::/8 and fd00::/8
  if (trimmedIp.toLowerCase().startsWith('fc') || trimmedIp.toLowerCase().startsWith('fd')) {
    // More precise check for fc00::/7 range
    const ipv6Regex = /^f[cd][0-9a-f]{2}:/i;
    if (ipv6Regex.test(trimmedIp)) {
      return true;
    }
  }

  // Check IPv4 addresses
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = trimmedIp.match(ipv4Regex);

  if (!match) {
    return false; // Not a valid IPv4 address
  }

  // Extract octets and validate they're in valid range (0-255)
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;

  // Check 127.0.0.0/8 (localhost)
  if (first === 127) {
    return true;
  }

  // Check 10.0.0.0/8 (Class A private)
  if (first === 10) {
    return true;
  }

  // Check 172.16.0.0/12 (Class B private)
  // Range: 172.16.0.0 - 172.31.255.255
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  // Check 192.168.0.0/16 (Class C private)
  if (first === 192 && second === 168) {
    return true;
  }

  return false;
}

/**
 * Extracts the real client IP address from an HTTP request.
 *
 * This function handles various proxy configurations by checking common headers
 * in order of priority:
 * 1. X-Forwarded-For (first IP in the chain)
 * 2. X-Real-IP
 * 3. request.ip (direct connection)
 * 4. request.socket.remoteAddress (fallback)
 *
 * @param request - The Express request object or any object with similar structure
 * @returns The extracted IP address, or '0.0.0.0' if no IP can be determined
 *
 * @example
 * ```typescript
 * // Behind a proxy with X-Forwarded-For
 * const req1 = {
 *   headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' }
 * };
 * extractClientIp(req1); // '203.0.113.1'
 *
 * // With X-Real-IP header
 * const req2 = {
 *   headers: { 'x-real-ip': '203.0.113.5' }
 * };
 * extractClientIp(req2); // '203.0.113.5'
 *
 * // Direct connection
 * const req3 = {
 *   ip: '192.168.1.100'
 * };
 * extractClientIp(req3); // '192.168.1.100'
 *
 * // IPv6 handling
 * const req4 = {
 *   socket: { remoteAddress: '::ffff:192.168.1.100' }
 * };
 * extractClientIp(req4); // '192.168.1.100' (stripped IPv4-mapped prefix)
 * ```
 *
 * @example Unit test cases:
 * ```typescript
 * describe('extractClientIp', () => {
 *   describe('X-Forwarded-For header', () => {
 *     it('should extract first IP from X-Forwarded-For', () => {
 *       const req = {
 *         headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1, 192.168.1.1' }
 *       };
 *       expect(extractClientIp(req)).toBe('203.0.113.1');
 *     });
 *
 *     it('should handle single IP in X-Forwarded-For', () => {
 *       const req = {
 *         headers: { 'x-forwarded-for': '203.0.113.1' }
 *       };
 *       expect(extractClientIp(req)).toBe('203.0.113.1');
 *     });
 *
 *     it('should trim whitespace from X-Forwarded-For IPs', () => {
 *       const req = {
 *         headers: { 'x-forwarded-for': '  203.0.113.1  , 198.51.100.1' }
 *       };
 *       expect(extractClientIp(req)).toBe('203.0.113.1');
 *     });
 *   });
 *
 *   describe('X-Real-IP header', () => {
 *     it('should extract IP from X-Real-IP when X-Forwarded-For is absent', () => {
 *       const req = {
 *         headers: { 'x-real-ip': '203.0.113.5' }
 *       };
 *       expect(extractClientIp(req)).toBe('203.0.113.5');
 *     });
 *
 *     it('should prefer X-Forwarded-For over X-Real-IP', () => {
 *       const req = {
 *         headers: {
 *           'x-forwarded-for': '203.0.113.1',
 *           'x-real-ip': '203.0.113.5'
 *         }
 *       };
 *       expect(extractClientIp(req)).toBe('203.0.113.1');
 *     });
 *   });
 *
 *   describe('request.ip property', () => {
 *     it('should use request.ip when headers are absent', () => {
 *       const req = {
 *         ip: '192.168.1.100'
 *       };
 *       expect(extractClientIp(req)).toBe('192.168.1.100');
 *     });
 *
 *     it('should strip IPv6 prefix from request.ip', () => {
 *       const req = {
 *         ip: '::ffff:192.168.1.100'
 *       };
 *       expect(extractClientIp(req)).toBe('192.168.1.100');
 *     });
 *   });
 *
 *   describe('socket.remoteAddress fallback', () => {
 *     it('should use socket.remoteAddress as last resort', () => {
 *       const req = {
 *         socket: { remoteAddress: '10.0.0.50' }
 *       };
 *       expect(extractClientIp(req)).toBe('10.0.0.50');
 *     });
 *
 *     it('should strip IPv6 prefix from socket.remoteAddress', () => {
 *       const req = {
 *         socket: { remoteAddress: '::ffff:10.0.0.50' }
 *       };
 *       expect(extractClientIp(req)).toBe('10.0.0.50');
 *     });
 *   });
 *
 *   describe('Edge cases', () => {
 *     it('should return 0.0.0.0 for undefined request', () => {
 *       expect(extractClientIp(undefined as any)).toBe('0.0.0.0');
 *     });
 *
 *     it('should return 0.0.0.0 for null request', () => {
 *       expect(extractClientIp(null as any)).toBe('0.0.0.0');
 *     });
 *
 *     it('should return 0.0.0.0 for empty object', () => {
 *       expect(extractClientIp({} as any)).toBe('0.0.0.0');
 *     });
 *
 *     it('should handle missing headers gracefully', () => {
 *       const req = {
 *         ip: '192.168.1.1'
 *       };
 *       expect(extractClientIp(req)).toBe('192.168.1.1');
 *     });
 *
 *     it('should handle IPv6 addresses', () => {
 *       const req = {
 *         ip: '2001:db8::1'
 *       };
 *       expect(extractClientIp(req)).toBe('2001:db8::1');
 *     });
 *   });
 * });
 * ```
 */
export function extractClientIp(request: Request | any): string {
  // Handle edge cases
  if (!request || typeof request !== 'object') {
    return '0.0.0.0';
  }

  // 1. Check X-Forwarded-For header (most common for proxies)
  // This header can contain multiple IPs: "client, proxy1, proxy2"
  // The first IP is the original client
  const xForwardedFor = request.headers?.['x-forwarded-for'];
  if (xForwardedFor) {
    const ips = String(xForwardedFor).split(',');
    const clientIp = ips[0]?.trim();
    if (clientIp) {
      return clientIp;
    }
  }

  // 2. Check X-Real-IP header (used by some proxies like nginx)
  const xRealIp = request.headers?.['x-real-ip'];
  if (xRealIp) {
    return String(xRealIp).trim();
  }

  // 3. Check request.ip (Express standard property)
  if (request.ip) {
    return stripIpv6Prefix(String(request.ip));
  }

  // 4. Check socket.remoteAddress (fallback)
  if (request.socket?.remoteAddress) {
    return stripIpv6Prefix(String(request.socket.remoteAddress));
  }

  // No IP could be determined
  return '0.0.0.0';
}

/**
 * Strips the IPv6-to-IPv4 mapping prefix from an IP address.
 *
 * When an IPv4 address is represented in IPv6 format, it's prefixed with ::ffff:
 * This function removes that prefix to get the clean IPv4 address.
 *
 * @param ip - The IP address (possibly with IPv6 prefix)
 * @returns The IP address with IPv6 prefix stripped if present
 *
 * @internal
 *
 * @example
 * ```typescript
 * stripIpv6Prefix('::ffff:192.168.1.100'); // '192.168.1.100'
 * stripIpv6Prefix('192.168.1.100'); // '192.168.1.100'
 * stripIpv6Prefix('2001:db8::1'); // '2001:db8::1'
 * ```
 */
function stripIpv6Prefix(ip: string): string {
  if (!ip) {
    return ip;
  }

  // Remove IPv6-to-IPv4 mapping prefix
  const ipv6Prefix = '::ffff:';
  if (ip.toLowerCase().startsWith(ipv6Prefix)) {
    return ip.substring(ipv6Prefix.length);
  }

  return ip;
}
