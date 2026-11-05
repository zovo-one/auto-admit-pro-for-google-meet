/* ============================================================================
 * feature-gate.js — Zovo Pro tier middleware + license verification core.
 * ----------------------------------------------------------------------------
 * ES module. Import into the service worker, popup, and options page:
 *     import { gate, getTier, verifyLicenseKey, startTrial } from './feature-gate.js';
 *
 * Responsibilities:
 *   - Resolve tier (free | trial | pro) from a SERVER-VERIFIED cache.
 *   - Start a no-card local trial (the #1 conversion lever).
 *   - Wrap any Pro feature so it runs only for Pro/trial, else falls back free.
 *   - Emit conversion funnel events so paywall performance is measurable.
 *
 * Anti-tamper (honest): a client cannot self-authorize the PAID tier. The 'pro'
 * cache is only ever written from a server response tied to a real key, and
 * getTier() forces a fresh server verdict past VERIFY_TTL. A local 'trial' IS
 * client-trusted by design (trials are meant to be frictionless) and is purely
 * time-based — it is never sent to the server and expires locally.
 *
 * Security: no eval, no innerHTML, no hardcoded secrets. The Supabase anon
 * (publishable, RLS-scoped) key is injected at build. HTTPS enforced.
 * ========================================================================== */

const LICENSE_API =
  'https://zgubxqomnbmxgbdhvwja.supabase.co/functions/v1/verify-extension-license';
const SUPABASE_ANON_KEY = 'sb_publishable_RG4IVO9Qm23_xPzdQjdFPQ_QHBwbOLv';   // publishable (RLS-scoped) — safe to ship

const CACHE_KEY = 'zovo_license';
const RL_KEY = 'zovo_license_rl';
const VERIFY_TTL = 30 * 60 * 1000;          // re-verify online every 30 min
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;   // offline grace: 7 days
const REQUEST_TIMEOUT = 10 * 1000;          // 10s AbortController budget
const RL_MAX = 6;                            // max verify attempts…
const RL_WINDOW = 60 * 1000;                 // …per 60s (brute-force guard)
const TRIAL_PREFIX = 'TRIAL-LOCAL';          // local trials never hit the server
const PRO_TIERS = new Set(['pro', 'trial']);
export const LICENSE_ALARM = 'zovo-license-reverify';   // 12h SW alarm name

/* ---- conversion funnel instrumentation ------------------------------------ */
// Wire a sink (e.g. your analytics relay) once at startup: setEventSink(fn).
// Events: paywall_shown, cta_click, trial_start, key_verified, verify_failed.
let _sink = null;
export function setEventSink(fn) { if (typeof fn === 'function') _sink = fn; }
export function emit(name, detail = {}) {
  try { if (_sink) _sink(name, { t: Date.now(), ...detail }); } catch { /* never break UX */ }
}

/* ---- storage helpers ------------------------------------------------------ */
async function readCache() {
  const bag = await chrome.storage.local.get(CACHE_KEY);
  const c = bag[CACHE_KEY];
  return isValidCache(c) ? c : null;
}
async function writeCache(cache) { await chrome.storage.local.set({ [CACHE_KEY]: cache }); }
export async function clearLicense() { await chrome.storage.local.remove(CACHE_KEY); }

/* ---- schema validation ---------------------------------------------------- */
function isValidLicenseResponse(o) {
  if (!o || typeof o !== 'object') return false;
  if (typeof o.valid !== 'boolean') return false;
  // 'lifetime' MUST be here. Without it a lifetime response fails schema
  // validation and is discarded as a malformed reply, not a refused key.
  if (typeof o.tier !== 'string' || !['free', 'trial', 'pro', 'lifetime'].includes(o.tier)) return false;
  return true;
}
function isValidCache(c) {
  if (!c || typeof c !== 'object') return false;
  if (typeof c.key !== 'string' || c.key.length < 8) return false;
  if (!['free', 'trial', 'pro', 'lifetime'].includes(c.tier)) return false;
  if (typeof c.verifiedAt !== 'number') return false;
  return true;
}

/* ---- rate limiting (brute-force guard on verify) -------------------------- */
async function rateOk() {
  const bag = await chrome.storage.local.get(RL_KEY);
  const now = Date.now();
  const hits = (bag[RL_KEY] || []).filter((t) => now - t < RL_WINDOW);
  if (hits.length >= RL_MAX) return false;
  hits.push(now);
  await chrome.storage.local.set({ [RL_KEY]: hits });
  return true;
}

/* ---- server verification -------------------------------------------------- */
// POST a license key to Supabase; cache + return the validated verdict.
// NOTE: field names match the canonical live contract: { license_key, extension }.
export async function verifyLicenseKey(licenseKey, extKey) {
  const key = String(licenseKey || '').trim();
  if (key.length < 8) return { ok: false, tier: 'free', reason: 'invalid-format' };
  if (!LICENSE_API.startsWith('https://')) return { ok: false, tier: 'free', reason: 'insecure' };
  if (!(await rateOk())) return { ok: false, tier: 'free', reason: 'rate-limited' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(LICENSE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ license_key: key, extension: extKey }),
      signal: controller.signal,
    });
    if (!res.ok) { emit('verify_failed', { extKey, reason: `http-${res.status}` }); return { ok: false, tier: 'free', reason: `http-${res.status}` }; }
    const data = await res.json();
    if (!isValidLicenseResponse(data)) { emit('verify_failed', { extKey, reason: 'bad-schema' }); return { ok: false, tier: 'free', reason: 'bad-schema' }; }
    const tier = data.valid ? data.tier : 'free';
    const trialEndsAt = data.trialEndsAt ?? data.expiresAt ?? null;   // accept either field
    await writeCache({ key, tier, verifiedAt: Date.now(), trialEndsAt });
    if (data.valid) emit('key_verified', { extKey, tier }); else emit('verify_failed', { extKey, reason: 'invalid-key' });
    return { ok: data.valid, tier, trialEndsAt };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : 'network';
    emit('verify_failed', { extKey, reason });
    return { ok: false, tier: 'free', reason };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- frictionless local trial (the #1 conversion lever) ------------------- */
// Starts a no-account, no-card trial. Once-only (won't reset an expired trial).
export async function startTrial(extKey, days = 7) {
  const existing = await readCache();
  if (existing && (existing.tier === 'pro' || String(existing.key).startsWith(TRIAL_PREFIX))) {
    return { ok: false, reason: 'already-used' };            // no repeat trials
  }
  const trialEndsAt = Date.now() + days * 24 * 60 * 60 * 1000;
  await writeCache({ key: `${TRIAL_PREFIX}-${extKey}`, tier: 'trial', verifiedAt: Date.now(), trialEndsAt });
  emit('trial_start', { extKey, days });
  return { ok: true, tier: 'trial', trialEndsAt };
}

/* ---- tier resolution ------------------------------------------------------ */
async function refreshIfStale(extKey, cache) {
  if (!cache) return null;
  if (String(cache.key).startsWith(TRIAL_PREFIX)) return cache;   // trials are local-only
  if (Date.now() - cache.verifiedAt < VERIFY_TTL) return cache;
  const r = await verifyLicenseKey(cache.key, extKey);
  if (r.reason === 'timeout' || r.reason === 'network') return cache;   // offline: keep
  return await readCache();
}

export async function getTier(extKey) {
  let cache = await readCache();
  cache = await refreshIfStale(extKey, cache);
  if (!cache) return 'free';
  if (cache.tier === 'trial') {
    if (cache.trialEndsAt && Date.now() > cache.trialEndsAt) return 'free';
    return 'trial';
  }
  if (Date.now() - cache.verifiedAt > GRACE_MS) return 'free';    // paid grace expired offline
  return cache.tier;
}

export async function isPro(extKey) { return PRO_TIERS.has(await getTier(extKey)); }

export async function trialDaysLeft() {
  const cache = await readCache();
  if (!cache || cache.tier !== 'trial' || !cache.trialEndsAt) return 0;
  const ms = cache.trialEndsAt - Date.now();
  return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
}

/* ---- periodic re-verify (call once from the service worker) --------------- */
// Propagates revocation within 12h even if getTier is never called.
export function registerLicenseAlarm(extKey) {
  try {
    chrome.alarms.create(LICENSE_ALARM, { periodInMinutes: 720 });
    chrome.alarms.onAlarm.addListener(async (a) => {
      if (a.name !== LICENSE_ALARM) return;
      const c = await readCache();
      if (c && !String(c.key).startsWith(TRIAL_PREFIX)) await verifyLicenseKey(c.key, extKey);
    });
  } catch { /* alarms unavailable in this context — lazy TTL still covers it */ }
}

/* ---- the gate middleware -------------------------------------------------- */
export async function gate(extKey, { pro, free, onLocked } = {}) {
  const allowed = await isPro(extKey);
  if (allowed && typeof pro === 'function') return pro();
  if (!allowed && typeof onLocked === 'function') onLocked();
  if (typeof free === 'function') return free();
  return undefined;
}

export const _internals = { VERIFY_TTL, GRACE_MS, TRIAL_PREFIX, isValidLicenseResponse, isValidCache };
