// Vérification de santé utilisée par Docker (HEALTHCHECK).
const https = /^(1|true|yes|oui|on)$/i.test(process.env.HTTPS || '');
const mod = require(https ? 'https' : 'http');
const req = mod.get({ host: '127.0.0.1', port: process.env.INTERNAL_PORT || 8080, path: '/api/health', timeout: 4000, rejectUnauthorized: false },
  res => process.exit(res.statusCode === 200 ? 0 : 1));
req.on('error', () => process.exit(1));
req.on('timeout', () => { req.destroy(); process.exit(1); });
