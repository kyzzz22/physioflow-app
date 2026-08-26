const fs = require('fs');
for (const file of process.argv.slice(2)) {
  const t = fs.readFileSync(file, 'utf8');
  const ip = /import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]\s*;/g;
  const named = {};
  let m;
  while ((m = ip.exec(t))) { m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => { named[n] = 0; }); }
  const body = t.replace(ip, '');
  for (const n of Object.keys(named)) {
    const re = new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    if ((body.match(re) || []).length === 0) console.log(file + ' UNUSED:', n);
  }
}
