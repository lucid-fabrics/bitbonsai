import { posix, win32 } from 'node:path';

/**
 * Whether the backend process itself is running natively on Windows
 * (no Docker). Kept as its own function, rather than inlined, so tests can
 * mock `process.platform` and exercise the win32 branch deterministically
 * on any host OS.
 */
function isWindowsRuntime(): boolean {
  return process.platform === 'win32';
}

/**
 * System directories that must never be usable as a library path or exposed
 * in the folder browser, regardless of host OS. These are the POSIX paths
 * the app actually sees: production always runs inside a Linux Docker
 * container, so host OS only changes what gets bind-mounted where, never
 * the path syntax the process observes.
 */
const SYSTEM_PATH_BLOCKLIST_POSIX = [
  '/etc',
  '/proc',
  '/sys',
  '/dev',
  '/bin',
  '/sbin',
  '/usr',
  '/var',
  '/root',
  '/boot',
  '/System',
  '/Library',
  '/private',
];

/**
 * Windows system directories, only relevant when the backend itself is
 * running natively on Windows (no Docker) for local development.
 */
const SYSTEM_PATH_BLOCKLIST_WIN32 = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
];

/**
 * Cross-platform absolute-path check. Deliberately not a manual
 * `startsWith('/')` test: that silently rejects every valid Windows
 * absolute path (`C:\Users\...`). Picks the path implementation that
 * matches the actual running platform rather than the input string's
 * shape, so it resolves correctly wherever the process runs.
 */
export function isAbsoluteLibraryPath(path: string): boolean {
  return isWindowsRuntime() ? win32.isAbsolute(path) : posix.isAbsolute(path);
}

function matchesBlockedPrefix(path: string, blocked: string, separator: string): boolean {
  return path === blocked || path.startsWith(`${blocked}${separator}`);
}

/**
 * Whether a path is (or is inside) a directory that must never be browsable
 * or usable as a library root. Checked against the platform the process is
 * actually running on, not the shape of the input string, so a POSIX
 * (containerized) backend never trusts a client-supplied `C:\` string as an
 * escape hatch.
 */
export function isBlockedSystemPath(path: string): boolean {
  if (SYSTEM_PATH_BLOCKLIST_POSIX.some((blocked) => matchesBlockedPrefix(path, blocked, '/'))) {
    return true;
  }

  if (isWindowsRuntime()) {
    const lowerPath = path.toLowerCase();
    return SYSTEM_PATH_BLOCKLIST_WIN32.some((blocked) =>
      matchesBlockedPrefix(lowerPath, blocked.toLowerCase(), '\\')
    );
  }

  return false;
}
