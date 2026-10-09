/**
 * The .NET exception types the RIZones code throws, kept by name because the
 * API's error handler reports the type ("type": "ArgumentException") and maps
 * InvalidOperationException to 400 (Program.cs). Ported code throws these
 * where the C# throws them.
 */

export class DotnetException extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Business-rule violation; the API answers 400 { message }. */
export class InvalidOperationException extends DotnetException {}
export class ArgumentException extends DotnetException {}
export class ArgumentNullException extends ArgumentException {}
export class KeyNotFoundException extends DotnetException {}
export class UnauthorizedAccessException extends DotnetException {}
export class FormatException extends DotnetException {}
export class NotSupportedException extends DotnetException {}
export class TimeoutException extends DotnetException {}
export class HttpRequestException extends DotnetException {}
