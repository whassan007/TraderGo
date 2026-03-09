/* ══════════════════════════════════════════════════════════════════
   CHART-ENGINE.JS — TradingView Lightweight Charts Integration
   ══════════════════════════════════════════════════════════════════ */

const ChartEngine = (() => {

    let chart = null;
    let candleSeries = null;
    let volumeSeries = null;
    let currentTicker = 'SPY';
    let currentTimeframe = 5;

    // Indicator series references
    let indicatorSeries = {};
    let forecastSeries = {};
    let monteCarloSeries = [];

    // Active indicators
    let activeIndicators = new Set();

    // ── Indicator colors ────────────────────────────────────────────
    const INDICATOR_COLORS = {
        sma20: '#eab308',
        sma50: '#f97316',
        ema12: '#06b6d4',
        ema26: '#8b5cf6',
        bb_upper: 'rgba(139,92,246,0.3)',
        bb_lower: 'rgba(139,92,246,0.3)',
        bb_mid: 'rgba(139,92,246,0.6)',
        vwap: '#ec4899'
    };

    // ── Initialize Chart ────────────────────────────────────────────
    function init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        chart = LightweightCharts.createChart(container, {
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: '#94a3b8',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace"
            },
            grid: {
                vertLines: { color: 'rgba(56, 189, 248, 0.04)' },
                horzLines: { color: 'rgba(56, 189, 248, 0.04)' }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { color: 'rgba(56, 189, 248, 0.3)', width: 1, style: 2 },
                horzLine: { color: 'rgba(56, 189, 248, 0.3)', width: 1, style: 2 }
            },
            rightPriceScale: {
                borderColor: 'rgba(56, 189, 248, 0.1)',
                scaleMargins: { top: 0.1, bottom: 0.2 }
            },
            timeScale: {
                borderColor: 'rgba(56, 189, 248, 0.1)',
                timeVisible: true,
                secondsVisible: false,
                rightOffset: 12,
                barSpacing: 8
            },
            handleScroll: { vertTouchDrag: false },
            handleScale: { axisPressedMouseMove: true }
        });

        // Candlestick series
        candleSeries = chart.addCandlestickSeries({
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#22c55e',
            wickDownColor: '#ef4444',
            wickUpColor: '#22c55e'
        });

        // Volume histogram
        volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
            scaleMargins: { top: 0.85, bottom: 0 }
        });

        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 }
        });

        // Responsive
        const ro = new ResizeObserver(() => {
            chart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight
            });
        });
        ro.observe(container);

        // Load initial data
        loadTicker('SPY', 5);
    }

    // ── Load Ticker ─────────────────────────────────────────────────
    function loadTicker(ticker, timeframe) {
        currentTicker = ticker;
        currentTimeframe = timeframe || currentTimeframe;

        const candles = MarketData.getOHLCV(ticker, currentTimeframe);
        if (!candles || candles.length === 0) return;

        // Set candle data
        candleSeries.setData(candles.map(c => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close
        })));

        // Set volume data
        volumeSeries.setData(candles.map(c => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open
                ? 'rgba(34, 197, 94, 0.25)'
                : 'rgba(239, 68, 68, 0.25)'
        })));

        // Refresh indicators
        _refreshIndicators(candles);

        // Refresh forecasts
        _refreshForecasts(ticker);

        chart.timeScale().fitContent();
    }

    // ── Update Live Candle (called from micro-tick loop) ────────────
    function updateLive() {
        const candle = MarketData.getLiveCandle(currentTicker, currentTimeframe);
        if (!candle) return;

        candleSeries.update({
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
        });

        volumeSeries.update({
            time: candle.time,
            value: candle.volume,
            color: candle.close >= candle.open
                ? 'rgba(34, 197, 94, 0.25)'
                : 'rgba(239, 68, 68, 0.25)'
        });
    }

    // ── Indicator Management ────────────────────────────────────────
    function toggleIndicator(name) {
        if (activeIndicators.has(name)) {
            activeIndicators.delete(name);
            _removeIndicator(name);
        } else {
            activeIndicators.add(name);
        }
        const candles = MarketData.getOHLCV(currentTicker, currentTimeframe);
        _refreshIndicators(candles);
    }

    function _removeIndicator(name) {
        if (name === 'macd') {
            ['macd_line', 'macd_signal', 'macd_hist'].forEach(k => {
                if (indicatorSeries[k]) { chart.removeSeries(indicatorSeries[k]); delete indicatorSeries[k]; }
            });
        } else if (name === 'bb') {
            ['bb_upper', 'bb_lower', 'bb_mid'].forEach(k => {
                if (indicatorSeries[k]) { chart.removeSeries(indicatorSeries[k]); delete indicatorSeries[k]; }
            });
        } else {
            if (indicatorSeries[name]) {
                chart.removeSeries(indicatorSeries[name]);
                delete indicatorSeries[name];
            }
        }
    }

    function _refreshIndicators(candles) {
        if (!candles || candles.length < 5) return;

        // Remove inactive
        Object.keys(indicatorSeries).forEach(key => {
            const base = key.replace(/_.*$/, '');
            const indicator = key === 'bb_upper' || key === 'bb_lower' || key === 'bb_mid' ? 'bb'
                : key === 'macd_line' || key === 'macd_signal' || key === 'macd_hist' ? 'macd'
                    : key;
            if (!activeIndicators.has(indicator)) {
                chart.removeSeries(indicatorSeries[key]);
                delete indicatorSeries[key];
            }
        });

        // SMA 20
        if (activeIndicators.has('sma20') && !indicatorSeries.sma20) {
            indicatorSeries.sma20 = chart.addLineSeries({
                color: INDICATOR_COLORS.sma20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('sma20')) {
            indicatorSeries.sma20.setData(Indicators.sma(candles, 20));
        }

        // SMA 50
        if (activeIndicators.has('sma50') && !indicatorSeries.sma50) {
            indicatorSeries.sma50 = chart.addLineSeries({
                color: INDICATOR_COLORS.sma50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('sma50')) {
            indicatorSeries.sma50.setData(Indicators.sma(candles, 50));
        }

        // EMA 12
        if (activeIndicators.has('ema12') && !indicatorSeries.ema12) {
            indicatorSeries.ema12 = chart.addLineSeries({
                color: INDICATOR_COLORS.ema12, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('ema12')) {
            indicatorSeries.ema12.setData(Indicators.ema(candles, 12));
        }

        // EMA 26
        if (activeIndicators.has('ema26') && !indicatorSeries.ema26) {
            indicatorSeries.ema26 = chart.addLineSeries({
                color: INDICATOR_COLORS.ema26, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('ema26')) {
            indicatorSeries.ema26.setData(Indicators.ema(candles, 26));
        }

        // Bollinger Bands
        if (activeIndicators.has('bb')) {
            const bb = Indicators.bollingerBands(candles, 20, 2);
            if (!indicatorSeries.bb_upper) {
                indicatorSeries.bb_upper = chart.addLineSeries({
                    color: INDICATOR_COLORS.bb_upper, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false
                });
                indicatorSeries.bb_lower = chart.addLineSeries({
                    color: INDICATOR_COLORS.bb_lower, lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false
                });
                indicatorSeries.bb_mid = chart.addLineSeries({
                    color: INDICATOR_COLORS.bb_mid, lineWidth: 1, priceLineVisible: false, lastValueVisible: false
                });
            }
            indicatorSeries.bb_upper.setData(bb.upper);
            indicatorSeries.bb_lower.setData(bb.lower);
            indicatorSeries.bb_mid.setData(bb.middle);
        }

        // VWAP
        if (activeIndicators.has('vwap') && !indicatorSeries.vwap) {
            indicatorSeries.vwap = chart.addLineSeries({
                color: INDICATOR_COLORS.vwap, lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false
            });
        }
        if (activeIndicators.has('vwap')) {
            indicatorSeries.vwap.setData(Indicators.vwap(candles));
        }
    }

    // ── Forecast Overlay ────────────────────────────────────────────
    function _refreshForecasts(ticker) {
        // Clear previous forecast series
        Object.values(forecastSeries).forEach(s => {
            if (s.line) chart.removeSeries(s.line);
            if (s.upper) chart.removeSeries(s.upper);
            if (s.lower) chart.removeSeries(s.lower);
        });
        forecastSeries = {};
        monteCarloSeries.forEach(s => chart.removeSeries(s));
        monteCarloSeries = [];

        const allForecasts = ForecastAgents.getForecasts(ticker);
        if (!allForecasts || Object.keys(allForecasts).length === 0) return;

        const price = MarketData.getPrice(ticker);
        const now = Math.floor(Date.now() / 1000);
        const candleNow = Math.floor(now / (currentTimeframe * 60)) * (currentTimeframe * 60);

        // Draw each agent's forecast
        Object.values(allForecasts).forEach(f => {
            if (!f?.projections?.length) return;

            // Projection line (starts from current price)
            const lineData = [{ time: candleNow, value: price }];
            f.projections.forEach(p => {
                const aligned = Math.floor(p.time / (currentTimeframe * 60)) * (currentTimeframe * 60);
                if (aligned > candleNow) {
                    lineData.push({ time: aligned, value: p.value });
                }
            });

            // Deduplicate times
            const seen = new Set();
            const dedupedLine = lineData.filter(d => {
                if (seen.has(d.time)) return false;
                seen.add(d.time);
                return true;
            });

            if (dedupedLine.length < 2) return;

            const line = chart.addLineSeries({
                color: f.color,
                lineWidth: f.agent_id === 'ensemble' ? 3 : 2,
                lineStyle: f.agent_id === 'ensemble' ? 0 : 2,  // solid for ensemble, dashed for others
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: false
            });
            line.setData(dedupedLine);

            // Confidence bands
            const bands = ForecastAgents.getConfidenceBands(ticker, f.agent_id);
            let upper = null, lower = null;

            if (bands.upper.length > 0 && f.agent_id === 'ensemble') {
                const upperData = [{ time: candleNow, value: price }];
                const lowerData = [{ time: candleNow, value: price }];
                bands.upper.forEach(b => {
                    const a = Math.floor(b.time / (currentTimeframe * 60)) * (currentTimeframe * 60);
                    if (a > candleNow) upperData.push({ time: a, value: b.value });
                });
                bands.lower.forEach(b => {
                    const a = Math.floor(b.time / (currentTimeframe * 60)) * (currentTimeframe * 60);
                    if (a > candleNow) lowerData.push({ time: a, value: b.value });
                });

                const seenU = new Set(), seenL = new Set();
                const dedupU = upperData.filter(d => { if (seenU.has(d.time)) return false; seenU.add(d.time); return true; });
                const dedupL = lowerData.filter(d => { if (seenL.has(d.time)) return false; seenL.add(d.time); return true; });

                if (dedupU.length > 1) {
                    upper = chart.addLineSeries({
                        color: 'rgba(6, 182, 212, 0.15)', lineWidth: 1, lineStyle: 2,
                        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
                    });
                    upper.setData(dedupU);
                }
                if (dedupL.length > 1) {
                    lower = chart.addLineSeries({
                        color: 'rgba(6, 182, 212, 0.15)', lineWidth: 1, lineStyle: 2,
                        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
                    });
                    lower.setData(dedupL);
                }
            }

            forecastSeries[f.agent_id] = { line, upper, lower };
        });

        // Monte Carlo paths (thin, transparent)
        const mcPaths = ForecastAgents.getMonteCarlo(ticker);
        const maxMC = Math.min(20, mcPaths.length);  // limit drawn paths
        for (let i = 0; i < maxMC; i++) {
            const pathData = [{ time: candleNow, value: price }];
            const seen2 = new Set();
            seen2.add(candleNow);
            mcPaths[i].forEach(p => {
                const a = Math.floor(p.time / (currentTimeframe * 60)) * (currentTimeframe * 60);
                if (a > candleNow && !seen2.has(a)) {
                    pathData.push({ time: a, value: p.value });
                    seen2.add(a);
                }
            });
            if (pathData.length > 1) {
                const s = chart.addLineSeries({
                    color: 'rgba(148, 163, 184, 0.08)', lineWidth: 1,
                    priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false
                });
                s.setData(pathData);
                monteCarloSeries.push(s);
            }
        }
    }

    // ── Get state ───────────────────────────────────────────────────
    function getCurrentTicker() { return currentTicker; }
    function getCurrentTimeframe() { return currentTimeframe; }
    function getActiveIndicators() { return new Set(activeIndicators); }

    function setTimeframe(tf) {
        currentTimeframe = tf;
        loadTicker(currentTicker, tf);
    }

    // ── Refresh forecasts on chart (called after forecast cycle) ────
    function refreshForecasts() {
        _refreshForecasts(currentTicker);
    }

    return {
        init, loadTicker, updateLive, toggleIndicator, setTimeframe,
        refreshForecasts,
        getCurrentTicker, getCurrentTimeframe, getActiveIndicators
    };
})();
