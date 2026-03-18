/* ══════════════════════════════════════════════════════════════════
   LIVE-MARKET-CONNECTOR.JS — Finnhub WS + REST bootstrap (Browser)
   Notes:
   - This runs in the browser (static app). API keys cannot be truly
     secured client-side; use a server proxy for production.
   - For dev, store FINNHUB key in localStorage: FINNHUB_API_KEY
   ══════════════════════════════════════════════════════════════════ */

const LiveMarketConnector = (() => {
    let ws = null;
    let apiKey = null;
    let connected = false;
    let subscribed = new Set();
    let lastError = null;

    // Throttled quote polling (Finnhub trades stream does not include bid/ask)
    let quotePollTimer = null;
    const QUOTE_POLL_MS = 5000;

    function _getKey() {
        return apiKey
            || (typeof window !== 'undefined' && window.__FINNHUB_API_KEY)
            || (typeof localStorage !== 'undefined' && localStorage.getItem('FINNHUB_API_KEY'))
            || null;
    }

    function setApiKey(key) {
        apiKey = key;
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('FINNHUB_API_KEY', key); } catch (e) { }
    }

    async function init(opts = {}) {
        apiKey = opts.apiKey || _getKey();
        if (!apiKey) {
            lastError = 'Missing FINNHUB_API_KEY';
            return false;
        }

        // Mark MarketData as live so synthetic tickers stop moving
        try { MarketData.setMode('live'); } catch (e) { }

        await bootstrapHistorical({
            tickers: opts.tickers || ['SPY'],
            timeframes: opts.timeframes || [1, 5, 15, 60],
            bars: opts.bars || 500
        });

        connectWS();
        startQuotePolling();
        return true;
    }

    function connectWS() {
        const key = _getKey();
        if (!key) return false;
        disconnectWS();

        const url = `wss://ws.finnhub.io?token=${encodeURIComponent(key)}`;
        ws = new WebSocket(url);

        ws.addEventListener('open', () => {
            connected = true;
            // Subscribe to any pre-queued tickers
            [...subscribed].forEach(sym => _sendSub(sym));
        });

        ws.addEventListener('message', (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                if (!msg) return;

                // Trade stream format: { type:'trade', data:[{s, p, t, v}, ...] }
                if (msg.type === 'trade' && Array.isArray(msg.data)) {
                    msg.data.forEach(t => {
                        const ticker = t.s;
                        const price = t.p;
                        const ts = typeof t.t === 'number' ? Math.floor(t.t / 1000) : Math.floor(Date.now() / 1000);
                        const vol = t.v;
                        MarketData.updatePrice(ticker, price, vol, null, null, ts);
                        try { MarketData.setDataSource(ticker, 'live'); } catch (e) { }
                    });
                }
            } catch (e) {
                lastError = e?.message || String(e);
            }
        });

        ws.addEventListener('error', () => {
            lastError = 'WebSocket error';
        });

        ws.addEventListener('close', () => {
            connected = false;
            // Downgrade all subscribed tickers to cached
            try {
                [...subscribed].forEach(sym => MarketData.setDataSource(sym, 'cached'));
            } catch (e) { }
            // Auto-reconnect with backoff
            setTimeout(() => {
                if (!connected) connectWS();
            }, 1500);
        });

        return true;
    }

    function disconnectWS() {
        try { if (ws) ws.close(); } catch (e) { }
        ws = null;
        connected = false;
    }

    function subscribe(ticker) {
        if (!ticker) return;
        subscribed.add(ticker);
        if (connected) _sendSub(ticker);
    }

    function subscribeAll(tickers) {
        (tickers || []).forEach(subscribe);
    }

    function _sendSub(ticker) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        try {
            ws.send(JSON.stringify({ type: 'subscribe', symbol: ticker }));
        } catch (e) {
            lastError = e?.message || String(e);
        }
    }

    async function bootstrapHistorical({ tickers, timeframes, bars = 500 } = {}) {
        const key = _getKey();
        if (!key) return false;
        const tfList = Array.isArray(timeframes) ? timeframes : [5];
        const tickList = Array.isArray(tickers) ? tickers : ['SPY'];

        // Finnhub candles use from/to unix seconds and resolution in {1,5,15,30,60,D,W,M}
        const now = Math.floor(Date.now() / 1000);
        // Rough window: 500 5m bars ≈ 2.2 days; add buffer so markets gaps don’t underfill
        const from = now - 60 * 60 * 24 * 10;

        // Concurrency-limited fetch
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
                    const candles = await fetchCandlesFinnhub(ticker, tf, from, now, key);
                    if (candles.length) {
                        MarketData.setOHLCVBuffer(ticker, tf, candles.slice(-bars));
                    }
                } catch (e) { /* best effort */ }
            }
        });

        await Promise.all(workers);
        return true;
    }

    async function fetchCandlesFinnhub(symbol, tf, from, to, key) {
        const resolution = String(tf);
        const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&from=${from}&to=${to}&token=${window.__FINNHUB_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data || data.s !== 'ok' || !Array.isArray(data.t)) return [];
        const candles = [];
        for (let i = 0; i < data.t.length; i++) {
            candles.push({
                time: data.t[i],
                open: data.o[i],
                high: data.h[i],
                low: data.l[i],
                close: data.c[i],
                volume: data.v[i]
            });
        }
        return candles;
    }

    function startQuotePolling() {
        stopQuotePolling();
        const key = _getKey();
        if (!key) return;
        quotePollTimer = setInterval(async () => {
            // Poll bid/ask for current chart ticker only (keeps rate low)
            try {
                const ticker = (typeof ChartEngine !== 'undefined' && ChartEngine.getCurrentTicker)
                    ? ChartEngine.getCurrentTicker()
                    : 'SPY';
                const q = await fetchBidAskFinnhub(ticker, key);
                if (q && typeof q.b === 'number' && typeof q.a === 'number') {
                    const now = Math.floor(Date.now() / 1000);
                    MarketData.updatePrice(ticker, MarketData.getPrice(ticker), null, q.b, q.a, now);
                    // REST quotes are ~15min delayed on free tier
                    try { MarketData.setDataSource(ticker, 'delayed'); } catch (e) { }
                }
            } catch (e) { }
        }, QUOTE_POLL_MS);
    }

    function stopQuotePolling() {
        if (quotePollTimer) clearInterval(quotePollTimer);
        quotePollTimer = null;
    }

    async function fetchBidAskFinnhub(symbol, key) {
        // Finnhub: /stock/bidask?symbol=AAPL&token=...
        const url = `https://finnhub.io/api/v1/stock/bidask?symbol=${encodeURIComponent(symbol)}&token=${window.__FINNHUB_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        // Typical response: { a: ask, b: bid, ... }
        return data || null;
    }

    function getStatus() {
        return { connected, subscribed: [...subscribed], lastError };
    }

    function shutdown() {
        stopQuotePolling();
        disconnectWS();
        subscribed = new Set();
    }

    return {
        init,
        setApiKey,
        subscribe,
        subscribeAll,
        bootstrapHistorical,
        getStatus,
        shutdown,
        isConnected: () => connected
    };
})();

