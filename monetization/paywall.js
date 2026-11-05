/* ============================================================================
 * paywall.js — controller for the Zovo upgrade / paywall modal.
 * ----------------------------------------------------------------------------
 * ES module. Pairs with paywall.html + paywall.css and reuses the license
 * core from feature-gate.js (single source of truth for verification).
 *
 *   import { ZovoPaywall } from './paywall.js';
 *   ZovoPaywall.init({
 *     extName: 'Clean Print',
 *     extKey:  'clean-print',
 *     price:   99,                       // current lifetime price (the ONLY price ever charged)
 *     priceNote: 'One-time payment — no subscription, ever',
 *     freeFeatures: ['1-click declutter', 'Print / save as PDF'],
 *   });
 *   // then, from a locked Pro feature:
 *   ZovoPaywall.open();
 *
 * No eval, no innerHTML with untrusted data, no hardcoded secrets.
 * ========================================================================== */

import { verifyLicenseKey, trialDaysLeft, startTrial, emit, setEventSink } from './feature-gate.js';

const MEMBERSHIP_URL = 'https://zovo.one/pricing';
const MANAGE_URL = 'https://zovo.one/account';

let state = { extKey: '', mounted: false, lastFocus: null, trialDays: 7 };

/* ---- public API ----------------------------------------------------------- */
export const ZovoPaywall = {
  // opts: extName, extKey, price, priceNote, reframe,
  //       guaranteeDays, trialDays, freeFeatures[], proFeatures[], onEvent(fn)
  //  (NO origPrice/"was $X" strike, NO scarcity/social-proof opts — fabricated proof
  //   is a CWS Spam takedown trigger, see CWS-COMPLIANCE-RULES.md §A. Removed at source.)
  init(opts = {}) {
    const root = document.getElementById('zovo-paywall');
    if (!root) return console.warn('[zovo] paywall markup not found');
    state.extKey = opts.extKey || root.dataset.extKey || 'zovo';
    state.trialDays = Number(opts.trialDays) > 0 ? Number(opts.trialDays) : 7;
    if (typeof opts.onEvent === 'function') setEventSink(opts.onEvent);  // conversion funnel sink
    applyCopy(root, opts);
    applyPsychology(root, opts);
    wireCta(root, state.extKey, opts.price);
    wireTrial(root, state.extKey);
    wireFreeFeatures(root, opts.freeFeatures || []);
    wireProFeatures(root, opts.proFeatures || []);
    wireClose(root);
    wireKeyForm(root, state.extKey);
    state.mounted = true;
  },
  async open(context = {}) {
    const root = document.getElementById('zovo-paywall');
    if (!root || !state.mounted) return;
    await renderTrial(root);
    emit('paywall_shown', { extKey: state.extKey, ...context });   // funnel: impression
    state.lastFocus = document.activeElement;
    root.hidden = false;
    document.addEventListener('keydown', onKeydown, true);
    const cta = root.querySelector('#zovo-upgrade-cta');
    if (cta) cta.focus();
  },
  close() {
    const root = document.getElementById('zovo-paywall');
    if (!root) return;
    root.hidden = true;
    document.removeEventListener('keydown', onKeydown, true);
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  },
};

/* ---- copy + pricing ------------------------------------------------------- */
function applyCopy(root, opts) {
  const price = Number(opts.price) > 0 ? Number(opts.price) : 99;
  const set = (id, text) => { const el = root.querySelector(id); if (el) el.textContent = text; };
  if (opts.extName) set('#zovo-paywall-title', `Unlock ${opts.extName} Pro`);
  set('#zovo-price', `$${price}`);
  // Default note is a NEUTRAL fact, never fabricated urgency (invented scarcity, a
  // rising-price claim, or a countdown) — that is banned under CWS §A. Author may
  // override via opts.priceNote but only with a true statement.
  set('#zovo-anchor-note',
    opts.priceNote || 'One-time payment — no subscription, ever.');
}

function wireFreeFeatures(root, features) {
  const ul = root.querySelector('#zovo-free-features');
  if (!ul) return;
  ul.textContent = '';
  for (const f of features.slice(0, 6)) {
    const li = document.createElement('li');       // textContent, never innerHTML
    li.textContent = String(f);
    ul.appendChild(li);
  }
}

function wireProFeatures(root, features) {
  const ul = root.querySelector('#zovo-pro-features');
  if (!ul) return;
  ul.textContent = '';
  for (const f of features.slice(0, 6)) {
    const li = document.createElement('li');       // textContent, never innerHTML
    li.textContent = String(f);
    ul.appendChild(li);
  }
}

/* ---- CTA (UTM-tagged) ----------------------------------------------------- */
function utm(base, extKey) {
  const u = new URL(base);
  u.searchParams.set('utm_source', extKey);
  u.searchParams.set('utm_medium', 'extension');
  u.searchParams.set('utm_campaign', 'upgrade');
  return u.toString();
}
function wireCta(root, extKey, price) {
  const cta = root.querySelector('#zovo-upgrade-cta');
  if (cta) {
    cta.href = utm(MEMBERSHIP_URL, extKey);
    const p = Number(price) > 0 ? Number(price) : 99;
    cta.textContent = `Get Pro — $${p} Lifetime`;
    cta.addEventListener('click', () => emit('cta_click', { extKey, price: p }));  // funnel: intent
  }
  const manage = root.querySelector('#zovo-manage-link');
  if (manage) manage.href = utm(MANAGE_URL, extKey);
}

/* ---- conversion psychology (anchor · reframe · risk-reversal) ---
 * CONTRACT: every numeric/social claim passed in here MUST reflect REAL, verifiable
 * data. NO fabricated scarcity ("N seats left"), NO invented "was" price, NO made-up
 * member counts — these are CWS Spam & Placement takedown triggers (see
 * ../CWS-COMPLIANCE-RULES.md §A). When in doubt, omit the opt — the element stays
 * hidden by default. Empty is always safer than fake.
 * -------------------------------------------------------------------------------------------- */
function applyPsychology(root, opts) {
  const price = Number(opts.price) > 0 ? Number(opts.price) : 99;
  const show = (id, text) => { const el = root.querySelector(id); if (el) { el.textContent = text; el.hidden = false; } };
  // NO "was $X" strike-through anchor. This fleet has only ever charged $99, so any
  // higher "original" price is fabricated scarcity (CWS §A) — the #zovo-price-was element
  // stays hidden permanently. Removed at source; do not reintroduce origPrice.
  // Value reframe: one-time vs a recurring competitor cost (no fabrication — always safe).
  if (opts.reframe) show('#zovo-reframe', opts.reframe);
  // Risk reversal.
  const days = Number(opts.guaranteeDays) > 0 ? Number(opts.guaranteeDays) : 30;
  show('#zovo-guarantee', `${days}-day money-back guarantee · cancel anytime · zero data collection`);
}

/* ---- frictionless trial CTA (no card) ------------------------------------- */
function wireTrial(root, extKey) {
  const btn = root.querySelector('#zovo-trial-cta');
  if (!btn) return;
  btn.hidden = false;
  btn.textContent = `Start ${state.trialDays}-day free trial — no card`;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const r = await startTrial(extKey, state.trialDays);   // emits trial_start
    if (r.ok) {
      document.dispatchEvent(new CustomEvent('zovo:trial-started', { detail: { days: state.trialDays } }));
      ZovoPaywall.close();
    } else {
      btn.disabled = false;
      const status = root.querySelector('#zovo-key-status');
      if (status) setStatus(status, r.reason === 'already-used' ? 'Your trial was already used — upgrade to keep Pro.' : 'Could not start trial.', 'is-err');
    }
  });
}

/* ---- trial countdown ------------------------------------------------------ */
async function renderTrial(root) {
  const box = root.querySelector('#zovo-trial');
  const txt = root.querySelector('#zovo-trial-text');
  if (!box || !txt) return;
  const days = await trialDaysLeft();
  if (days > 0) {
    txt.textContent = days === 1 ? 'Last day of your Pro trial' : `${days} days left in your Pro trial`;
    box.hidden = false;
  } else {
    box.hidden = true;
  }
}

/* ---- close / focus trap --------------------------------------------------- */
function wireClose(root) {
  root.querySelectorAll('[data-paywall-close]').forEach((el) =>
    el.addEventListener('click', () => ZovoPaywall.close()));
}
function onKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); ZovoPaywall.close(); }
}

/* ---- license key verify flow --------------------------------------------- */
function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.classList.remove('is-ok', 'is-err', 'is-busy');
  if (kind) el.classList.add(kind);
}
function wireKeyForm(root, extKey) {
  const form = root.querySelector('#zovo-key-form');
  const input = root.querySelector('#zovo-key-input');
  const btn = root.querySelector('#zovo-key-verify');
  const status = root.querySelector('#zovo-key-status');
  if (!form || !input || !btn || !status) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = input.value.trim();
    if (key.length < 8) return setStatus(status, 'That does not look like a valid key.', 'is-err');
    btn.disabled = true;
    setStatus(status, 'Verifying…', 'is-busy');
    const r = await verifyLicenseKey(key, extKey);
    btn.disabled = false;
    if (r.ok) {
      setStatus(status, 'Pro activated. Thank you for supporting Zovo!', 'is-ok');
      document.dispatchEvent(new CustomEvent('zovo:license-activated', { detail: { tier: r.tier } }));
      setTimeout(() => ZovoPaywall.close(), 1400);
    } else {
      setStatus(status, reasonToMessage(r.reason), 'is-err');
    }
  });
}
function reasonToMessage(reason) {
  const map = {
    timeout: 'Verification timed out. Check your connection and try again.',
    network: 'Could not reach the license server. Try again shortly.',
    'bad-schema': 'Unexpected server response. Please contact support@zovo.one.',
    'invalid-format': 'That key is not in the expected format.',
  };
  return map[reason] || 'That key could not be verified. Double-check and retry.';
}
