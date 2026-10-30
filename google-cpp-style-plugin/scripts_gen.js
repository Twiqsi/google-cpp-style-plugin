// Генерирует раздел настроек package.json из списка правил (src/core/rules.ts).
const fs = require('fs');
const { RULES } = require('./out/core/rules');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const sev = ['error', 'warning', 'info', 'hint', 'off'];
const ruleProps = {};
for (const [id, r] of Object.entries(RULES)) {
  ruleProps[id] = {
    type: 'string', enum: sev,
    markdownDescription: `**${r.title}** (${r.category}). ${r.explain}` + (r.severity ? ` По умолчанию: \`${r.severity}\`.` : ''),
  };
}
pkg.contributes.configuration.properties['googleCppStyle.rules'].properties = ruleProps;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('rules:', Object.keys(ruleProps).length);
