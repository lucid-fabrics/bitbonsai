/**
 * Base error class for all custom application errors.
 * Extends the native Error class and provides consistent structure.
 */
export abstract class BaseError extends Error {
  /**
   * HTTP status code associated with this error
   */
  public readonly statusCode: number;

  /**
   * Error code for client-side handling and i18n
   */
  public readonly errorCode: string;

  /**
   * Additional context data for debugging
   */
  public readonly context?: Record<string, unknown>;

  /**
   * Whether this error should be logged (some expected errors don't need logging)
   */
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    isOperational = true,
    context?: Record<string, unknown>
  ) {
    super(message);

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.context = context;

    // Ensure the error is an instance of Error for proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serializes the error for HTTP responses
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      errorCode: this.errorCode,
      statusCode: this.statusCode,
      context: this.context,
    };
  }
}
