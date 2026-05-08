const http = require('http');
const req = http.request({ host: 'localhost', port: 8080, path: '/' }, (res) => {
  console.log('Server responding:', res.statusCode);
}).on('error', (e) => {
  console.log('Server not responding:', e.message);
}).end();