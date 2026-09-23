import { getDevServerOrigins, getDevServerUrl } from "./dev-server.mjs";

function getDevelopmentConnectSrc(devServerUrl) {
  try {
    const { httpOrigin, wsOrigin } = getDevServerOrigins(devServerUrl);
    return `'self' ${httpOrigin} ${wsOrigin}`;
  } catch {
    return "'self'";
  }
}

export function getContentSecurityPolicy({
  development = false,
  devServerUrl = getDevServerUrl(),
} = {}) {
  const scriptSrc = development ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = development ? getDevelopmentConnectSrc(devServerUrl) : "'self'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: topmind-asset:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
  ].join("; ");
}
