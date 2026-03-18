/* ══════════════════════════════════════════════════════════════════
   BACKTEST-ENGINE.JS — Full-Featured Strategy Backtester
   ──────────────────────────────────────────────────────────────────
   Features:
   • Algorithm selector (any ForecastAgent or AgentFramework consensus)
   • 1-5 trading-day window picker
   • No-lookahead replay: only candles[0..i] visible to strategy at step i
   • Trade simulation: long/flat model with signal-based entry/exit
   • Metrics: total return, win rate, max drawdown, trade count,
     avg P/L per trade, Sharpe proxy, vs buy-and-hold
   • Structured report with equity curve & trade log
   ══════════════════════════════════════════════════════════════════ */

const BacktestEngine = (() => {
    'use strict';

    // ── State ───────────────────────────────────────────────────────
    let _active = false;
    let _config = {};
    let _rawData = {};        // { ticker: candles[] }
    let _equityCurve = [];    // [{ time, equity, drawdown }]
    let _tradeLog = [];       // [{ entry, exit, side, pnl, pnlPct, bars }]
    let _metrics = {};        // computed summary
    let _buyHold = {};        // buy-and-hold comparison
    let _onProgress = null;

    // ── Available algorithms (matched to ForecastAgents.AGENTS + consensus) ──
    const ALGORITHMS = [
        { id: 'lstm_predictor', name: 'LSTM Predictor',   type: 'forecast' },
        { id: 'transformer',    name: 'Transformer',      type: 'forecast' },
        { id: 'momentum_model', name: 'Momentum',         type: 'forecast' },
        { id: 'volatility',     name: 'Volatility',       type: 'forecast' },
        { id: 'sentiment',      name: 'Sentiment',        type: 'forecast' },
        { id: 'ensemble',       name: 'Ensemble',         type: 'forecast' },
        { id: 'consensus',      name: 'Multi-Agent Consensus', type: 'consensus' },
    ];

    function getAlgorithms() { return ALGORITHMS; }
    function isActive() { return _active; }

    // ── Utilities ───────────────────────────────────────────────────
    function _getKey() {
        return (typeof window !== 'undefined' && window.__FINNHUB_API_KEY)
            || (typeof localStorage !== 'undefined' && localStorage.getItem('FINNHUB_API_KEY'))
            || null;
    }

    function _tradingDaysAgo(days) {
        // Walk backwards from today skipping weekends
        const result = new Date();
        let remaining = Math.max(1, Math.min(5, days));
        while (remaining > 0) {
            result.setDate(result.getDate() - 1);
            const dow = result.getDay();
            if (dow !== 0 && dow !== 6) remaining--;
        }
        result.setHours(0, 0, 0, 0);
        return result;
    }

    // ── Initialize: fetch historical data ───────────────────────────
    async function init(config = {}) {
        _active = true;
        _config = {
            algorithm: config.algorithm || 'ensemble',
            days: Math.max(1, Math.min(5, config.days || 3)),
            ticker: config.ticker || 'SPY',
            resolution: config.resolution || 5,
            apiKey: config.apiKey || _getKey(),
        };
        _onProgress = typeof config.onProgress === 'function' ? config.onProgress : null;
        _rawData = {};
        _equityCurve = [];
        _tradeLog = [];
        _metrics = {};
        _buyHold = {};

        if (!_config.apiKey) return false;

        const endDate = new Date();
        const startDate = _tradingDaysAgo(_config.days);
        const from = Math.floor(startDate.getTime() / 1000);
        const to = Math.floor(endDate.getTime() / 1000);

        _config._from = from;
        _config._to = to;
        _config._startDate = startDate;
        _config._endDate = endDate;

        // Fetch candles for the target ticker + SPY (for correlation context)
        const tickersToFetch = new Set([_config.ticker, 'SPY']);
        // Also fetch a few portfolio tickers for agent context
        const portfolio = typeof MarketData !== 'undefined' ? MarketData.PORTFOLIO : [];
        portfolio.slice(0, 10).forEach(t => tickersToFetch.add(t));
        const tickerList = [...tickersToFetch];

        let done = 0;
        const maxConc = 4;
        let idx = 0;

        const workers = Array.from({ length: maxConc }, async () => {
            while (idx < tickerList.length) {
                const t = tickerList[idx++];
                try {
                    const candles = await _fetchCandles(t, _config.resolution, from, to, _config.apiKey);
                    _rawData[t] = candles;
                } catch (e) {
                    _rawData[t] = [];
                } finally {
                    done++;
                    if (_onProgress) _onProgress({ phase: 'load', done, total: tickerList.length });
                }
            }
        });

        await Promise.all(workers);

        // Need data for the target ticker
        if (!_rawData[_config.ticker] || _rawData[_config.ticker].length < 10) return false;
        return true;
    }

    // ── Run the backtest replay ─────────────────────────────────────
    async function run() {
        if (!_active) return null;

        const candles = _rawData[_config.ticker] || [];
        if (candles.length < 20) return null;

        // Put MarketData into backtest mode
        try { MarketData.setMode('backtest'); } catch (e) { }
        try { await MarketData.init({ mode: 'backtest' }); } catch (e) { }

        // ── Strategy state ──
        const INITIAL_CAPITAL = 100000;
        let capital = INITIAL_CAPITAL;
        let position = 0;        // shares held (0 = flat)
        let entryPrice = 0;
        let entryTime = 0;
        let entryIdx = 0;
        const equity = [];
        const trades = [];
        let peak = INITIAL_CAPITAL;
        let maxDrawdown = 0;

        // Buy-and-hold baseline
        const firstPrice = candles[0].close;
        const bhShares = Math.floor(INITIAL_CAPITAL / firstPrice);
        const bhRemainder = INITIAL_CAPITAL - bhShares * firstPrice;

        // Warm-up: need at least 20 candles before generating signals
        const WARMUP = 20;
        const totalSteps = candles.length;

        for (let i = 0; i < totalSteps; i++) {
            const currentCandle = candles[i];
            const visibleCandles = candles.slice(0, i + 1); // NO LOOKAHEAD

            // Inject point-in-time data into MarketData
            _injectData(_config.ticker, visibleCandles, _config.resolution);

            // Also inject SPY context if available
            if (_config.ticker !== 'SPY' && _rawData['SPY']) {
                const spySlice = _rawData['SPY'].slice(0, Math.min(i + 1, _rawData['SPY'].length));
                _injectData('SPY', spySlice, _config.resolution);
            }

            // Current portfolio value
            const currentPrice = currentCandle.close;
            const portfolioValue = capital + position * currentPrice;

            // Track equity curve
            equity.push({
                time: currentCandle.time,
                equity: portfolioValue,
                price: currentPrice,
                buyHoldEquity: bhRemainder + bhShares * currentPrice,
            });

            // Track drawdown
            if (portfolioValue > peak) peak = portfolioValue;
            const dd = (peak - portfolioValue) / peak;
            if (dd > maxDrawdown) maxDrawdown = dd;

            // Skip signal generation during warmup
            if (i < WARMUP) {
                if (_onProgress) _onProgress({ phase: 'replay', done: i + 1, total: totalSteps });
                continue;
            }

            // ── Generate signal using the selected algorithm ──
            const signal = _generateSignal(_config.algorithm, _config.ticker, visibleCandles, _config.resolution);

            // ── Trading logic: simple long/flat model ──
            if (signal === 'BULLISH' && position === 0) {
                // Open long position
                const shares = Math.floor(capital / currentPrice);
                if (shares > 0) {
                    position = shares;
                    entryPrice = currentPrice;
                    entryTime = currentCandle.time;
                    entryIdx = i;
                    capital -= shares * currentPrice;
                }
            } else if (signal === 'BEARISH' && position > 0) {
                // Close long position
                const exitValue = position * currentPrice;
                const pnl = exitValue - (position * entryPrice);
                const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

                trades.push({
                    entryTime,
                    entryPrice,
                    exitTime: currentCandle.time,
                    exitPrice: currentPrice,
                    side: 'LONG',
                    shares: position,
                    pnl,
                    pnlPct,
                    bars: i - entryIdx,
                });

                capital += exitValue;
                position = 0;
                entryPrice = 0;
            }

            if (_onProgress) _onProgress({ phase: 'replay', done: i + 1, total: totalSteps });

            // Yield to UI every 20 steps
            if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
        }

        // Close any open position at end
        if (position > 0) {
            const lastCandle = candles[candles.length - 1];
            const exitValue = position * lastCandle.close;
            const pnl = exitValue - (position * entryPrice);
            const pnlPct = ((lastCandle.close - entryPrice) / entryPrice) * 100;

            trades.push({
                entryTime,
                entryPrice,
                exitTime: lastCandle.time,
                exitPrice: lastCandle.close,
                side: 'LONG',
                shares: position,
                pnl,
                pnlPct,
                bars: candles.length - 1 - entryIdx,
                closedAtEnd: true,
            });

            capital += exitValue;
            position = 0;
        }

        // ── Compute metrics ──
        const finalEquity = capital;
        const totalReturn = ((finalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
        const lastPrice = candles[candles.length - 1].close;
        const bhFinalEquity = bhRemainder + bhShares * lastPrice;
        const bhReturn = ((bhFinalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
        const avgPnl = trades.length > 0 ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;
        const avgPnlPct = trades.length > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;

        // Sharpe proxy (annualized from per-bar returns)
        const barReturns = [];
        for (let i = 1; i < equity.length; i++) {
            barReturns.push((equity[i].equity - equity[i - 1].equity) / equity[i - 1].equity);
        }
        const meanReturn = barReturns.length > 0 ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length : 0;
        const stdReturn = barReturns.length > 1
            ? Math.sqrt(barReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (barReturns.length - 1))
            : 0;
        const annFactor = Math.sqrt((252 * 78) / Math.max(1, _config.resolution / 5)); // bars per year
        const sharpe = stdReturn > 0 ? (meanReturn / stdReturn) * annFactor : 0;

        _equityCurve = equity;
        _tradeLog = trades;
        _buyHold = { finalEquity: bhFinalEquity, totalReturn: bhReturn, shares: bhShares };

        const algoInfo = ALGORITHMS.find(a => a.id === _config.algorithm) || { name: _config.algorithm };

        _metrics = {
            algorithm: algoInfo.name,
            algorithmId: _config.algorithm,
            ticker: _config.ticker,
            period: `${_config._startDate.toISOString().slice(0, 10)} → ${_config._endDate.toISOString().slice(0, 10)}`,
            days: _config.days,
            totalBars: candles.length,
            initialCapital: INITIAL_CAPITAL,
            finalEquity: finalEquity,
            totalReturn: totalReturn,
            totalReturnDollar: finalEquity - INITIAL_CAPITAL,
            numTrades: trades.length,
            winRate: winRate,
            wins: wins.length,
            losses: losses.length,
            avgPnlPerTrade: avgPnl,
            avgPnlPctPerTrade: avgPnlPct,
            maxDrawdown: maxDrawdown * 100,
            sharpeProxy: sharpe,
            buyHold: {
                finalEquity: bhFinalEquity,
                totalReturn: bhReturn,
                totalReturnDollar: bhFinalEquity - INITIAL_CAPITAL,
            },
            excess: totalReturn - bhReturn,
        };

        // Restore MarketData mode
        try { MarketData.setMode('sim'); } catch (e) { }
        try { await MarketData.init({ mode: 'sim' }); } catch (e) { }

        return _metrics;
    }

    // ── Signal Generation (point-in-time) ───────────────────────────
    function _generateSignal(algorithmId, ticker, visibleCandles, tf) {
        try {
            if (algorithmId === 'consensus') {
                // Use AgentFramework consensus
                const result = AgentFramework.runCycle();
                const tickerResult = result.find(r => r.ticker === ticker);
                if (!tickerResult) return 'NEUTRAL';
                if (tickerResult.consensus.includes('BUY')) return 'BULLISH';
                if (tickerResult.consensus.includes('SELL')) return 'BEARISH';
                return 'NEUTRAL';
            }

            // Use ForecastAgents
            const adr = typeof Indicators !== 'undefined'
                ? Indicators.adr(visibleCandles, 20)
                : { value: 0, percentage: 0, period: 20 };

            ForecastAgents.generateForecasts(ticker, tf, { adr });
            const forecasts = ForecastAgents.getForecasts(ticker);

            const f = forecasts[algorithmId];
            if (!f) return 'NEUTRAL';

            return f.direction || 'NEUTRAL';
        } catch (e) {
            return 'NEUTRAL';
        }
    }

    // ── Inject point-in-time data into MarketData ───────────────────
    function _injectData(ticker, candles, tf) {
        try {
            MarketData.setOHLCVBuffer(ticker, tf, candles.slice(-500));
            const last = candles[candles.length - 1];
            if (last) {
                MarketData.updatePrice(ticker, last.close, last.volume, null, null, last.time);
            }
        } catch (e) { }
    }

    // ── Fetch candles from Finnhub ──────────────────────────────────
    async function _fetchCandles(symbol, tf, from, to, key) {
        const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(String(tf))}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data || data.s !== 'ok' || !Array.isArray(data.t)) return [];
        const out = [];
        for (let i = 0; i < data.t.length; i++) {
            out.push({
                time: data.t[i],
                open: data.o[i],
                high: data.h[i],
                low: data.l[i],
                close: data.c[i],
                volume: data.v[i],
            });
        }
        return out;
    }

    // ── Getters ─────────────────────────────────────────────────────
    function getMetrics() { return _metrics; }
    function getEquityCurve() { return _equityCurve; }
    function getTradeLog() { return _tradeLog; }
    function getBuyHold() { return _buyHold; }

    function reset() {
        _active = false;
        _config = {};
        _rawData = {};
        _equityCurve = [];
        _tradeLog = [];
        _metrics = {};
        _buyHold = {};
        _onProgress = null;
    }

    function exportJSON() {
        return JSON.stringify({
            metrics: _metrics,
            equityCurve: _equityCurve,
            tradeLog: _tradeLog,
            buyHold: _buyHold,
            assumptions: [
                'No transaction costs or slippage assumed.',
                'Simple long/flat model: goes long on BULLISH signal, closes on BEARISH.',
                'No fractional shares; integer share purchases only.',
                'Data source: Finnhub REST candles (may be delayed on free tier).',
                'Warmup period of 20 candles before first signal generated.',
                'Strategy sees only past data at each step (no lookahead bias).',
            ],
        }, null, 2);
    }

    return {
        ALGORITHMS,
        getAlgorithms,
        isActive,
        init,
        run,
        getMetrics,
        getEquityCurve,
        getTradeLog,
        getBuyHold,
        reset,
        exportJSON,
    };
})();
