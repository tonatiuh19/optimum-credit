type LogLevel = "debug" | "info" | "warn" | "error";

const isDev = import.meta.env.DEV;

function formatMessage(level: LogLevel, message: string, ...args: unknown[]) {
  const prefix = `[${level.toUpperCase()}]`;
  return [prefix, message, ...args];
}

export const logger = {
  debug(message: string, ...args: unknown[]) {
    if (isDev) {
      console.debug(...formatMessage("debug", message, ...args));
    }
  },
  info(message: string, ...args: unknown[]) {
    if (isDev) {
      console.info(...formatMessage("info", message, ...args));
    }
  },
  warn(message: string, ...args: unknown[]) {
    console.warn(...formatMessage("warn", message, ...args));
  },
  error(message: string, ...args: unknown[]) {
    console.error(...formatMessage("error", message, ...args));
  },
};
