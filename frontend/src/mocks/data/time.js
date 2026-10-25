// Helpers so mock dates are always relative to "now" (ISO 8601 UTC, section 2)
export const MIN = 60_000;
export const ago = (minutes) => new Date(Date.now() - minutes * MIN).toISOString();
export const fromNow = (minutes) => new Date(Date.now() + minutes * MIN).toISOString();
export const daysAgo = (d) => ago(d * 24 * 60);
