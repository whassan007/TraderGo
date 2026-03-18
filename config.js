/* ══════════════════════════════════════════════════════════════════
   CONFIG.JS — API Keys & Runtime Configuration
   ══════════════════════════════════════════════════════════════════
   ⚠  This file contains API credentials. Do not commit to a public repo.
*/

window.__FINNHUB_API_KEY = 'd47e3phr01qh8nnccgf0';

// Persist to localStorage so DevTools / backtest runner can pick it up too
try {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem('FINNHUB_API_KEY', window.__FINNHUB_API_KEY);
    }
} catch (e) {}
