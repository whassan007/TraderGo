/* ══════════════════════════════════════════════════════════════════
   MARKET-DATA.JS — Portfolio Universe, GBM Price Engine & OHLCV
   ══════════════════════════════════════════════════════════════════ */

const MarketData = (() => {

    // ── Portfolio Universe ───────────────────────────────────────────
    const PORTFOLIO = [
        'UAN', 'SLV', 'RTX', 'COST', 'IAU', 'LLY', 'FANG', 'WMT', 'RNMBF', 'PFE',
        'THLEF', 'GLDM', 'DBMF', 'CWEN.A', 'TAIL', 'SH', 'ACGL', 'PSQ', 'KOS', 'LYFT',
        'DOG', 'KLAR', 'XLP', 'KO', 'SGOV', 'BCRX', 'ABCB', 'RBLX', 'XLU', 'TLT',
        'SPY', 'XLV', 'V', 'MSFT', 'USMV', 'RSP', 'NUE', 'RIG', 'LULU', 'UPS',
        'MA', 'BRK.B', 'NBIS', 'UNH', 'NU', 'AMZN', 'DHR', 'GOOG', 'NVDA', 'ASML'
    ];

    const NO_OPTIONS = new Set(['RNMBF', 'THLEF', 'KLAR']);

    const SECTORS = {
        'Tech': ['MSFT', 'GOOG', 'NVDA', 'AMZN', 'ASML', 'RBLX', 'NBIS'],
        'Financial': ['V', 'MA', 'BRK.B', 'NU', 'ACGL', 'ABCB'],
        'Healthcare': ['LLY', 'PFE', 'UNH', 'DHR', 'BCRX', 'XLV'],
        'Consumer': ['COST', 'WMT', 'LULU', 'KO', 'XLP', 'LYFT', 'UPS'],
        'Energy': ['FANG', 'KOS', 'RIG', 'UAN'],
        'Defense': ['RTX'],
        'Metals': ['SLV', 'IAU', 'GLDM', 'NUE'],
        'Bonds/Hedge': ['TLT', 'SGOV', 'TAIL', 'SH', 'PSQ', 'DOG', 'DBMF', 'USMV', 'RSP'],
        'Utilities': ['XLU', 'CWEN.A'],
        'Index': ['SPY']
    };

    const BASE_PRICES = {
        UAN: 72, SLV: 28, RTX: 122, COST: 915, IAU: 52, LLY: 820,
        FANG: 165, WMT: 185, RNMBF: 0.45, PFE: 26, THLEF: 3.20,
        GLDM: 48, DBMF: 26, 'CWEN.A': 28, TAIL: 8, SH: 13, ACGL: 105,
        PSQ: 11, KOS: 4.5, LYFT: 15, DOG: 30, KLAR: 12, XLP: 82,
        KO: 62, SGOV: 100, BCRX: 8, ABCB: 52, RBLX: 55, XLU: 78,
        TLT: 88, SPY: 575, XLV: 148, V: 310, MSFT: 430, USMV: 90,
        RSP: 170, NUE: 145, RIG: 4.8, LULU: 380, UPS: 130, MA: 510,
        'BRK.B': 440, NBIS: 42, UNH: 510, NU: 13, AMZN: 210,
        DHR: 245, GOOG: 175, NVDA: 135, ASML: 710
    };

    const VOLATILITY = {
        UAN: 0.45, SLV: 0.30, RTX: 0.20, COST: 0.18, IAU: 0.15, LLY: 0.30,
        FANG: 0.38, WMT: 0.16, RNMBF: 0.70, PFE: 0.28, THLEF: 0.60,
        GLDM: 0.14, DBMF: 0.12, 'CWEN.A': 0.25, TAIL: 0.20, SH: 0.18,
        ACGL: 0.22, PSQ: 0.18, KOS: 0.55, LYFT: 0.50, DOG: 0.18,
        KLAR: 0.55, XLP: 0.12, KO: 0.14, SGOV: 0.02, BCRX: 0.65,
        ABCB: 0.28, RBLX: 0.55, XLU: 0.14, TLT: 0.18, SPY: 0.15,
        XLV: 0.14, V: 0.20, MSFT: 0.22, USMV: 0.12, RSP: 0.16,
        NUE: 0.35, RIG: 0.55, LULU: 0.32, UPS: 0.22, MA: 0.20,
        'BRK.B': 0.16, NBIS: 0.50, UNH: 0.20, NU: 0.48, AMZN: 0.28,
        DHR: 0.22, GOOG: 0.25, NVDA: 0.45, ASML: 0.32
    };

    // ── State ───────────────────────────────────────────────────────
    let prices = {};
    let previousPrices = {};
    let priceHistory = {};         // raw tick history
    let volumes = {};
    let bidAskSpreads = {};
    let ohlcvBuffers = {};         // { ticker: { '1': [], '5': [], '15': [], '60': [] } }
    let currentCandles = {};       // live building candle per timeframe
    let tickTimestamps = {};       // per-ticker last tick unix time
    let vwapData = {};             // { ticker: { cumVolPrice, cumVol, value } }
    let initialized = false;
    let mode = 'sim'; // 'sim' | 'live' | 'backtest'
    let lastLiveUpdateAt = {}; // { ticker: unixSec }

    // ── Data Source Tracking ────────────────────────────────────────
    // source: 'live' | 'delayed' | 'cached' | 'model-generated'
    const STALE_LIVE_SEC = 30;     // after 30s without WS update → 'cached'
    const STALE_CACHED_SEC = 120;  // after 2min cached → 'model-generated'
    let dataSources = {};          // { ticker: { source, updatedAt } }

    const HISTORY_LENGTH = 500;    // 500 ticks deep
    const OHLCV_MAX = 500;        // max candles per timeframe
    const TIMEFRAMES = [1, 5, 15, 60];   // minutes
    const EXTRA_TIMEFRAMES = ['D']; // supported for historical fetch (not charted yet)

    // ── Initialize ──────────────────────────────────────────────────
    async function init(opts = {}) {
        mode = opts.mode || mode || 'sim';
        const now = Math.floor(Date.now() / 1000);

        PORTFOLIO.forEach(ticker => {
            const base = BASE_PRICES[ticker] || 100;
            prices[ticker] = base * (1 + (Math.random() - 0.5) * 0.005);
            previousPrices[ticker] = prices[ticker];
            priceHistory[ticker] = [];
            volumes[ticker] = _generateVolume(ticker);
            bidAskSpreads[ticker] = _generateSpread(ticker);
            tickTimestamps[ticker] = now;
            vwapData[ticker] = { cumVolPrice: 0, cumVol: 0, value: prices[ticker] };
            lastLiveUpdateAt[ticker] = 0;
            dataSources[ticker] = { source: mode === 'sim' ? 'model-generated' : 'cached', updatedAt: now };

            // Init OHLCV buffers
            ohlcvBuffers[ticker] = {};
            currentCandles[ticker] = {};
            TIMEFRAMES.forEach(tf => {
                ohlcvBuffers[ticker][tf] = [];
                currentCandles[ticker][tf] = null;
            });

            if (mode === 'sim') {
                // Pre-generate historical candles for chart (synthetic)
                _generateHistoricalCandles(ticker, now);
            }
        });

        initialized = true;

        // In live mode, defer to the connector for historical bootstrap.
        // This keeps MarketData pure and testable.
        if (mode === 'live') return true;
        return true;
    }

    // ── Generate synthetic historical OHLCV ─────────────────────────
    function _generateHistoricalCandles(ticker, nowUnix) {
        const base = BASE_PRICES[ticker] || 100;
        const sigma = VOLATILITY[ticker] || 0.25;
        let p = base * (0.97 + Math.random() * 0.06);  // start ±3% from base

        TIMEFRAMES.forEach(tf => {
            const count = tf === 1 ? 300 : tf === 5 ? 200 : tf === 15 ? 100 : 50;
            const intervalSec = tf * 60;
            const OFFSET = 1800; // 30-min align for 1H/4H
            const binnedNow = Math.floor((nowUnix - OFFSET) / intervalSec) * intervalSec + OFFSET;
            const startTime = binnedNow - count * intervalSec;
            const candles = [];

            for (let i = 0; i < count; i++) {
                const time = startTime + i * intervalSec;
                const sigma_interval = sigma / Math.sqrt(252 * (390 / tf));
                const open = p;
                // Simulate intra-candle
                let high = open, low = open;
                const steps = Math.max(4, tf);
                for (let s = 0; s < steps; s++) {
                    p *= (1 + sigma_interval * _normalRandom() / Math.sqrt(steps));
                    if (p < 0.01) p = 0.01;
                    high = Math.max(high, p);
                    low = Math.min(low, p);
                }
                const close = p;
                const vol = Math.round((_generateVolume(ticker) / 78) * (tf / 5));

                candles.push({ time, open, high, low, close, volume: vol });
            }

            ohlcvBuffers[ticker][tf] = candles;
        });

        // Set price from latest candle
        const latest5 = ohlcvBuffers[ticker][5];
        if (latest5.length > 0) {
            prices[ticker] = latest5[latest5.length - 1].close;
            previousPrices[ticker] = prices[ticker];
        }
        priceHistory[ticker] = [prices[ticker]];
    }

    // ── Simulate Next Tick (called every ~1s from dashboard) ────────
    function microTick() {
        if (!initialized) init();
        if (mode !== 'sim') return;
        const now = Math.floor(Date.now() / 1000);
        const spyDrift = _gbmMicroReturn('SPY');

        PORTFOLIO.forEach(ticker => {
            previousPrices[ticker] = prices[ticker];
            const ownReturn = _gbmMicroReturn(ticker);
            const correlation = _getCorrelation(ticker);
            const blendedReturn = correlation * spyDrift + (1 - correlation) * ownReturn;
            prices[ticker] = prices[ticker] * (1 + blendedReturn);
            if (prices[ticker] < 0.01) prices[ticker] = 0.01;

            // Update tick history
            priceHistory[ticker].push(prices[ticker]);
            if (priceHistory[ticker].length > HISTORY_LENGTH) priceHistory[ticker].shift();

            // Update OHLCV candles
            const vol = Math.round(_generateVolume(ticker) / 390);  // per-minute vol slice
            _updateCandles(ticker, now, prices[ticker], vol);

            // VWAP
            vwapData[ticker].cumVolPrice += prices[ticker] * vol;
            vwapData[ticker].cumVol += vol;
            vwapData[ticker].value = vwapData[ticker].cumVol > 0
                ? vwapData[ticker].cumVolPrice / vwapData[ticker].cumVol
                : prices[ticker];

            tickTimestamps[ticker] = now;
        });
    }

    // ── Full 5-min tick (keeps backward compat with agents) ─────────
    function tick() {
        if (!initialized) init();
        if (mode !== 'sim') return;
        const spyDrift = _gbmReturn('SPY');
        PORTFOLIO.forEach(ticker => {
            previousPrices[ticker] = prices[ticker];
            const ownReturn = _gbmReturn(ticker);
            const correlation = _getCorrelation(ticker);
            const blendedReturn = correlation * spyDrift + (1 - correlation) * ownReturn;
            prices[ticker] = prices[ticker] * (1 + blendedReturn);
            if (prices[ticker] < 0.01) prices[ticker] = 0.01;
            priceHistory[ticker].push(prices[ticker]);
            if (priceHistory[ticker].length > HISTORY_LENGTH) priceHistory[ticker].shift();
            volumes[ticker] = _generateVolume(ticker);
            bidAskSpreads[ticker] = _generateSpread(ticker);
        });
    }

    // ── Live/External Ingestion ─────────────────────────────────────
    function updatePrice(ticker, price, volume = null, bid = null, ask = null, timeUnix = null) {
        if (!initialized) init();
        if (!ticker) return;
        const now = timeUnix || Math.floor(Date.now() / 1000);

        if (typeof price === 'number' && Number.isFinite(price)) {
            previousPrices[ticker] = prices[ticker] ?? price;
            prices[ticker] = price;
            tickTimestamps[ticker] = now;
            lastLiveUpdateAt[ticker] = now;

            // Update history
            if (!priceHistory[ticker]) priceHistory[ticker] = [];
            priceHistory[ticker].push(price);
            if (priceHistory[ticker].length > HISTORY_LENGTH) priceHistory[ticker].shift();
        }

        if (typeof volume === 'number' && Number.isFinite(volume)) {
            volumes[ticker] = volume;
        }

        if (typeof bid === 'number' && typeof ask === 'number' && Number.isFinite(bid) && Number.isFinite(ask)) {
            bidAskSpreads[ticker] = Math.max(0, ask - bid);
        }

        // Update OHLCV candles (use volume as per-tick increment if provided; otherwise small proxy)
        const volInc = (typeof volume === 'number' && Number.isFinite(volume) && volume >= 0)
            ? Math.max(0, Math.round(volume / 390))
            : 0;
        _updateCandles(ticker, now, prices[ticker], volInc);

        // VWAP accumulator (best-effort)
        const v = volInc || 1;
        if (!vwapData[ticker]) vwapData[ticker] = { cumVolPrice: 0, cumVol: 0, value: prices[ticker] };
        vwapData[ticker].cumVolPrice += prices[ticker] * v;
        vwapData[ticker].cumVol += v;
        vwapData[ticker].value = vwapData[ticker].cumVol > 0
            ? vwapData[ticker].cumVolPrice / vwapData[ticker].cumVol
            : prices[ticker];
    }

    function setOHLCVBuffer(ticker, timeframe, candles) {
        if (!ticker || !timeframe) return;
        if (!ohlcvBuffers[ticker]) ohlcvBuffers[ticker] = {};
        ohlcvBuffers[ticker][timeframe] = Array.isArray(candles) ? candles.slice(-OHLCV_MAX) : [];

        // Seed current candle with the last candle (so live updates extend naturally)
        const last = ohlcvBuffers[ticker][timeframe].length
            ? ohlcvBuffers[ticker][timeframe][ohlcvBuffers[ticker][timeframe].length - 1]
            : null;
        if (!currentCandles[ticker]) currentCandles[ticker] = {};
        currentCandles[ticker][timeframe] = last ? { ...last } : null;

        // Seed price from latest 5m candle if available
        if (timeframe === 5 && last && typeof last.close === 'number') {
            previousPrices[ticker] = prices[ticker] ?? last.close;
            prices[ticker] = last.close;
            if (!priceHistory[ticker]) priceHistory[ticker] = [];
            if (priceHistory[ticker].length === 0) priceHistory[ticker] = [last.close];
        }
    }

    function setMode(nextMode) {
        mode = nextMode || mode;
    }

    function getMode() { return mode; }
    function getLastLiveUpdateAt(ticker) { return lastLiveUpdateAt[ticker] || 0; }

    // ── Update OHLCV candles with a new price tick ──────────────────
    function _updateCandles(ticker, time, price, vol) {
        TIMEFRAMES.forEach(tf => {
            const intervalSec = tf * 60;
            // Apply 30-minute offset to anchor 1H/4H candles to 9:30 instead of top of the hour
            const OFFSET = 1800; 
            const candleTime = Math.floor((time - OFFSET) / intervalSec) * intervalSec + OFFSET;
            let candle = currentCandles[ticker][tf];

            if (!candle || candle.time !== candleTime) {
                // Finalize previous candle
                if (candle) {
                    ohlcvBuffers[ticker][tf].push({ ...candle });
                    if (ohlcvBuffers[ticker][tf].length > OHLCV_MAX) {
                        ohlcvBuffers[ticker][tf].shift();
                    }
                }
                // Start new candle
                currentCandles[ticker][tf] = {
                    time: candleTime,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: vol
                };
            } else {
                candle.high = Math.max(candle.high, price);
                candle.low = Math.min(candle.low, price);
                candle.close = price;
                candle.volume += vol;
            }
        });

        // Also update volumes/spreads
        volumes[ticker] = _generateVolume(ticker);
        bidAskSpreads[ticker] = _generateSpread(ticker);
    }

    // ── Get OHLCV candles for chart ─────────────────────────────────
    function getOHLCV(ticker, timeframe = 5) {
        const buf = ohlcvBuffers[ticker]?.[timeframe] || [];
        const live = currentCandles[ticker]?.[timeframe];
        if (live) return [...buf, { ...live }];
        return [...buf];
    }

    // ── Get just the latest candle (for chart real-time update) ─────
    function getLiveCandle(ticker, timeframe = 5) {
        return currentCandles[ticker]?.[timeframe] || null;
    }

    // ── GBM Returns ─────────────────────────────────────────────────
    function _gbmReturn(ticker) {
        const sigma = VOLATILITY[ticker] || 0.25;
        const sigma5m = sigma / Math.sqrt(252 * 78);
        const drift = -0.5 * sigma5m * sigma5m;
        return drift + sigma5m * _normalRandom();
    }

    function _gbmMicroReturn(ticker) {
        const sigma = VOLATILITY[ticker] || 0.25;
        // ~1 second interval: σ_1s = σ_annual / sqrt(252 * 6.5 * 3600)
        const sigma1s = sigma / Math.sqrt(252 * 6.5 * 3600);
        const drift = -0.5 * sigma1s * sigma1s;
        return drift + sigma1s * _normalRandom();
    }

    // ── Correlation ─────────────────────────────────────────────────
    function _getCorrelation(ticker) {
        if (ticker === 'SPY') return 1.0;
        const sectorMap = {
            'Tech': 0.80, 'Financial': 0.70, 'Healthcare': 0.55,
            'Consumer': 0.65, 'Energy': 0.45, 'Defense': 0.50,
            'Metals': 0.25, 'Bonds/Hedge': -0.30, 'Utilities': 0.35,
            'Index': 1.0
        };
        for (const [sector, tickers] of Object.entries(SECTORS)) {
            if (tickers.includes(ticker)) return sectorMap[sector] || 0.5;
        }
        return 0.5;
    }

    function _generateVolume(ticker) {
        const baseVol = ticker === 'SPY' ? 85_000_000 :
            ['NVDA', 'AMZN', 'MSFT', 'GOOG'].includes(ticker) ? 30_000_000 :
                NO_OPTIONS.has(ticker) ? 50_000 : 2_000_000;
        return Math.round(baseVol * (0.7 + Math.random() * 0.6));
    }

    function _generateSpread(ticker) {
        const price = prices[ticker] || 100;
        const bps = NO_OPTIONS.has(ticker) ? 80 + Math.random() * 120 :
            price > 200 ? 1 + Math.random() * 3 :
                price > 50 ? 2 + Math.random() * 5 :
                    price > 10 ? 3 + Math.random() * 8 :
                        10 + Math.random() * 20;
        return (bps / 10000) * price;
    }

    function getLiquidityScore() {
        const spyVol = volumes['SPY'] || 85_000_000;
        const spread = bidAskSpreads['SPY'] || 0.05;
        const spreadScore = Math.max(0, 10 - spread * 200);
        const volScore = Math.min(10, (spyVol / 85_000_000) * 7);
        return Math.round((spreadScore * 0.4 + volScore * 0.6) * 10) / 10;
    }

    function getSpreadStatus() {
        const spread = bidAskSpreads['SPY'] || 0.05;
        const bps = (spread / (prices['SPY'] || 575)) * 10000;
        if (bps < 1.5) return 'Tight';
        if (bps < 4) return 'Normal';
        return 'Wide';
    }

    function getVolumeRunRate() {
        const spyVol = volumes['SPY'] || 85_000_000;
        const pct = ((spyVol - 85_000_000) / 85_000_000) * 100;
        return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
    }

    function getEMA(ticker, periods) {
        const hist = priceHistory[ticker] || [];
        if (hist.length === 0) return null;
        const k = 2 / (periods + 1);
        let ema = hist[0];
        for (let i = 1; i < hist.length; i++) ema = hist[i] * k + ema * (1 - k);
        return ema;
    }

    function getRSI(ticker, periods = 14) {
        const hist = priceHistory[ticker] || [];
        if (hist.length < 2) return 50;
        let gains = 0, losses = 0;
        const len = Math.min(periods, hist.length - 1);
        for (let i = hist.length - len; i < hist.length; i++) {
            const change = hist[i] - hist[i - 1];
            if (change > 0) gains += change; else losses -= change;
        }
        if (losses === 0) return 100;
        return 100 - 100 / (1 + gains / losses);
    }

    function getStdDev(ticker, periods = 14) {
        const hist = priceHistory[ticker] || [];
        const len = Math.min(periods, hist.length);
        if (len < 2) return 0;
        const slice = hist.slice(-len);
        const mean = slice.reduce((a, b) => a + b, 0) / len;
        return Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / len);
    }

    function getChangePercent(ticker) {
        const curr = prices[ticker], prev = previousPrices[ticker];
        if (!prev || !curr) return 0;
        return ((curr - prev) / prev) * 100;
    }

    function getMarketStatus() {
        const now = new Date();
        const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const mins = et.getHours() * 60 + et.getMinutes();
        const day = et.getDay();
        if (day === 0 || day === 6) return 'CLOSED';
        if (mins >= 570 && mins < 960) return 'OPEN';
        if (mins >= 540 && mins < 570) return 'PRE-MARKET';
        if (mins >= 960 && mins < 1020) return 'AFTER-HOURS';
        return 'CLOSED';
    }

    function _normalRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    function getVIX() {
        if (!MarketData._vix) MarketData._vix = 18 + Math.random() * 6;
        MarketData._vix += (Math.random() - 0.5) * 1.5;
        MarketData._vix = Math.max(11, Math.min(38, MarketData._vix));
        return MarketData._vix;
    }

    function getVolatility(ticker) { return VOLATILITY[ticker] || 0.25; }

    function getVWAP(ticker) { return vwapData[ticker]?.value || prices[ticker]; }

    function getSector(ticker) {
        for (const [sector, tickers] of Object.entries(SECTORS)) {
            if (tickers.includes(ticker)) return sector;
        }
        return 'Other';
    }

    // ── Data Source API ─────────────────────────────────────────────
    function setDataSource(ticker, source) {
        if (!ticker) return;
        dataSources[ticker] = { source, updatedAt: Math.floor(Date.now() / 1000) };
    }

    function getDataSource(ticker) {
        const ds = dataSources[ticker];
        if (!ds) return { source: 'model-generated', lastUpdated: 0, staleSec: Infinity };
        const now = Math.floor(Date.now() / 1000);
        const staleSec = now - (ds.updatedAt || 0);

        // Auto-downgrade based on staleness (only if originally live or delayed)
        let effectiveSource = ds.source;
        if (ds.source === 'live' && staleSec > STALE_LIVE_SEC) {
            effectiveSource = 'cached';
        }
        if ((ds.source === 'live' || ds.source === 'delayed' || ds.source === 'cached') && staleSec > STALE_CACHED_SEC) {
            effectiveSource = 'model-generated';
        }
        return { source: effectiveSource, lastUpdated: ds.updatedAt, staleSec };
    }

    function getAllSourceStats() {
        const stats = { live: 0, delayed: 0, cached: 0, 'model-generated': 0 };
        PORTFOLIO.forEach(t => {
            const ds = getDataSource(t);
            stats[ds.source] = (stats[ds.source] || 0) + 1;
        });
        return stats;
    }

    return {
        PORTFOLIO, NO_OPTIONS, SECTORS, VOLATILITY, BASE_PRICES,
        init, tick, microTick,
        updatePrice, setOHLCVBuffer,
        setMode, getMode, getLastLiveUpdateAt,
        setDataSource, getDataSource, getAllSourceStats,
        getPrice: t => prices[t],
        getPreviousPrice: t => previousPrices[t],
        getVolume: t => volumes[t],
        getSpread: t => bidAskSpreads[t],
        getHistory: t => priceHistory[t] || [],
        getOHLCV, getLiveCandle,
        getChangePercent, getLiquidityScore, getSpreadStatus, getVolumeRunRate,
        getEMA, getRSI, getStdDev, getMarketStatus, getVIX, getVolatility, getVWAP, getSector,
        normalRandom: _normalRandom,
        _vix: null
    };
})();
