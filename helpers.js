/**
 * Shared utility helpers
 */

/**
 * Safely parse a JSON string. Returns the parsed object or null on failure.
 */
function sanitizeJSON(raw) {
  try {
    if (typeof raw === 'object' && raw !== null) return raw;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Human-readable file size
 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = { sanitizeJSON, formatSize };
