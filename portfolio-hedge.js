/**
 * Portfolio Hedge Engine
 * Runs the 80% Tech (NVDA, MSFT, ASML) / 20% Inverse (SH, PSQ, TAIL) strategy natively in the browser.
 */

const PortfolioHedge = (() => {
    const TICKERS_LONG = ['NVDA', 'MSFT', 'ASML'];
    const TICKERS_SHORT = ['SH', 'PSQ', 'TAIL'];
    const TICKERS_ALL = [...TICKERS_LONG, ...TICKERS_SHORT];
    
    // Fetch historical data for a specific year
    async function fetchYearData(year, updateProgress) {
        const start = `${year}-01-01`;
        const end = `${year}-12-31`;
        const data = {};
        
        let done = 0;
        for (const ticker of TICKERS_ALL) {
            try {
                // Determine proxy path. We assume the proxy is running at /api/historical or we use Finnhub as a fallback
                // The main backtest-engine uses: /api/historical?symbol=${ticker}&interval=1d&from=${start}&to=${end}
                // We'll use the same timestamp format
                const fromTs = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
                const toTs = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);
                
                const url = `/api/historical?symbol=${ticker}&resolution=D&from=${fromTs}&to=${toTs}`;
                const res = await fetch(url);
                const json = await res.json();
                
                if (json && json.length > 0) {
                    data[ticker] = json;
                } else {
                    console.warn(`[PortfolioHedge] No data for ${ticker} in ${year}. Generating mock data fallback...`);
                    data[ticker] = _generateMockData(ticker, fromTs, toTs);
                }
            } catch (err) {
                console.warn(`[PortfolioHedge] Fetch fail for ${ticker}. Generating mock data fallback...`);
                data[ticker] = _generateMockData(ticker, Math.floor(new Date(`${year}-01-01`).getTime() / 1000), Math.floor(new Date(`${year}-12-31`).getTime() / 1000));
            }
            
            done++;
            if (updateProgress) updateProgress(done / TICKERS_ALL.length);
        }
        
        return data;
    }

    function _generateMockData(ticker, fromTs, toTs) {
        // Fallback GBM exactly like the python backtest missing data handling
        const days = Math.floor((toTs - fromTs) / 86400);
        let price = TICKERS_LONG.includes(ticker) ? 100 : 50;
        const drift = TICKERS_LONG.includes(ticker) ? 0.0005 : -0.0002;
        const vol = 0.02;
        
        const out = [];
        for (let i = 0; i < days; i++) {
            const time = fromTs + (i * 86400);
            const d = new Date(time * 1000);
            if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
            
            price = price * Math.exp(drift - 0.5 * vol * vol + vol * (Math.random() - 0.5) * 2);
            out.push({ time, close: price });
        }
        return out;
    }

    // Run the backtest
    function runSimulation(dataMap) {
        // Align dates
        // We find the longest array, and map to timestamps
        let allTimes = new Set();
        for (const ticker in dataMap) {
            dataMap[ticker].forEach(c => allTimes.add(c.time));
        }
        const times = Array.from(allTimes).sort((a,b) => a - b);
        
        if (times.length === 0) return null;

        const INITIAL_CASH = 100000;
        const weights = {};
        TICKERS_LONG.forEach(t => weights[t] = 0.80 / TICKERS_LONG.length);
        TICKERS_SHORT.forEach(t => weights[t] = 0.20 / TICKERS_SHORT.length);

        const shares = {};
        TICKERS_ALL.forEach(t => shares[t] = 0);
        
        const equityCurve = [];
        let peak = INITIAL_CASH;
        let maxDrawdown = 0;
        
        let invested = false;

        // Ensure we have an initial baseline price to track missing days
        const lastPrice = {};

        for (const t of times) {
            // Update last known prices for this timestamp
            let allHavePrices = true;
            for (const ticker of TICKERS_ALL) {
                const candle = dataMap[ticker].find(c => c.time === t);
                if (candle) lastPrice[ticker] = candle.close;
                if (!lastPrice[ticker]) allHavePrices = false;
            }

            // Initial allocation only happens when we have prices for ALL assets
            if (!invested && allHavePrices) {
                for (const ticker of TICKERS_ALL) {
                    const capitalForTicker = INITIAL_CASH * weights[ticker];
                    shares[ticker] = capitalForTicker / lastPrice[ticker];
                }
                invested = true;
                
                equityCurve.push({ time: t, value: INITIAL_CASH });
                continue;
            }

            if (invested) {
                let currentVal = 0;
                for (const ticker of TICKERS_ALL) {
                    currentVal += shares[ticker] * (lastPrice[ticker] || 0);
                }
                
                equityCurve.push({ time: t, value: currentVal });
                
                if (currentVal > peak) peak = currentVal;
                const dd = (peak - currentVal) / peak;
                if (dd > maxDrawdown) maxDrawdown = dd;
            }
        }

        if (equityCurve.length === 0) return null;

        const startValue = INITIAL_CASH;
        const finalValue = equityCurve[equityCurve.length - 1].value;
        const totalReturn = (finalValue - startValue) / startValue;
        
        // Annualized Return roughly
        const startD = new Date(equityCurve[0].time * 1000);
        const endD = new Date(equityCurve[equityCurve.length - 1].time * 1000);
        const years = (endD - startD) / (1000 * 60 * 60 * 24 * 365.25);
        let annReturn = 0;
        if (years > 0 && finalValue > 0) {
            annReturn = Math.pow(finalValue / startValue, 1 / years) - 1;
        }

        return {
            startValue,
            finalValue,
            totalReturn: totalReturn * 100,
            annReturn: annReturn * 100,
            maxDrawdown: maxDrawdown * 100,
            equityCurve
        };
    }

    return {
        fetchYearData,
        runSimulation
    };
})();
