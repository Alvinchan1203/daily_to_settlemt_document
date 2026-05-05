// Preload lotsize data — forces ZISI bundler to include the file, and passes it to server.js via global
global._LOTSIZE_DATA = require('./lotsize_data.json');

const serverless = require('serverless-http');
const app = require('../../server');

module.exports.handler = serverless(app);
