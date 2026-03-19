import { HttpService } from '@nestjs/axios';
import type { AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';

/**
 * Standardized connection test result
 */
export interface TestConnectionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Options for testing an integration connection
 */
export interface TestConnectionOptions {
  /** Raw URL (trailing slash will be stripped) */
  url: string;
  /** Path appended to the normalized URL */
  path: string;
  /** Headers to send with the request */
  headers: Record<string, string>;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
  /** Extra Axios config (params, auth, etc.) */
  axiosConfig?: Omit<AxiosRequestConfig, 'headers' | 'timeout'>;
}

/**
 * Shared utility for testing integration connections.
 *
 * Handles URL normalization, HTTP GET with timeout, and standardized
 * error formatting used across Jellyfin, Plex, and *arr services.
 */
export async function testIntegrationConnection(
  httpService: HttpService,
  options: TestConnectionOptions
): Promise<TestConnectionResult> {
  const { url, path, headers, timeout = 10000, axiosConfig } = options;
  const normalizedUrl = url.replace(/\/$/, '');

  try {
    const response = await firstValueFrom(
      httpService.get(`${normalizedUrl}${path}`, {
        ...axiosConfig,
        headers,
        timeout,
      })
    );

    return {
      success: true,
      data: response.data as Record<string, unknown>,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}
