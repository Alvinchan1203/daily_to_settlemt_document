global._LOTSIZE_DATA = require('./lotsize_data.json');

const serverless = require('serverless-http');
const app = require('../server');

module.exports = serverless(app);
