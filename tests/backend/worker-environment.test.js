import test from 'node:test';
import assert from 'node:assert/strict';
import { generationEnvironment } from '../../server/generator.js';

test('generation worker receives model authentication and runtime paths, never app identity or merchant secrets', () => {
  const source = { PATH: '/runtime/bin', HOME: '/runtime/home', OPENAI_API_KEY: 'model-key', CODEX_HOME: '/runtime/auth',
    HTTPS_PROXY: 'https://proxy.example.test', STRIPE_SECRET_KEY: 'merchant-key', STRIPE_WEBHOOK_SECRET: 'callback-key',
    GOOGLE_CLIENT_SECRET: 'oauth-key', TWILIO_AUTH_TOKEN: 'sms-key', ALIPAY_PRIVATE_KEY: 'merchant-private-key',
    GAMESTUDIO_SESSION_SECRET: 'session-key', SESSION_COOKIE: 'browser-secret', UNRELATED_TOKEN: 'other-key' };
  assert.deepEqual(generationEnvironment(source), { PATH: source.PATH, HOME: source.HOME, OPENAI_API_KEY: source.OPENAI_API_KEY,
    CODEX_HOME: source.CODEX_HOME, HTTPS_PROXY: source.HTTPS_PROXY });
  assert.equal(source.STRIPE_SECRET_KEY, 'merchant-key');
});
