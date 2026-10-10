/**
 * Minimal stand-in for `@deepseek-ai/dsh-settings` (shipped inside DSH).
 * lib/index.js only needs `SettingsConflictError` for `instanceof` checks.
 */
export class SettingsConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "SettingsConflictError";
  }
}

export default { SettingsConflictError };
