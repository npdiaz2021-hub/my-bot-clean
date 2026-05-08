const fs = require('fs');
const path = 'commands.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
let changed = false;
for (const [name, cmd] of Object.entries(data)) {
  if (!Array.isArray(cmd.aliases)) {
    cmd.aliases = [];
    changed = true;
  }
  if (cmd.aliases.length === 0) {
    cmd.aliases = [name];
    changed = true;
  }
}
if (changed) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
console.log('updated', changed);
