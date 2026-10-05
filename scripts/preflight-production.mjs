#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { billingConfig, minorAmount } from '../server/billing/config.js';
import { MODEL } from '../server/content.js';
import { resolveCodexBin } from '../server/generator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CLI = '0.160.0';
const credentialLooksReal = value => typeof value === 'string' && value.length >= 12 && !/^(?:change|example|replace|your[_ -]|<)/i.test(value) && !/[\x00-\x1f\x7f]/.test(value);
function checkGroup(env, names, label, report) {
  const present = names.filter(name => Boolean(env[name]));
  if (!present.length) return false;
  if (present.length !== names.length || names.some(name => !credentialLooksReal(['ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY'].includes(name) ? env[name].replace(/[\r\n]/g, '') : env[name]))) { report.errors.push(`${label}: fill every required credential without placeholders.`); return false; }
  return true;
}
function writeProbe(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `.preflight-${crypto.randomUUID()}`), bytes = crypto.randomBytes(24); let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; if (!fs.readFileSync(file).equals(bytes)) throw new Error('Read-back failed'); }
  finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(file, { force: true }); }
}
function modelProbe(binary, directory, execute) {
  const dir = fs.mkdtempSync(path.join(directory, '.model-access-'));
  try {
    const schema = path.join(dir, 'schema.json'), output = path.join(dir, 'result.json');
    fs.writeFileSync(schema, JSON.stringify({ type: 'object', properties: { ok: { type: 'boolean', const: true } }, required: ['ok'], additionalProperties: false }), { mode: 0o600 });
    execute(binary, ['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--json','--color','never','-m',MODEL,'-s','read-only','--disable','shell_tool','--disable','multi_agent','--disable','apps','-c','web_search="disabled"','--output-schema',schema,'--output-last-message',output,'-'], { cwd: dir, input: 'Return exactly {"ok":true}. Do not use tools, files, commands or network. This is an explicit operator model-access check.', encoding: 'utf8', timeout: 60000, maxBuffer: 2000000, stdio: ['pipe','pipe','pipe'] });
    const result = JSON.parse(fs.readFileSync(output,'utf8')); if (result.ok !== true || Object.keys(result).length !== 1) throw new Error('Unexpected probe output');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

/** No provider requests or generation happen unless probeModel is explicitly true. */
export async function runPreflight({ env = process.env, configOnly = false, skipCli = false, probeModel = false, execute = execFileSync, authDir = path.join(os.homedir(), '.codex') } = {}) {
  const report = { ok: false, model: MODEL, checks: [], warnings: [], errors: [] };
  if (process.versions.node.split('.')[0] !== '24') report.errors.push('Use the supported Node.js 24 runtime.');
  else report.checks.push('Node.js 24 runtime');
  if (env.NODE_ENV !== 'production' || env.GAMESTUDIO_MODE !== 'production') report.errors.push('Set NODE_ENV=production and GAMESTUDIO_MODE=production.');
  if (MODEL !== 'gpt-6.1-sol' || (env.GAMESTUDIO_MODEL && env.GAMESTUDIO_MODEL !== MODEL)) report.errors.push('The required model is exactly gpt-6.1-sol; fallback models are not supported.');
  let config, billing;
  try { config = loadConfig(env); } catch (error) { report.errors.push(error.message); }
  try { billing = billingConfig(env); } catch { report.errors.push('Billing origin or quota configuration is invalid.'); }
  const deployment = env.GAMESTUDIO_DEPLOYMENT || 'production';
  if (!['production','staging'].includes(deployment)) report.errors.push('GAMESTUDIO_DEPLOYMENT must be production or staging.');
  if (config) {
    const url = new URL(config.publicOrigin || 'http://invalid');
    const domain = env.GAMESTUDIO_DOMAIN || '';
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) || domain.toLowerCase() !== url.hostname || url.port) report.errors.push('GAMESTUDIO_DOMAIN must match the public HTTPS hostname, using standard port 443.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ACME_EMAIL || '')) report.errors.push('Set ACME_EMAIL to a valid certificate contact email.');
    if (env.APP_BASE_URL !== config.publicOrigin || billing?.origin !== config.publicOrigin) report.errors.push('APP_BASE_URL must exactly match GAMESTUDIO_PUBLIC_URL.');
    if (config.host !== '0.0.0.0' || config.trustProxy !== 1 || String(env.PORT || '4100') !== '4100') report.errors.push('The supplied Compose topology requires bind 0.0.0.0, port 4100 and one trusted proxy hop.');
    if (!env.GAMESTUDIO_DATA_DIR || !path.isAbsolute(env.GAMESTUDIO_DATA_DIR) || ['/', '/app', '/tmp'].includes(path.resolve(env.GAMESTUDIO_DATA_DIR))) report.errors.push('Set an absolute persistent GAMESTUDIO_DATA_DIR outside the application and temporary directories.');
    const google = checkGroup(env,['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'],'Google',report), phone = checkGroup(env,['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID'],'Twilio Verify',report);
    if (google && !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID)) report.errors.push('GOOGLE_CLIENT_ID must be a Web OAuth client ID.');
    if (!google && !phone) report.errors.push('Configure Google or Twilio Verify before public launch.');
    if (google) report.checks.push('Google credential completeness'); if (phone) report.checks.push('Twilio credential completeness');
    const secret = config.sessionSecret;
    if (secret && (!credentialLooksReal(secret) || new Set(secret).size < 12)) report.errors.push('Use a cryptographically random session secret of at least 32 bytes.');
  }
  if (billing) {
    const stripe = checkGroup(env,['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'],'Stripe',report), alipay = checkGroup(env,['ALIPAY_APP_ID','ALIPAY_SELLER_ID','ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY'],'Alipay',report);
    if (stripe) {
      if (!/^sk_(live|test)_[A-Za-z0-9]{16,}$/.test(env.STRIPE_SECRET_KEY) || !/^whsec_[A-Za-z0-9]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET)) report.errors.push('Stripe requires a valid secret key and endpoint signing secret.');
      if (deployment === 'production' && env.STRIPE_SECRET_KEY.startsWith('sk_test_')) report.errors.push('Use live Stripe credentials for production; staging must be explicit.');
      let count = 0;
      for (const plan of billing.plans.filter(p=>p.id!=='free')) for (const id of Object.values(plan.stripe)) if (id) { count++; if (!/^price_[A-Za-z0-9]+$/.test(id)) report.errors.push('Stripe recurring price IDs must use the price_ format.'); }
      if (!count) report.errors.push('Configure at least one fixed recurring Stripe paid-plan price.');
      if (env.STRIPE_PORTAL_CONFIGURATION_ID && !/^bpc_[A-Za-z0-9]+$/.test(env.STRIPE_PORTAL_CONFIGURATION_ID)) report.errors.push('Invalid Stripe portal configuration ID format.');
      report.checks.push('Stripe credential and price completeness');
    }
    if (alipay) {
      if (!/^\d{16,32}$/.test(env.ALIPAY_APP_ID) || !/^\d{16,32}$/.test(env.ALIPAY_SELLER_ID)) report.errors.push('Alipay app and seller IDs must use their numeric merchant formats.');
      for (const [name, parse] of [['ALIPAY_PRIVATE_KEY', crypto.createPrivateKey],['ALIPAY_PUBLIC_KEY', crypto.createPublicKey]]) {
        try { const key = parse(env[name].replace(/\\n/g,'\n')); if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error('Invalid key type'); }
        catch { report.errors.push(`${name} must be a valid PEM RSA key of at least 2048 bits.`); }
      }
      let count = 0;
      for (const name of ['ALIPAY_PRO_MONTHLY_AMOUNT','ALIPAY_PRO_YEARLY_AMOUNT','ALIPAY_STUDIO_MONTHLY_AMOUNT','ALIPAY_STUDIO_YEARLY_AMOUNT']) if (env[name]) { count++; const amount = minorAmount(env[name]); if (amount === null || amount <= 0) report.errors.push(`${name} must be a positive CNY amount with at most two decimal places.`); }
      if (!count) report.errors.push('Configure at least one positive Alipay paid-plan amount.');
      if (deployment === 'production' && env.ALIPAY_SANDBOX === 'true') report.errors.push('Alipay sandbox cannot be used for a production launch.');
      report.checks.push('Alipay RSA and amount completeness');
    }
    if (!stripe && !alipay) report.errors.push('Configure Stripe or Alipay and a paid plan before public launch.');
  }
  if (env.OPENAI_API_KEY && (!credentialLooksReal(env.OPENAI_API_KEY) || !/^sk-[A-Za-z0-9_-]{16,}$/.test(env.OPENAI_API_KEY))) report.errors.push('OPENAI_API_KEY must be an actual OpenAI Platform key, without placeholders.');
  if (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL !== 'https://api.openai.com/v1') report.errors.push('This deployment uses the official OpenAI endpoint; remove a custom OPENAI_BASE_URL.');
  if (probeModel && (configOnly || skipCli)) report.errors.push('--probe-model requires the complete CLI preflight.');
  if (!configOnly && config && !report.errors.length) {
    try { writeProbe(config.dataDir); report.checks.push('Persistent data write, fsync and read-back'); } catch { report.errors.push('The configured data volume is not writable by the application user.'); }
    if (!skipCli && !report.errors.length) {
      const binary = resolveCodexBin(ROOT, env.GAMESTUDIO_CODEX_BIN);
      try {
        const value = execute(binary,['--version'],{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['pipe','pipe','pipe']}); const version = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(value)?.[1];
        if (version !== EXPECTED_CLI) throw new Error('Unexpected CLI version'); report.checks.push(`Pinned Codex CLI ${EXPECTED_CLI}`);
      } catch { report.errors.push(`The project-local Codex CLI must report version ${EXPECTED_CLI}.`); }
      try {
        const value = execute(binary,['-c','cli_auth_credentials_store="file"','login','status'],{encoding:'utf8',timeout:10000,maxBuffer:65536,stdio:['pipe','pipe','pipe']});
        if (!/Logged in/i.test(value)) throw new Error('No cached login');
        const stat = fs.lstatSync(path.join(authDir,'auth.json'));
        if (stat.isSymbolicLink?.() || !stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe credential file');
        report.checks.push('Private file-based CLI login cache');
      } catch { report.errors.push('Provision an authenticated, owner-only Codex auth.json in the private credential volume.'); }
      if (probeModel && !report.errors.length) {
        try { modelProbe(binary,config.dataDir,execute); report.checks.push('Explicit gpt-6.1-sol model-access probe'); }
        catch { report.errors.push('The exact gpt-6.1-sol model probe failed. Verify account access; no fallback was attempted.'); }
      } else if (!report.errors.length) report.warnings.push('Cached CLI login does not prove model entitlement. Run the explicit --probe-model check before launch; it incurs provider usage.');
    }
  }
  if (configOnly) report.warnings.push('Configuration-only check: no credential verification, storage access, SMS, payment or generation requests were performed.');
  if (skipCli) report.warnings.push('CLI authentication/model checks were skipped. This is not a full launch preflight.');
  report.ok = report.errors.length === 0; return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2)); const permitted = new Set(['--config-only','--skip-cli','--probe-model']);
  if ([...args].some(arg=>!permitted.has(arg))) { console.error('Usage: node scripts/preflight-production.mjs [--config-only | --skip-cli | --probe-model]'); process.exitCode=1; }
  else {
    if (args.has('--probe-model')) console.error('Explicit model-access probe requested. This invokes gpt-6.1-sol and incurs provider usage.');
    const report = await runPreflight({configOnly:args.has('--config-only'),skipCli:args.has('--skip-cli'),probeModel:args.has('--probe-model')}); console.log(JSON.stringify(report,null,2)); process.exitCode = report.ok ? 0 : 1;
  }
}
