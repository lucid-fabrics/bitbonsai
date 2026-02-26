import { extractClientIp, isLocalNetworkIp } from '../../utils/ip-detector.util';

describe('isLocalNetworkIp', () => {
  describe('IPv4 localhost (127.0.0.0/8)', () => {
    it('should return true for 127.0.0.1', () => {
      expect(isLocalNetworkIp('127.0.0.1')).toBe(true);
    });

    it('should return true for any 127.x.x.x', () => {
      expect(isLocalNetworkIp('127.255.255.255')).toBe(true);
    });

    it('should return true for 127.0.0.0', () => {
      expect(isLocalNetworkIp('127.0.0.0')).toBe(true);
    });
  });

  describe('IPv4 Class A private (10.0.0.0/8)', () => {
    it('should return true for 10.0.0.0', () => {
      expect(isLocalNetworkIp('10.0.0.0')).toBe(true);
    });

    it('should return true for 10.255.255.255', () => {
      expect(isLocalNetworkIp('10.255.255.255')).toBe(true);
    });

    it('should return true for 10.0.0.1', () => {
      expect(isLocalNetworkIp('10.0.0.1')).toBe(true);
    });

    it('should return false for 11.0.0.1', () => {
      expect(isLocalNetworkIp('11.0.0.1')).toBe(false);
    });
  });

  describe('IPv4 Class B private (172.16.0.0/12)', () => {
    it('should return true for 172.16.0.0', () => {
      expect(isLocalNetworkIp('172.16.0.0')).toBe(true);
    });

    it('should return true for 172.31.255.255', () => {
      expect(isLocalNetworkIp('172.31.255.255')).toBe(true);
    });

    it('should return true for 172.20.5.10', () => {
      expect(isLocalNetworkIp('172.20.5.10')).toBe(true);
    });

    it('should return false for 172.15.255.255', () => {
      expect(isLocalNetworkIp('172.15.255.255')).toBe(false);
    });

    it('should return false for 172.32.0.0', () => {
      expect(isLocalNetworkIp('172.32.0.0')).toBe(false);
    });
  });

  describe('IPv4 Class C private (192.168.0.0/16)', () => {
    it('should return true for 192.168.0.0', () => {
      expect(isLocalNetworkIp('192.168.0.0')).toBe(true);
    });

    it('should return true for 192.168.255.255', () => {
      expect(isLocalNetworkIp('192.168.255.255')).toBe(true);
    });

    it('should return true for 192.168.1.100', () => {
      expect(isLocalNetworkIp('192.168.1.100')).toBe(true);
    });

    it('should return false for 192.167.0.0', () => {
      expect(isLocalNetworkIp('192.167.0.0')).toBe(false);
    });

    it('should return false for 192.169.0.0', () => {
      expect(isLocalNetworkIp('192.169.0.0')).toBe(false);
    });
  });

  describe('IPv6 localhost', () => {
    it('should return true for ::1', () => {
      expect(isLocalNetworkIp('::1')).toBe(true);
    });

    it('should return true for 0:0:0:0:0:0:0:1', () => {
      expect(isLocalNetworkIp('0:0:0:0:0:0:0:1')).toBe(true);
    });
  });

  describe('IPv6 unique local (fc00::/7)', () => {
    it('should return true for fc00::1', () => {
      expect(isLocalNetworkIp('fc00::1')).toBe(true);
    });

    it('should return true for fd00::1', () => {
      expect(isLocalNetworkIp('fd00::1')).toBe(true);
    });

    it('should return true for fdab:1234::1', () => {
      expect(isLocalNetworkIp('fdab:1234::1')).toBe(true);
    });

    it('should return false for fe00::1', () => {
      expect(isLocalNetworkIp('fe00::1')).toBe(false);
    });
  });

  describe('Public IPs', () => {
    it('should return false for 8.8.8.8', () => {
      expect(isLocalNetworkIp('8.8.8.8')).toBe(false);
    });

    it('should return false for 1.1.1.1', () => {
      expect(isLocalNetworkIp('1.1.1.1')).toBe(false);
    });

    it('should return false for 2001:db8::1', () => {
      expect(isLocalNetworkIp('2001:db8::1')).toBe(false);
    });

    it('should return false for 203.0.113.1', () => {
      expect(isLocalNetworkIp('203.0.113.1')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should return false for undefined', () => {
      expect(isLocalNetworkIp(undefined as unknown as string)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isLocalNetworkIp(null as unknown as string)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isLocalNetworkIp('')).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(isLocalNetworkIp('   ')).toBe(false);
    });

    it('should return false for malformed IP', () => {
      expect(isLocalNetworkIp('not.an.ip')).toBe(false);
    });

    it('should return false for partial IP', () => {
      expect(isLocalNetworkIp('192.168')).toBe(false);
    });

    it('should return false for IP with out-of-range octets', () => {
      expect(isLocalNetworkIp('192.168.256.1')).toBe(false);
    });

    it('should handle trimming whitespace around valid IPs', () => {
      expect(isLocalNetworkIp('  192.168.1.1  ')).toBe(true);
    });
  });
});

describe('extractClientIp', () => {
  describe('X-Forwarded-For header', () => {
    it('should extract first IP from X-Forwarded-For', () => {
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1, 192.168.1.1' },
      };
      expect(extractClientIp(req)).toBe('203.0.113.1');
    });

    it('should handle single IP in X-Forwarded-For', () => {
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      };
      expect(extractClientIp(req)).toBe('203.0.113.1');
    });

    it('should trim whitespace from X-Forwarded-For IPs', () => {
      const req = {
        headers: { 'x-forwarded-for': '  203.0.113.1  , 198.51.100.1' },
      };
      expect(extractClientIp(req)).toBe('203.0.113.1');
    });
  });

  describe('X-Real-IP header', () => {
    it('should extract IP from X-Real-IP when X-Forwarded-For is absent', () => {
      const req = {
        headers: { 'x-real-ip': '203.0.113.5' },
      };
      expect(extractClientIp(req)).toBe('203.0.113.5');
    });

    it('should prefer X-Forwarded-For over X-Real-IP', () => {
      const req = {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '203.0.113.5',
        },
      };
      expect(extractClientIp(req)).toBe('203.0.113.1');
    });
  });

  describe('request.ip property', () => {
    it('should use request.ip when headers are absent', () => {
      const req = {
        headers: {},
        ip: '192.168.1.100',
      };
      expect(extractClientIp(req)).toBe('192.168.1.100');
    });

    it('should strip IPv6 prefix from request.ip', () => {
      const req = {
        headers: {},
        ip: '::ffff:192.168.1.100',
      };
      expect(extractClientIp(req)).toBe('192.168.1.100');
    });
  });

  describe('socket.remoteAddress fallback', () => {
    it('should use socket.remoteAddress as last resort', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '10.0.0.50' },
      };
      expect(extractClientIp(req)).toBe('10.0.0.50');
    });

    it('should strip IPv6 prefix from socket.remoteAddress', () => {
      const req = {
        headers: {},
        socket: { remoteAddress: '::ffff:10.0.0.50' },
      };
      expect(extractClientIp(req)).toBe('10.0.0.50');
    });
  });

  describe('Edge cases', () => {
    it('should return 0.0.0.0 for undefined request', () => {
      expect(extractClientIp(undefined as unknown as Request)).toBe('0.0.0.0');
    });

    it('should return 0.0.0.0 for null request', () => {
      expect(extractClientIp(null as unknown as Request)).toBe('0.0.0.0');
    });

    it('should return 0.0.0.0 for empty object', () => {
      expect(extractClientIp({} as unknown as Request)).toBe('0.0.0.0');
    });

    it('should handle missing headers gracefully', () => {
      const req = {
        ip: '192.168.1.1',
      };
      expect(extractClientIp(req)).toBe('192.168.1.1');
    });

    it('should handle IPv6 addresses without stripping', () => {
      const req = {
        headers: {},
        ip: '2001:db8::1',
      };
      expect(extractClientIp(req)).toBe('2001:db8::1');
    });

    it('should return 0.0.0.0 for non-object request', () => {
      expect(extractClientIp('string' as unknown as Request)).toBe('0.0.0.0');
    });
  });
});
