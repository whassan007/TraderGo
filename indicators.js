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

    // ── Support / Resistance (Pivot Points) ─────────────────────────
    function supportResistance(candles, lookback = 20) {
        const levels = [];
        if (candles.length < lookback) return levels;

        const recent = candles.slice(-lookback);
        const highs = recent.map(c => c.high).sort((a, b) => b - a);
        const lows = recent.map(c => c.low).sort((a, b) => a - b);

        // Cluster nearby highs/lows
        const clusters = (arr, threshold) => {
            const result = [];
            let i = 0;
            while (i < arr.length && result.length < 3) {
                const cluster = [arr[i]];
                let j = i + 1;
                while (j < arr.length && Math.abs(arr[j] - arr[i]) / arr[i] < threshold) {
                    cluster.push(arr[j]);
                    j++;
                }
                result.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
                i = j;
            }
            return result;
        };

        const resistanceLevels = clusters(highs, 0.005);
        const supportLevels = clusters(lows, 0.005);

        resistanceLevels.forEach(level => {
            levels.push({ value: level, type: 'resistance', color: 'rgba(239, 68, 68, 0.4)' });
        });
        supportLevels.forEach(level => {
            levels.push({ value: level, type: 'support', color: 'rgba(34, 197, 94, 0.4)' });
        });

        return levels;
    }

    // ── Public API ──────────────────────────────────────────────────
    return { sma, ema, rsi, macd, bollingerBands, vwap, supportResistance };
})();
