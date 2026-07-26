const PREFIX = "Caro:";

export type LogLevel = "log" | "warn" | "error";

/** Optional transport for logs (e.g. worker → main via postMessage). */
export type LogSink = (level: LogLevel, args: readonly unknown[]) => void;

/**
 * Logger utility class for consistent logging with debug toggle
 */
export class Logger {
  private isDebugEnabled = false;
  private sink: LogSink | null = null;

  /**
   * Set the debug mode
   * @param enabled Whether debug logging is enabled
   */
  public setDebug(enabled: boolean): void {
    this.isDebugEnabled = enabled;
  }

  /**
   * When set, log/warn/error are forwarded to the sink instead of console.
   * Used by engine workers so the main thread prints in arrival order.
   */
  public setSink(sink: LogSink | null): void {
    this.sink = sink;
  }

  /**
   * Print a forwarded log on this thread (always; caller already gated).
   */
  public write(level: LogLevel, args: readonly unknown[]): void {
    if (level === "warn") {
      console.warn(`${PREFIX}`, ...args);
      return;
    }
    if (level === "error") {
      console.error(`${PREFIX}`, ...args);
      return;
    }
    console.log(`${PREFIX}`, ...args);
  }

  /**
   * Log a debug message (only if debug is enabled)
   * @param args Arguments to log
   */
  public log(...args: unknown[]): void {
    if (!this.isDebugEnabled) {
      return;
    }
    this.emit("log", args);
  }

  /**
   * Log an error message (always shown, regardless of debug setting)
   * @param args Arguments to log
   */
  public error(...args: unknown[]): void {
    this.emit("error", args);
  }

  /**
   * Log a warning message (always shown, regardless of debug setting)
   * @param args Arguments to log
   */
  public warn(...args: unknown[]): void {
    this.emit("warn", args);
  }

  private emit(level: LogLevel, args: readonly unknown[]): void {
    if (this.sink) {
      this.sink(level, args);
      return;
    }
    this.write(level, args);
  }
}

// Create a singleton instance
export const logger = new Logger();
