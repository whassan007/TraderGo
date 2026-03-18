/* ══════════════════════════════════════════════════════════════════
   LIVE-MARKET-CONNECTOR.JS — Custom Yahoo Finance REST Backend (Browser)
   Notes:
   - Replaced Finnhub API with a free unlimited Yahoo Finance backend
     running on Google Cloud Functions (Firebase).
   ══════════════════════════════════════════════════════════════════ */

const LiveMarketConnector = (() => {
    let connected = false;
    let subscribed = new Set();
    let lastError = null;

    let quotePollTimer = null;
    const QUOTE_POLL_MS = 3000; // Poll every 3 seconds

    async function init(opts = {}) {
        // Mark MarketData as live so synthetic tickers stop moving
        try { MarketData.setMode('live'); } catch (e) { }

        await bootstrapHistorical({
            tickers: opts.tickers || ['SPY'],
            timeframes: opts.timeframes || [1, 5, 15, 60],
            bars: opts.bars || 500
        });

        connected = true;
        startQuotePolling();
        return true;
    }

    function subscribe(ticker) {
        if (!ticker) return;
        subscribed.add(ticker);
    }

    function subscribeAll(tickers) {
        (tickers || []).forEach(subscribe);
    }

    // ── Preload Historical Data ──────────────────────────────────────
    async function bootstrapHistorical({ tickers, timeframes, bars = 500 } = {}) {
        const tfList = Array.isArray(timeframes) ? timeframes : [5];
        const tickList = Array.isArray(tickers) ? tickers : ['SPY'];

        const maxConc = 4;
        const queue = [];
        tickList.forEach(ticker => {
            tfList.forEach(tf => queue.push({ ticker, tf }));
        });

        let idx = 0;
        const workers = Array.from({ length: maxConc }, async () => {
            while (idx < queue.length) {
                const { ticker, tf } = queue[idx++];
                try {
                    const candles = await _fetchCandlesBackend(ticker, tf);
                    if (candles && candles.length) {
                        MarketData.setOHLCVBuffer(ticker, tf, candles.slice(-bars));
                    }
                } catch (e) {
                    console.error('[MarketConnector] Bootstrap history error', e.message);
                }
            }
        });

        await Promise.all(workers);
        return true;
    }

    async function _fetchCandlesBackend(symbol, tf) {
        // Yahoo Finance intervals: 1m, 2m, 5m, 15m, 30m, 60m, 1d
        let interval = `${tf}m`;
        if (tf >= 1440) interval = '1d';
        
        let range = '5d';
        if (tf >= 60) range = '1mo';
        if (tf >= 1440) range = '1y';

        const url = `/api/historical?symbol=${encodeURIComponent(symbol)}&interval=${interval}&range=${range}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        return await res.json();
    }

    // ── Live Quote Polling ──────────────────────────────────────────
    function startQuotePolling() {
        stopQuotePolling();
        
        quotePollTimer = setInterval(async () => {
            // Poll for current primary charts/watchlists
            try {
                const activeTickers = new Set();
                
                // Add the main chart ticker
                if (typeof ChartEngine !== 'undefined' && ChartEngine.getCurrentTicker) {
                    activeTickers.add(ChartEngine.getCurrentTicker());
                } else if (subscribed.size > 0) {
                    const first = [...subscribed][0];
                    activeTickers.add(first);
                }
                
                // Bulk polling logic could be added to backend, for now poll sequentially
                for (const ticker of activeTickers) {
                    const q = await _fetchQuoteBackend(ticker);
                    if (q && q.price) {
                        const now = typeof q.time === 'number' ? q.time : Math.floor(Date.now() / 1000);
                        MarketData.updatePrice(ticker, q.price, q.volume, null, null, now);
                        
                        try { MarketData.setDataSource(ticker, 'live'); } catch (e) { }
                    }
                }
            } catch (e) {
                lastError = e?.message;
                // Downgrade to cached visually if failing
                try {
                    [...subscribed].forEach(sym => MarketData.setDataSource(sym, 'cached'));
                } catch(err) {} 
            }
        }, QUOTE_POLL_MS);
    }

    function stopQuotePolling() {
        if (quotePollTimer) clearInterval(quotePollTimer);
        quotePollTimer = null;
    }

    async function _fetchQuoteBackend(symbol) {
        const url = `/api/quote?symbol=${encodeURIComponent(symbol)}`;
        const res = await fetch(url);
        if(!res.ok) return null;
        return await res.json();
    }

    function getStatus() {
        return { connected, subscribed: [...subscribed], lastError };
    }

    function shutdown() {
        stopQuotePolling();
        connected = false;
        subscribed = new Set();
    }

    return {
        init,
        setApiKey: () => {}, // No-op now
        subscribe,
        subscribeAll,
        bootstrapHistorical,
        getStatus,
        shutdown,
        isConnected: () => connected
    };
})();
