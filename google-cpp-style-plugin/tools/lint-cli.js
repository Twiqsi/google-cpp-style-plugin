#!/usr/bin/env node
// Проверка файлов из командной строки (без VS Code):
//   node tools/lint-cli.js file.cpp [--indent 4] [--fix] [--rename]
const fs = require('fs');
const path = require('path');
const { lint } = require('../out/core/linter');
const { fixAll } = require('../out/core/fixer');

const args = process.argv.slice(2);
const files = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(indent|line-length)$/));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const cfg = {};
if (opt('--indent')) cfg.indentSize = +opt('--indent');
if (opt('--line-length')) cfg.lineLength = +opt('--line-length');
let total = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  if (args.includes('--fix')) {
    const r = fixAll(text, path.basename(f), cfg, args.includes('--rename'));
    fs.writeFileSync(f, r.text);
    console.log(`${f}: исправлено ${r.before - r.after} из ${r.before}`);
  }
  const issues = lint(fs.readFileSync(f, 'utf8'), path.basename(f), cfg);
  for (const i of issues) console.log(`${f}:${i.line + 1}:${i.col + 1}: [${i.rule}] ${i.message}`);
  total += issues.length;
}
console.log(`Всего нарушений: ${total}`);
process.exitCode = total ? 1 : 0;
