import fs from 'fs';

const file = 'server.ts';
const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');
const newLines = lines.slice(0, 262).concat(lines.slice(678));
fs.writeFileSync(file, newLines.join('\n'));
console.log('Done');
