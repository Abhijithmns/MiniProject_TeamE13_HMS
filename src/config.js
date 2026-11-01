module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'hms-secure-jwt-secret-key-2026',
  JWT_EXPIRES_IN: '30m',
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000 // 15 minutes
};
