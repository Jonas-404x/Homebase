function normalizeAddress(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value) return null;

  // Ein Host mit Port ist noch kein URL-Schema.
  const hostWithPort = /^[^:/?#\s]+:\d+(?:[/?#]|$)/.test(value);
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value) && !hostWithPort;

  try {
    const url = new URL(hasScheme ? value : `http://${value}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

module.exports = { normalizeAddress };
