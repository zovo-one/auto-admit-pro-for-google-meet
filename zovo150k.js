/* ============================================================================
 * zovo150k.js — Zovo "150K daily users" celebration banner. v1.1
 *
 * Self-contained, zero dependencies, zero network calls, zero new permissions.
 * Own pages only (action popup / options / whats-new). Never a content script.
 * In-flow top banner — never an overlay, never blocks functionality.
 * DOM built with createElement/textContent only (no innerHTML, no __MSG_).
 *
 * The injector replaces the CFG line below per extension.
 * Countdown: 48h per user from first view, hard-capped at CFG.endEpoch
 * (the Stripe coupon redeem_by). On expiry the banner deletes itself and
 * never renders again. The urgency is real — enforced here and in Stripe.
 * ==========================================================================*/
(() => {
  'use strict';

  /*__CFG_LINE__*/
  const CFG = {"code":"ZOVO150K","endEpoch":1791849595,"hue":248,"popupPages":["popup"],"checkoutUrl":"https://zovo.one/pricing?utm_source=auto-admit-pro-for-google-me-d396&utm_medium=extension&utm_campaign=zovo150k&utm_content={surface}","copy":{"title":"150K daily users. Thank you.","bodyShort":"150K of you use Zovo every day. Thank you. Take 50% off Pro, Monthly or Lifetime, with code ZOVO150K. Your 48 hours start now.","bodyLong":"Four years of building, and 150K of you now use Zovo every day. Thank you. More users means more support, upkeep and hardware on our side, so if Pro has saved you time this is a fair moment to back it. Take 50% off Pro Monthly or Lifetime with code ZOVO150K, one use per customer.","cta":"Get 50% off Pro","copied":"Copied!","toast":"Code copied. Paste it at checkout.","copyTitle":"Copy code ZOVO150K","fine":"One use per customer. Applies to Zovo Pro Monthly and Lifetime. Your code works for 48 hours from your first view of this banner, then expires for good. 14-day money-back, no questions.","later":"Maybe later","dismissAria":"Dismiss this offer","ariaLabel":"Zovo 150K users celebration offer","timerLabel":"Your 50% code expires in {time}"}}; /* baked for auto-admit-pro-for-google-me-d396 */
  if (!CFG || !CFG.endEpoch || !CFG.code || !CFG.copy) return;

  const STORAGE_KEY = 'zovo150k.v1';
  const WINDOW_S = 48 * 3600;        // 48h per user, from first view
  const nowS = () => Math.floor(Date.now() / 1000);
  const HUE = String(CFG.hue ?? 248); // 248 = canonical zovo #6C5CE7

  /* ------------------------------------------------ storage */
  const mem = {};
  const store = {
    get() {
      return new Promise((resolve) => {
        try {
          if (globalThis.chrome?.storage?.local) {
            chrome.storage.local.get(STORAGE_KEY, (r) => resolve(r?.[STORAGE_KEY] || {}));
          } else resolve(mem[STORAGE_KEY] || {});
        } catch { resolve(mem[STORAGE_KEY] || {}); }
      });
    },
    set(patch) {
      return this.get().then((cur) => {
        const next = { ...cur, ...patch };
        try {
          if (globalThis.chrome?.storage?.local) chrome.storage.local.set({ [STORAGE_KEY]: next });
          else mem[STORAGE_KEY] = next;
        } catch { mem[STORAGE_KEY] = next; }
        return next;
      });
    },
  };

  const endsAt = (st) => Math.min((st.firstSeen || nowS()) + WINDOW_S, CFG.endEpoch);

  /* Runtime surface detection: one file serves every patched page. The injector
   * bakes CFG.popupPages (basenames). Popup pages get short copy; other pages
   * get the long variant. {surface} in checkoutUrl resolves to the page name. */
  const pageName = () => (location.pathname.split('/').pop() || 'index.html').replace(/\.html?$/i, '');
  const isPopup = () => (CFG.popupPages || []).includes(pageName());
  const copyVariant = () => ({
    ...CFG.copy,
    body: isPopup() ? CFG.copy.bodyShort : CFG.copy.bodyLong,
  });
  const resolvedCheckoutUrl = () =>
    CFG.checkoutUrl.replace('{surface}', encodeURIComponent(pageName()));

  /* ------------------------------------------------ styles (constructible first: immune to style-src CSP) */
  const css = `
    :host { all: initial; }
    .w { box-sizing: border-box; display: block; width: 100%;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: zin .45s cubic-bezier(.22,1,.36,1); margin: 0 0 10px; color-scheme: light dark; }
    @keyframes zin { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .w { animation: none; } }
    .card { position: relative; box-sizing: border-box; width: 100%;
      border-radius: 12px; padding: 13px 15px 11px;
      background: linear-gradient(135deg, hsl(${HUE} 72% 97%), hsl(${HUE} 60% 93%)) padding-box,
        linear-gradient(120deg, hsl(${HUE} 85% 62%), hsl(calc(${HUE} + 40) 80% 55%)) border-box;
      border: 1.5px solid transparent;
      box-shadow: 0 2px 8px rgb(0 0 0 / .06), 0 4px 18px hsl(${HUE} 60% 40% / .16);
      color: #1A1A2E; }
    @media (prefers-color-scheme: dark) {
      .card { background: linear-gradient(135deg, hsl(${HUE} 30% 14%), hsl(${HUE} 35% 10%)) padding-box,
          linear-gradient(120deg, hsl(${HUE} 85% 62%), hsl(calc(${HUE} + 40) 80% 55%)) border-box;
        color: #F5F5FA; box-shadow: 0 4px 18px hsl(${HUE} 60% 10% / .5); } }
    .titlerow { display: flex; align-items: center; gap: 7px; margin: 0 22px 5px 0; }
    .pill { flex: 0 0 auto; font-size: 10px; font-weight: 800; letter-spacing: .05em;
      padding: 2.5px 7px; border-radius: 999px; color: #fff;
      background: linear-gradient(120deg, #F59E0B, #D97706); }
    .title { font-size: 14.5px; font-weight: 700; letter-spacing: -.01em; line-height: 1.3; }
    .body { font-size: 12.5px; line-height: 1.5; margin: 0 0 9px; opacity: .92; }
    .timer { display: inline-flex; align-items: center; gap: 6px;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums;
      padding: 3px 9px; border-radius: 999px; margin-bottom: 9px;
      background: hsl(${HUE} 85% 45% / .14); color: hsl(${HUE} 70% 32%);
      border: 1px solid hsl(${HUE} 70% 45% / .35); }
    @media (prefers-color-scheme: dark) { .timer { color: hsl(${HUE} 80% 75%); } }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor;
      animation: zpulse 1.6s ease-in-out infinite; }
    @keyframes zpulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .row { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
    .code { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px;
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px; font-weight: 600; letter-spacing: .04em;
      padding: 8px 11px; border-radius: 9px; cursor: pointer;
      background: transparent; color: inherit;
      border: 1.5px dashed hsl(${HUE} 65% 45% / .65); }
    .code:hover { background: hsl(${HUE} 70% 45% / .1); }
    .code svg { width: 13px; height: 13px; opacity: .75; }
    .cta { flex: 1 1 auto; min-width: 128px; border: 0; border-radius: 9px; padding: 8px 12px;
      font-family: inherit; font-size: 13px; font-weight: 700; cursor: pointer; color: #fff;
      background: linear-gradient(120deg, #F59E0B, #D97706);
      box-shadow: 0 2px 8px rgb(245 158 11 / .35);
      transition: transform .12s ease-in-out, box-shadow .12s ease-in-out; }
    .cta:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgb(245 158 11 / .45); }
    .cta:active { transform: none; }
    .fine { font-size: 10.5px; opacity: .62; margin: 8px 0 0; line-height: 1.45; flex: 1 1 auto; }
    .foot { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
    .x { position: absolute; top: 7px; right: 7px; width: 24px; height: 24px;
      border: 0; border-radius: 7px; background: transparent; color: inherit;
      font-size: 15px; line-height: 1; cursor: pointer; opacity: .55; }
    .x:hover { opacity: 1; background: hsl(${HUE} 40% 50% / .12); }
    .later { flex: 0 0 auto; border: 0; background: transparent;
      color: inherit; font-size: 10.5px; cursor: pointer; opacity: .55; padding: 3px 5px;
      border-radius: 6px; font-family: inherit; }
    .later:hover { opacity: 1; }
    .toast { margin: 7px 0 0; font-size: 11px; font-weight: 600; color: hsl(${HUE} 70% 32%);
      opacity: 0; transition: opacity .2s ease-in-out; min-height: 0; }
    @media (prefers-color-scheme: dark) { .toast { color: hsl(${HUE} 80% 75%); } }
  `;

  /* ------------------------------------------------ DOM helpers (no innerHTML) */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const copyIcon = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '9'); rect.setAttribute('y', '9');
    rect.setAttribute('width', '12'); rect.setAttribute('height', '12'); rect.setAttribute('rx', '2');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 15V5a2 2 0 0 1 2-2h10');
    svg.append(rect, path);
    return svg;
  };

  /* ------------------------------------------------ build */
  function build(state, handlers) {
    const copy = copyVariant();
    const host = el('div'); host.id = 'zovo-150k-banner';
    const shadow = host.attachShadow({ mode: 'open' });

    let sheetOk = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
      sheetOk = true;
    } catch { /* fall through */ }
    if (!sheetOk) { const st = el('style'); st.textContent = css; shadow.appendChild(st); }

    const wrap = el('div', 'w');
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', copy.ariaLabel);
    const card = el('div', 'card');

    const x = el('button', 'x', '×');
    x.type = 'button'; x.setAttribute('aria-label', copy.dismissAria);
    const later = el('button', 'later', copy.later);
    later.type = 'button';

    const titlerow = el('div', 'titlerow');
    const pill = el('span', 'pill', '50% OFF');
    const title = el('span', 'title', copy.title);
    titlerow.append(pill, title);

    const body = el('p', 'body', copy.body);

    const timer = el('span', 'timer');
    timer.setAttribute('aria-live', 'polite');
    const dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true');
    const tEl = el('span', 't');
    timer.append(dot, tEl);

    const row = el('div', 'row');
    const codeBtn = el('button', 'code'); codeBtn.type = 'button';
    codeBtn.title = copy.copyTitle;
    const codeLabel = el('span', 'c', CFG.code);
    codeBtn.append(codeLabel, copyIcon());
    const cta = el('button', 'cta', copy.cta); cta.type = 'button';
    row.append(codeBtn, cta);

    const fine = el('p', 'fine', copy.fine);
    const foot = el('div', 'foot');
    foot.append(fine, later);

    const toast = el('p', 'toast');
    toast.setAttribute('role', 'status');

    card.append(x, titlerow, body, timer, row, foot, toast);
    wrap.appendChild(card);
    shadow.appendChild(wrap);

    /* countdown — house format: "47h 12m" -> "41m 09s" under 1h -> "under a minute" */
    const tick = () => {
      const left = endsAt(state) - nowS();
      if (left <= 0) { clearInterval(iv); handlers.expire(host); return; }
      let t;
      if (left >= 3600) t = `${Math.floor(left / 3600)}h ${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}m`;
      else if (left >= 60) t = `${String(Math.floor(left / 60)).padStart(2, '0')}m ${String(left % 60).padStart(2, '0')}s`;
      else t = 'under a minute';
      tEl.textContent = copy.timerLabel.replace('{time}', t);
    };
    const iv = setInterval(tick, 1000); tick();

    /* copy-to-clipboard (gesture context, execCommand fallback) */
    const copyCode = async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(CFG.code); ok = true; }
      catch {
        try {
          const ta = el('textarea'); ta.value = CFG.code;
          ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          ok = document.execCommand('copy'); ta.remove();
        } catch { ok = false; }
      }
      if (ok) {
        store.set({ codeCopied: true });
        codeLabel.textContent = copy.copied;
        codeBtn.style.borderStyle = 'solid';
        toast.textContent = copy.toast;
        toast.style.opacity = '1';
        setTimeout(() => { codeLabel.textContent = CFG.code; toast.style.opacity = '0'; }, 1600);
      }
      return ok;
    };

    codeBtn.addEventListener('click', copyCode);
    cta.addEventListener('click', async () => {
      await copyCode();
      store.set({ ctaClicked: true });
      window.open(resolvedCheckoutUrl(), '_blank', 'noopener');
    });
    x.addEventListener('click', () => handlers.dismiss(host));
    later.addEventListener('click', () => handlers.dismiss(host));

    return host;
  }

  /* ------------------------------------------------ mount */
  async function main() {
    const state = await store.get();
    if (state.dismissed) return;
    if (!state.firstSeen) state.firstSeen = nowS();
    if (nowS() >= endsAt(state)) { store.set({ dismissed: true }); return; }
    store.set({ firstSeen: state.firstSeen });

    const dismiss = (host) => {
      store.set({ dismissed: true }); // house rule: dismissal persists, never re-fires mid-task
      host.style.transition = 'opacity .25s ease-in-out';
      host.style.opacity = '0';
      setTimeout(() => host.remove(), 260);
    };
    const expire = (host) => { store.set({ dismissed: true }); host.remove(); };

    const mountNow = () => {
      if (document.getElementById('zovo-150k-banner')) return;
      document.body.prepend(build(state, { dismiss, expire }));
    };
    if (document.body) mountNow();
    else document.addEventListener('DOMContentLoaded', mountNow, { once: true });
  }

  main();
})();
