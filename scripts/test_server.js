const http = require('http');
const port = Number(process.env.PORT || process.env.WEB_PORT || 61234);
const req = http.request({ host: 'localhost', port, path: '/' }, (res) => {
  console.log('Server responding:', res.statusCode);
}).on('error', (e) => {
  console.log('Server not responding:', e.message);
}).end();
