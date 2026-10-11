/**
 * HTTP header secret guard — re-export from header-safe.mjs (single module).
 * Kept as a thin alias so existing `import("./lib/header-safety.mjs")` call
 * sites stay stable. Do not add logic here.
 */
export { isHeaderSafeSecret, headerSafe, keyHadNonLatin1, bearerHeader, redactSecret, isUsableSecret, MAX_SECRET_BYTES } from "./header-safe.mjs";
