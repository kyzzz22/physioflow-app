const fs = require('fs');
const files = ['Dashboard.jsx', 'SessionManager.jsx', 'Analytics.jsx', 'GuidePanel.jsx', 'Onboarding.jsx', 'RuntimeRunnerPage.jsx', 'RuntimeRunnerV2Page.jsx'];
for (const f of files) {
  const root = 'src';
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : e.name === f ? [dir + '/' + e.name] : []);
  const paths = walk(root);
  for (const p of paths) {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const total = lines.length;
    const zh = lines.filter(l => /[\u4e00-\u9fff]/.test(l)).length;
    console.log(`${p}: ${total} lines, ${zh} with CJK, avg ${Math.round(total / (lines.length || 1))}`);
  }
}
