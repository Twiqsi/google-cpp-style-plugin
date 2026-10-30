// Смоук-тест расширения целиком на имитации VS Code: node test/smoke.js
const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const mock = require('./vscode-mock');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'vscode' ? require.resolve('./vscode-mock-entry.js') : origResolve.call(this, req, ...rest);
};
fs.writeFileSync(path.join(__dirname, 'vscode-mock-entry.js'), "module.exports = require('./vscode-mock').vscode;\n");

(async () => {
  const ext = require('../out/extension');
  ext.activate({ subscriptions: [], extension: { id: 'twiqsi.google-cpp-style-plugin' } });
  const { state, config, makeDoc, openEditor } = mock;

  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'bad.cpp'), 'utf8');
  const doc = makeDoc('/ws/lab/bad.cpp', text);
  openEditor(doc);

  // 1. Подчёркивания.
  const diags = state.diagnostics.get(doc.uri.toString());
  console.log('диагностик:', diags.length);
  assert.ok(diags.length > 50);
  // 2. Счётчик в строке состояния.
  console.log('строка состояния:', state.statusBar.text, '| видна:', state.statusBar.visible);
  assert.match(state.statusBar.text, /Google Style: \d+/);
  console.log('подсказка строки состояния:\n' + state.statusBar.tooltip.value.split('\n').map((l) => '   ' + l).join('\n'));
  // 3. Подсказка при наведении на «if(» (строка 28).
  const hover = state.hover.provideHover(doc, new mock.vscode.Position(27, 5));
  assert.ok(hover);
  console.log('\nHOVER:\n' + hover.contents.value.split('\n').map((l) => '   ' + l).join('\n'));
  // 4. Быстрые исправления.
  const d = diags.find((x) => x.code.value === 'nullptr');
  const acts = state.actions.provideCodeActions(doc, d.range, { diagnostics: [d] });
  console.log('\nдействия для NULL:', acts.map((a) => a.title));
  assert.ok(acts.some((a) => a.title === 'Заменить на nullptr'));
  const nameDiag = diags.find((x) => x.code.value === 'naming-function');
  const nameActs = state.actions.provideCodeActions(doc, nameDiag.range, { diagnostics: [nameDiag] });
  console.log('действия для имени:', nameActs.map((a) => a.title));
  await state.commands['googleCppStyle.rename'](...nameActs[0].command.arguments);
  assert.ok(doc.getText().includes('GetSize') && !doc.getText().includes('getSize'));
  // 5. Исправить всё.
  await state.commands['googleCppStyle.fixAll']();
  console.log('\nпосле «Исправить всё»:', state.messages.at(-1), '| строка состояния:', state.statusBar.text);
  // 6. Смена размера отступа на 4.
  config.indentSize = 4;
  mock.fire('config', { affectsConfiguration: () => true });
  console.log('после indentSize=4:', state.statusBar.text);
  await state.commands['googleCppStyle.fixAllWithRenames']();
  console.log('после повторного исправления:', state.messages.at(-1));
  const lines = doc.getText().split('\n');
  console.log('фрагмент с отступом 4:\n' + lines.slice(lines.findIndex((l) => l.startsWith('int CalcSum')), lines.findIndex((l) => l.startsWith('int CalcSum')) + 8).join('\n'));
  // 7. Отчёт.
  await state.commands['googleCppStyle.report']();
  console.log('\nOK: смоук-тест пройден');
})().catch((e) => { console.error(e); process.exit(1); });
