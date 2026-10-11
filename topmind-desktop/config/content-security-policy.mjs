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
    // https: covers captured article/X images before localize rewrites them
    // to topmind-asset://; blob: is for paste/preview object URLs.
    "img-src 'self' data: blob: topmind-asset: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
  ].join("; ");
}
