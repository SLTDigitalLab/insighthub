// Product list = reference data (backend/data/products.json). Not template content.
const PRODUCTS = require('../data/products.json');
const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

module.exports = { PRODUCTS, PRODUCT_BY_ID };
