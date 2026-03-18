/* ══════════════════════════════════════════════════════════════════
   INDICATORS.JS — Technical Analysis Library for Chart Overlays
   ══════════════════════════════════════════════════════════════════ */

const Indicators = (() => {

    // ── SMA (Simple Moving Average) ─────────────────────────────────
    function sma(candles, period) {
        const result = [];
        for (let i = 0; i < candles.length; i++) {
            if (i < period - 1) continue;
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
            result.push({ time: candles[i].time, value: sum / period });
        }
        return result;
    }

    // ── EMA (Exponential Moving Average) ────────────────────────────
    function ema(candles, period) {
        if (candles.length === 0) return [];
        const k = 2 / (period + 1);
        const result = [{ time: candles[0].time, value: candles[0].close }];
        let prev = candles[0].close;
        for (let i = 1; i < candles.length; i++) {
            const val = candles[i].close * k + prev * (1 - k);
            result.push({ time: candles[i].time, value: val });
            prev = val;
        }
        return result;
    }

    // ── RSI (Relative Strength Index) ───────────────────────────────
    function rsi(candles, period = 14) {
        const result = [];
        if (candles.length < period + 1) return result;

        let avgGain = 0, avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const change = candles[i].close - candles[i - 1].close;
            if (change > 0) avgGain += change; else avgLoss -= change;
        }
        avgGain /= period;
        avgLoss /= period;

        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push({ time: candles[period].time, value: 100 - 100 / (1 + rs) });

        for (let i = period + 1; i < candles.length; i++) {
            const change = candles[i].close - candles[i - 1].close;
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? -change : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            result.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
        }
        return result;
    }

    // ── MACD ────────────────────────────────────────────────────────
    function macd(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
        const fastEMA = ema(candles, fastPeriod);
        const slowEMA = ema(candles, slowPeriod);

        const macdLine = [];
        const slowStart = slowPeriod - fastPeriod;
        for (let i = 0; i < slowEMA.length; i++) {
            const fastIdx = i + slowStart;
            if (fastIdx >= 0 && fastIdx < fastEMA.length) {
                macdLine.push({
                    time: slowEMA[i].time,
                    value: fastEMA[fastIdx].value - slowEMA[i].value
                });
            }
        }

        // Signal line (EMA of MACD)
        const signalLine = [];
        if (macdLine.length > 0) {
            const k = 2 / (signalPeriod + 1);
            let prev = macdLine[0].value;
            signalLine.push({ time: macdLine[0].time, value: prev });
            for (let i = 1; i < macdLine.length; i++) {
                const val = macdLine[i].value * k + prev * (1 - k);
                signalLine.push({ time: macdLine[i].time, value: val });
                prev = val;
            }
        }

        // Histogram
        const histogram = [];
        for (let i = 0; i < Math.min(macdLine.length, signalLine.length); i++) {
            histogram.push({
                time: macdLine[i].time,
                value: macdLine[i].value - signalLine[i].value,
                color: (macdLine[i].value - signalLine[i].value) >= 0
                    ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'
            });
        }

        return { macdLine, signalLine, histogram };
    }

    // ── Bollinger Bands ─────────────────────────────────────────────
    function bollingerBands(candles, period = 20, stdDevMult = 2) {
        const upper = [], lower = [], middle = [];
        for (let i = period - 1; i < candles.length; i++) {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
            const mean = sum / period;

            let sqSum = 0;
            for (let j = i - period + 1; j <= i; j++) sqSum += (candles[j].close - mean) ** 2;
            const sd = Math.sqrt(sqSum / period);

            const t = candles[i].time;
            middle.push({ time: t, value: mean });
            upper.push({ time: t, value: mean + stdDevMult * sd });
            lower.push({ time: t, value: mean - stdDevMult * sd });
        }
        return { upper, middle, lower };
    }

    // ── VWAP (from candle data) ─────────────────────────────────────
    function vwap(candles) {
        const result = [];
        let cumVolPrice = 0, cumVol = 0;
        for (let i = 0; i < candles.length; i++) {
            const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
            cumVolPrice += tp * candles[i].volume;
            cumVol += candles[i].volume;
            result.push({
                time: candles[i].time,
                value: cumVol > 0 ? cumVolPrice / cumVol : tp
            });
        }
        return result;
    }

    // ── ADR (Average Daily Range) ───────────────────────────────────
    // ADR = average(high - low) over last N candles (timeframe-specific)
    // ADR% = (ADR / close) * 100  (close = last candle close)
    function adr(candles, period = 20) {
        const safePeriod = Math.max(1, Math.floor(period || 20));
        if (!candles || candles.length === 0) {
            return { value: 0, percentage: 0, period: safePeriod };
        }

        const lastClose = candles[candles.length - 1]?.close;
        const slice = candles.slice(-Math.min(safePeriod, candles.length));

        let sum = 0;
        let n = 0;
        for (const c of slice) {
            if (!c) continue;
            const hi = typeof c.high === 'number' ? c.high : null;
            const lo = typeof c.low === 'number' ? c.low : null;
            if (hi === null || lo === null) continue;
            const range = hi - lo;
            if (!Number.isFinite(range) || range < 0) continue;
            sum += range;
            n++;
        }

        const value = n > 0 ? (sum / n) : 0;
        const percentage = (Number.isFinite(lastClose) && lastClose > 0)
            ? (value / lastClose) * 100
            : 0;

        return { value, percentage, period: safePeriod };
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADVANCED SUPPORT & RESISTANCE ENGINE  (Stateful)
    // ═══════════════════════════════════════════════════════════════════

    // Persistent state per ticker
    const _srState = {};  // { ticker: { levels: [], ranges: [], breakouts: [], lastPrice: n } }

    // Colors
    const SR_COLORS = {
        support: 'rgba(34, 197, 94, 0.85)',   // emerald-500
        resistance: 'rgba(239, 68, 68, 0.85)',   // rose-500
        newSupport: 'rgba(52, 211, 153, 1.0)',   // emerald-400 bright
        newResist: 'rgba(251, 113, 133, 1.0)',  // rose-400 bright
        rangeShade: 'rgba(148, 163, 184, 0.08)', // slate fill
        rangeBorder: 'rgba(148, 163, 184, 0.35)', // slate dashed
        breakoutUp: '#22c55e',
        breakoutDn: '#ef4444',
    };

    // Timeframe weight mapping → lineWidth & opacity scale
    const TF_WEIGHT = {
        '1W': { lineWidth: 3, opacity: 1.0, label: 'W' },
        '1D': { lineWidth: 2, opacity: 0.85, label: 'D' },
        '4H': { lineWidth: 2, opacity: 0.7, label: '4H' },
        '1H': { lineWidth: 1, opacity: 0.6, label: '1H' },
        '15m': { lineWidth: 1, opacity: 0.45, label: '15' },
        '5m': { lineWidth: 1, opacity: 0.35, label: '5' },
        '1m': { lineWidth: 1, opacity: 0.25, label: '1' },
    };

    /**
     * Main entry: compute stateful S&R levels for a ticker.
     * @param {string} ticker
     * @param {Object[]} candles  – OHLCV array (current timeframe)
     * @param {number} viewTf    – current chart timeframe in minutes
     * @returns {{ levels, ranges, breakouts }}
     */
    function advancedSR(ticker, candles, viewTf = 5) {
        if (!candles || candles.length < 10) return { levels: [], ranges: [], breakouts: [] };

        const currentPrice = candles[candles.length - 1].close;
        const prevState = _srState[ticker] || { levels: [], ranges: [], breakouts: [], lastPrice: currentPrice };

        // 1. Detect raw pivot levels from candle history
        const rawLevels = _detectPivotLevels(candles, viewTf);

        // 2. Merge with existing stateful levels (preserve role-reversal history)
        const mergedLevels = _mergeWithState(rawLevels, prevState.levels, currentPrice);

        // 3. Apply role reversal logic
        const { levels: updatedLevels, reversals } = _applyRoleReversal(mergedLevels, currentPrice, prevState.lastPrice);

        // 4. Identify consolidation ranges
        const ranges = _identifyRanges(updatedLevels, currentPrice);

        // 5. Detect breakout signals
        const breakouts = _detectBreakouts(updatedLevels, ranges, currentPrice, prevState.lastPrice, candles);

        // Save state
        _srState[ticker] = {
            levels: updatedLevels,
            ranges,
            breakouts,
            lastPrice: currentPrice
        };

        return { levels: updatedLevels, ranges, breakouts };
    }

    // ── 1. Pivot Level Detection ────────────────────────────────────
    function _detectPivotLevels(candles, viewTf) {
        const levels = [];
        const len = candles.length;

        // Scan multiple lookback windows for multi-timeframe effect
        const windows = [
            { lookback: Math.min(30, len), tfOrigin: _mapTfOrigin(viewTf, 1) },
            { lookback: Math.min(80, len), tfOrigin: _mapTfOrigin(viewTf, 2) },
            { lookback: Math.min(200, len), tfOrigin: _mapTfOrigin(viewTf, 3) },
        ];

        windows.forEach(({ lookback, tfOrigin }) => {
            if (len < lookback) return;
            const slice = candles.slice(-lookback);

            // Find local swing highs and lows (5-bar pivots)
            for (let i = 2; i < slice.length - 2; i++) {
                const c = slice[i];
                // Swing high
                if (c.high > slice[i - 1].high && c.high > slice[i - 2].high &&
                    c.high > slice[i + 1].high && c.high > slice[i + 2].high) {
                    _addOrMergeLevel(levels, c.high, 'resistance', tfOrigin, c.time);
                }
                // Swing low
                if (c.low < slice[i - 1].low && c.low < slice[i - 2].low &&
                    c.low < slice[i + 1].low && c.low < slice[i + 2].low) {
                    _addOrMergeLevel(levels, c.low, 'support', tfOrigin, c.time);
                }
            }
        });

        return levels;
    }

    function _mapTfOrigin(viewTf, tier) {
        // Map chart timeframe + tier to a timeframe_origin label
        const map = {
            1: ['1m', '5m', '1H'],
            5: ['5m', '1H', '1D'],
            15: ['15m', '4H', '1D'],
            60: ['1H', '1D', '1W'],
        };
        return (map[viewTf] || ['5m', '1H', '1D'])[tier - 1] || '1D';
    }

    function _addOrMergeLevel(levels, value, type, tfOrigin, time) {
        // Merge if within 0.3% of existing level
        const threshold = value * 0.003;
        const existing = levels.find(l => Math.abs(l.value - value) < threshold);
        if (existing) {
            existing.touches++;
            // Upgrade timeframe if stronger
            const existingRank = _tfRank(existing.tfOrigin);
            const newRank = _tfRank(tfOrigin);
            if (newRank > existingRank) existing.tfOrigin = tfOrigin;
            existing.value = (existing.value * (existing.touches - 1) + value) / existing.touches;
            existing.lastTouchTime = Math.max(existing.lastTouchTime || 0, time);
        } else {
            levels.push({
                value,
                type,
                tfOrigin,
                touches: 1,
                lastTouchTime: time,
                reversed: false,
                reversalAge: 0,
                id: `sr_${Math.random().toString(36).substr(2, 6)}`
            });
        }
    }

    function _tfRank(tf) {
        const ranks = { '1m': 1, '5m': 2, '15m': 3, '1H': 4, '4H': 5, '1D': 6, '1W': 7 };
        return ranks[tf] || 2;
    }

    // ── 2. Merge with Existing State ────────────────────────────────
    function _mergeWithState(newLevels, prevLevels, currentPrice) {
        const merged = [...prevLevels];
        const priceRange = currentPrice * 0.05; // only keep levels within ±5% of price

        newLevels.forEach(nl => {
            const existing = merged.find(m => Math.abs(m.value - nl.value) / nl.value < 0.003);
            if (existing) {
                existing.touches = Math.max(existing.touches, nl.touches);
                if (_tfRank(nl.tfOrigin) > _tfRank(existing.tfOrigin)) existing.tfOrigin = nl.tfOrigin;
                existing.lastTouchTime = Math.max(existing.lastTouchTime || 0, nl.lastTouchTime || 0);
            } else {
                merged.push({ ...nl });
            }
        });

        // Filter to relevant price zone & cap at 8 levels
        return merged
            .filter(l => Math.abs(l.value - currentPrice) < priceRange)
            .sort((a, b) => _tfRank(b.tfOrigin) - _tfRank(a.tfOrigin) || b.touches - a.touches)
            .slice(0, 8);
    }

    // ── 3. Role Reversal ────────────────────────────────────────────
    function _applyRoleReversal(levels, currentPrice, lastPrice) {
        const reversals = [];

        levels.forEach(level => {
            // Age down any previous reversals
            if (level.reversed) level.reversalAge++;

            // Resistance → Support: price closes above
            if (level.type === 'resistance' && currentPrice > level.value && lastPrice <= level.value) {
                level.type = 'support';
                level.reversed = true;
                level.reversalAge = 0;
                reversals.push({ level, from: 'resistance', to: 'support' });
            }
            // Support → Resistance: price closes below
            else if (level.type === 'support' && currentPrice < level.value && lastPrice >= level.value) {
                level.type = 'resistance';
                level.reversed = true;
                level.reversalAge = 0;
                reversals.push({ level, from: 'support', to: 'resistance' });
            }
        });

        return { levels, reversals };
    }

    // ── 4. Consolidation Range Detection ────────────────────────────
    function _identifyRanges(levels, currentPrice) {
        const ranges = [];

        // Find pairs of nearby support + resistance that bracket current price
        const supports = levels.filter(l => l.type === 'support' && l.value < currentPrice)
            .sort((a, b) => b.value - a.value);
        const resistances = levels.filter(l => l.type === 'resistance' && l.value > currentPrice)
            .sort((a, b) => a.value - b.value);

        if (supports.length > 0 && resistances.length > 0) {
            const sup = supports[0];
            const res = resistances[0];
            const rangeWidth = (res.value - sup.value) / currentPrice;

            // Consolidation = range width < 3% of price
            if (rangeWidth < 0.03 && rangeWidth > 0.002) {
                ranges.push({
                    upper: res.value,
                    lower: sup.value,
                    width: rangeWidth,
                    upperLevel: res,
                    lowerLevel: sup,
                    midpoint: (res.value + sup.value) / 2
                });
            }
        }

        return ranges;
    }

    // ── 5. Breakout Signal Detection ────────────────────────────────
    function _detectBreakouts(levels, ranges, currentPrice, lastPrice, candles) {
        const breakouts = [];
        if (!lastPrice) return breakouts;

        const latestCandle = candles[candles.length - 1];
        const latestTime = latestCandle?.time || Math.floor(Date.now() / 1000);

        levels.forEach(level => {
            const threshold = level.value * 0.001; // 0.1% buffer
            const isStrong = level.touches >= 3 || _tfRank(level.tfOrigin) >= 5;

            // Breakout UP through resistance
            if (level.type === 'support' && level.reversed && level.reversalAge === 0) {
                // Just reversed from resistance → support, that IS the breakout
                const inRange = ranges.some(r =>
                    Math.abs(r.upper - level.value) / level.value < 0.003
                );
                breakouts.push({
                    time: latestTime,
                    price: currentPrice,
                    levelValue: level.value,
                    direction: 'up',
                    strength: isStrong ? 'strong' : 'normal',
                    fromRange: inRange,
                    label: inRange ? 'RANGE BREAKOUT ▲' : 'BREAKOUT ▲'
                });
            }

            // Breakout DOWN through support
            if (level.type === 'resistance' && level.reversed && level.reversalAge === 0) {
                const inRange = ranges.some(r =>
                    Math.abs(r.lower - level.value) / level.value < 0.003
                );
                breakouts.push({
                    time: latestTime,
                    price: currentPrice,
                    levelValue: level.value,
                    direction: 'down',
                    strength: isStrong ? 'strong' : 'normal',
                    fromRange: inRange,
                    label: inRange ? 'RANGE BREAKDOWN ▼' : 'BREAKDOWN ▼'
                });
            }
        });

        return breakouts;
    }

    /**
     * Get rendering info for a single level (used by chart engine).
     */
    function getSRRenderInfo(level) {
        const weight = TF_WEIGHT[level.tfOrigin] || TF_WEIGHT['5m'];
        const isNew = level.reversed && level.reversalAge < 5;

        let color;
        if (isNew && level.type === 'support') color = SR_COLORS.newSupport;
        else if (isNew && level.type === 'resistance') color = SR_COLORS.newResist;
        else if (level.type === 'support') color = SR_COLORS.support;
        else color = SR_COLORS.resistance;

        const label = isNew
            ? `New ${level.type === 'support' ? 'Sup' : 'Res'}: $${level.value.toFixed(2)}`
            : `${level.type === 'support' ? 'Sup' : 'Res'}: $${level.value.toFixed(2)}`;

        return {
            color,
            lineWidth: weight.lineWidth,
            opacity: weight.opacity,
            lineStyle: 0,  // solid
            label,
            tfLabel: weight.label,
            isNew,
            title: `${label} [${weight.label}] (${level.touches} touches)`
        };
    }

    // ── Public API ──────────────────────────────────────────────────
    return {
        sma, ema, rsi, macd, bollingerBands, vwap, adr,
        advancedSR, getSRRenderInfo, SR_COLORS, TF_WEIGHT
    };
})();
