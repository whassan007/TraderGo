const functions = require('firebase-functions');
const express = require('express');
const cors = require('cors');
const yahooFinance = require('yahoo-finance2').default;

// Suppress console warnings from yahoo-finance2
yahooFinance.suppressNotices(['yahooSurvey']);

const app = express();
app.use(cors({ origin: true }));

/**
 * GET /api/quote?symbol=SPY
 * Fetches real-time price, change, volume, and market cap.
 */
app.get('/api/quote', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'SPY';
        const quote = await yahooFinance.quote(symbol);
        
        if (!quote) return res.status(404).json({ error: 'Ticker not found' });
        
        res.json({
            symbol: quote.symbol,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            volume: quote.regularMarketVolume,
            marketCap: quote.marketCap,
            time: quote.regularMarketTime ? Math.floor(quote.regularMarketTime.getTime() / 1000) : null
        });
    } catch (error) {
        console.error('Error fetching quote:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/historical?symbol=SPY&interval=5m&range=5d
 * Fetches historical OHLCV candles
 */
app.get('/api/historical', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'SPY';
        const interval = req.query.interval || '5m';
        
        const chartOptions = { interval };
        
        if (req.query.from && req.query.to) {
            chartOptions.period1 = new Date(parseInt(req.query.from) * 1000);
            chartOptions.period2 = new Date(parseInt(req.query.to) * 1000);
        } else {
            chartOptions.range = req.query.range || '5d';
        }
        
        const result = await yahooFinance.chart(symbol, chartOptions);
        
        if (!result || !result.quotes || result.quotes.length === 0) {
            return res.json([]);
        }
        
        // Format to match what the Backtest Engine expects
        const candles = result.quotes.map(q => ({
            time: Math.floor(q.date.getTime() / 1000),
            open: q.open,
            high: q.high,
            low: q.low,
            close: q.close,
            volume: q.volume
        })).filter(c => c.close !== null); // filter out incomplete candles
        
        res.json(candles);
    } catch (error) {
        console.error('Error fetching historical:', error.message);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/options?symbol=SPY
 * Fetches option chains with Greeks
 */
app.get('/api/options', async (req, res) => {
    try {
        const symbol = req.query.symbol || 'SPY';
        const result = await yahooFinance.options(symbol);
        res.json(result);
    } catch (error) {
        console.error('Error fetching options:', error.message);
        res.status(500).json({ error: error.message });
    }
});

exports.api = functions.https.onRequest(app);
