'use strict';

const crypto = require('crypto');
const Stock = require('../models/Stock');

// Anonymize IP address using SHA256 hash
function anonymizeIP(ip) {
    return crypto.createHash('sha256').update(ip).digest('hex');
}

// Fetch stock data from API
async function fetchStockData(symbol) {
    try {
        const response = await fetch(`https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${symbol}/quote`);

        if (!response.ok) {
            throw new Error('Stock not found');
        }

        const data = await response.json();
        return data;
    } catch (error) {
        throw new Error('Invalid stock symbol');
    }
}

// Get likes for a stock
async function getLikes(stockSymbol) {
    const stock = await Stock.findOne({symbol: stockSymbol});
    return stock ? stock.likes.length : 0;
}

// Add like for a stock from an IP
async function addLike(stockSymbol, hashedIP) {
    let stock = await Stock.findOne({symbol: stockSymbol});

    if (!stock) {
        stock = new Stock({symbol: stockSymbol, likes: [hashedIP]});
        await stock.save();
    } else if (!stock.likes.includes(hashedIP)) {
        stock.likes.push(hashedIP);
        await stock.save();
    }
}

// Check if IP has already liked a stock
async function hasLiked(stockSymbol, hashedIP) {
    const stock = await Stock.findOne({symbol: stockSymbol});
    return stock ? stock.likes.includes(hashedIP) : false;
}

module.exports = function (app) {

    app.route('/api/stock-prices')
        .get(async function (req, res) {
            try {
                const {stock, like} = req.query;
                const ip = req.ip || req.connection.remoteAddress;
                const hashedIP = anonymizeIP(ip);

                // Handle single stock
                if (typeof stock === 'string') {
                    const stockData = await fetchStockData(stock);
                    const stockSymbol = stockData.symbol.toUpperCase();

                    // Add like if requested and not already liked
                    if (like === 'true') {
                        const alreadyLiked = await hasLiked(stockSymbol, hashedIP);
                        if (!alreadyLiked) {
                            await addLike(stockSymbol, hashedIP);
                        }
                    }

                    const likes = await getLikes(stockSymbol);

                    return res.json({
                        stockData: {
                            stock: stockSymbol, price: stockData.latestPrice, likes: likes
                        }
                    });
                }

                // Handle two stocks
                if (Array.isArray(stock) && stock.length === 2) {
                    const [stockData1, stockData2] = await Promise.all([fetchStockData(stock[0]), fetchStockData(stock[1])]);

                    const symbol1 = stockData1.symbol.toUpperCase();
                    const symbol2 = stockData2.symbol.toUpperCase();

                    // Add likes if requested
                    if (like === 'true') {
                        const [alreadyLiked1, alreadyLiked2] = await Promise.all([hasLiked(symbol1, hashedIP), hasLiked(symbol2, hashedIP)]);

                        const likePromises = [];
                        if (!alreadyLiked1) {
                            likePromises.push(addLike(symbol1, hashedIP));
                        }
                        if (!alreadyLiked2) {
                            likePromises.push(addLike(symbol2, hashedIP));
                        }
                        await Promise.all(likePromises);
                    }

                    const [likes1, likes2] = await Promise.all([getLikes(symbol1), getLikes(symbol2)]);

                    return res.json({
                        stockData: [{
                            stock: symbol1, price: stockData1.latestPrice, rel_likes: likes1 - likes2
                        }, {
                            stock: symbol2, price: stockData2.latestPrice, rel_likes: likes2 - likes1
                        }]
                    });
                }

                res.status(400).json({error: 'Invalid request'});

            } catch (error) {
                res.status(400).json({error: error.message});
            }
        });
};
