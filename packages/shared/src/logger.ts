import { pino, type Logger } from "pino";

export function createLogger(name: string, level?: string): Logger {
  return pino({
    name,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "*.access_token",
        "*.accessToken",
        "*.credentials",
        "req.headers.authorization",
        "req.headers['x-hub-signature-256']",
      ],
      censor: "[redacted]",
    },
  });
}

export type { Logger };
