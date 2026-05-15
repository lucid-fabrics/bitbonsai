/**
 * Input sanitization utility for shell commands
 * Prevents command injection attacks
 */

/**
 * Sanitize a file path for use in shell commands
 * Removes dangerous characters that could be used for command injection
 */
export function sanitizePath(path: string): string {
  if (!path) {
    throw new Error('Path cannot be empty');
  }

  // Remove any shell metacharacters and command substitution
  const dangerous = /[;&|`$()<>'"\\!{}[\]*?~]/g;

  if (dangerous.test(path)) {
    throw new Error(
      `Path contains dangerous characters: ${path}. Only alphanumeric, -, _, /, and . are allowed.`
    );
  }

  // Path must start with / (absolute path)
  if (!path.startsWith('/')) {
    throw new Error('Path must be absolute (start with /)');
  }

  // Remove any .. path traversal attempts
  if (path.includes('..')) {
    throw new Error('Path traversal (..) is not allowed');
  }

  return path;
}

/**
 * Sanitize a server address (IP or hostname)
 * Ensures only valid IP addresses or hostnames are used
 */
export function sanitizeServerAddress(address: string): string {
  if (!address) {
    throw new Error('Server address cannot be empty');
  }

  // Check if it's an IP address (IPv4 or IPv6)
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){7}[0-9a-fA-F]{0,4}$/;

  // Check if it's a valid hostname
  const hostnameRegex = /^[a-zA-Z0-9][a-zA-Z0-9-_.]*[a-zA-Z0-9]$/;

  if (ipv4Regex.test(address)) {
    // Validate IPv4 octets
    const octets = address.split('.');
    for (const octet of octets) {
      const num = parseInt(octet, 10);
      if (num < 0 || num > 255) {
        throw new Error(`Invalid IPv4 address: ${address}`);
      }
    }
    return address;
  }

  if (ipv6Regex.test(address) || hostnameRegex.test(address)) {
    return address;
  }

  throw new Error(`Invalid server address: ${address}. Must be a valid IP address or hostname.`);
}

/**
 * Sanitize mount options string
 * Only allows known safe mount options
 */
export function sanitizeMountOptions(options: string): string {
  if (!options) {
    return '';
  }

  // Split by comma
  const opts = options.split(',');

  // Whitelist of allowed option patterns
  const allowedPatterns = [
    /^ro$/,
    /^rw$/,
    /^nolock$/,
    /^soft$/,
    /^hard$/,
    /^async$/,
    /^sync$/,
    /^noatime$/,
    /^nodiratime$/,
    /^vers=[\d.]+$/,
    /^nfsvers=[\d.]+$/,
    /^credentials=\/[\w\-/.]+$/,
    /^domain=[\w.-]+$/,
    /^uid=\d+$/,
    /^gid=\d+$/,
    /^timeo=\d+$/,
    /^retrans=\d+$/,
    /^port=\d+$/,
  ];

  for (const opt of opts) {
    const trimmedOpt = opt.trim();
    if (!trimmedOpt) continue;

    const isAllowed = allowedPatterns.some((pattern) => pattern.test(trimmedOpt));

    if (!isAllowed) {
      throw new Error(
        `Mount option "${trimmedOpt}" is not allowed. Only standard mount options are permitted.`
      );
    }
  }

  return options;
}

/**
 * Escape a string for safe use in shell commands
 * Wraps the string in single quotes and escapes any single quotes inside
 */
export function escapeShellArg(arg: string): string {
  if (!arg) {
    return "''";
  }

  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
