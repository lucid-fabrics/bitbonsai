/**
 * Authentication Response Model
 *
 * Represents the response structure returned by the authentication API endpoints.
 */
export interface AuthResponse {
  /**
   * JWT access token for API authentication
   */
  access_token: string;

  /**
   * JWT refresh token for obtaining new access tokens
   */
  refresh_token: string;

  /**
   * Unique identifier of the authenticated user
   */
  userId: string;

  /**
   * Username of the authenticated user
   */
  username: string;

  /**
   * Role of the authenticated user (e.g., 'admin', 'user')
   */
  role: string;
}

/**
 * Login Request Credentials
 *
 * Represents the credentials required for user authentication.
 */
export interface LoginCredentials {
  /**
   * User's username
   */
  username: string;

  /**
   * User's password
   */
  password: string;
}

/**
 * Refresh Token Request
 *
 * Represents the request structure for refreshing an access token.
 */
export interface RefreshTokenRequest {
  /**
   * The refresh token to use for obtaining a new access token
   */
  refresh_token: string;
}
