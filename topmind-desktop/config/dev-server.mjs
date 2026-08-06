const DEFAULT_DEV_SERVER_HOST = "127.0.0.1";
const DEFAULT_DEV_SERVER_PORT = 5_173;

export { DEFAULT_DEV_SERVER_HOST, DEFAULT_DEV_SERVER_PORT };

export function parseDevServerPort(value, fallback = DEFAULT_DEV_SERVER_PORT) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function resolveDevServerHost(env = process.env) {
  const host = env.topmind_DESKTOP_DEV_SERVER_HOST;
  return typeof host === "string" && host.trim().length > 0
    ? host.trim()
    : DEFAULT_DEV_SERVER_HOST;
}

export function resolveDevServerPort(env = process.env) {
  return parseDevServerPort(env.topmind_DESKTOP_DEV_SERVER_PORT);
}

export function getDevServerUrl({
  host = resolveDevServerHost(),
  port = resolveDevServerPort(),
} = {}) {
  return `http://${host}:${port}`;
}

export function getDevServerWebSocketOrigin(devServerUrl = getDevServerUrl()) {
  const url = new URL(devServerUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

export function getDevServerOrigins(devServerUrl = getDevServerUrl()) {
  const url = new URL(devServerUrl);
  return {
    httpOrigin: url.origin,
    wsOrigin: getDevServerWebSocketOrigin(devServerUrl),
  };
}
