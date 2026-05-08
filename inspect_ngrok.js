const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'node_modules', 'ngrok');
try {
  const files = fs.readdirSync(dir);
  console.log(files.join('\n'));
} catch (err) {
  console.error('ERROR', err.message);
}
