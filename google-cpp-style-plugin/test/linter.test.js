// Тесты ядра: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { lint } = require('../out/core/linter');
const { fixAll } = require('../out/core/fixer');

const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const rules = (code, cfg = {}, file = 'a.cc') => lint(code, file, cfg).map((i) => i.rule);

test('правильный код не даёт замечаний', () => {
  for (const f of ['good.cc', 'good.h', 'tricky.cc']) {
    assert.deepStrictEqual(lint(fx(f), f).map((i) => `${i.line + 1}:${i.rule}`), [], f);
  }
});

test('плохой код находит много нарушений', () => {
  const r = new Set(rules(fx('bad.cpp'), {}, 'bad.cpp'));
  for (const id of ['indentation', 'tab', 'using-namespace', 'naming-type', 'naming-function', 'naming-variable',
    'naming-member', 'naming-constant', 'naming-enumerator', 'naming-macro', 'brace-same-line', 'else-same-line',
    'space-after-keyword', 'operator-spacing', 'comma-spacing', 'pointer-alignment', 'nullptr', 'c-style-cast',
    'integer-types', 'explicit-constructor', 'virtual-override', 'return-parens', 'include-order', 'include-bits',
    'comment-spacing', 'todo-format', 'trailing-whitespace', 'empty-loop-body', 'range-for-colon']) {
    assert.ok(r.has(id), `ожидалось правило ${id}`);
  }
});

test('размер отступа настраивается', () => {
  const code = 'void F() {\n    int x = 0;\n}\n';
  assert.ok(rules(code).includes('indentation'));
  assert.ok(!rules(code, { indentSize: 4 }).includes('indentation'));
  assert.ok(rules('void F() {\n  int x = 0;\n}\n', { indentSize: 4 }).includes('indentation'));
});

test('switch, namespace и public: по правилам Google', () => {
  const code = 'namespace a {\nclass Foo {\n public:\n  void F();\n};\nvoid G(int x) {\n  switch (x) {\n    case 1:\n      break;\n    default:\n      break;\n  }\n}\n}  // namespace a\n';
  assert.deepStrictEqual(rules(code), []);
});

test('исправление идемпотентно и сохраняет компилируемость простого кода', () => {
  const r = fixAll(fx('bad.cpp'), 'bad.cpp', {}, true);
  const again = fixAll(r.text, 'bad.cpp', {}, true);
  assert.strictEqual(again.text, r.text);
  assert.ok(r.after < r.before / 4);
});

test('строки и комментарии не проверяются как код', () => {
  assert.deepStrictEqual(rules('const char kText[] = "a=b,c;if(x){";  // x=1,y\n'), []);
});

test('NOLINT отключает проверку строки', () => {
  assert.deepStrictEqual(rules('int x=1;  // NOLINT\n'), []);
  assert.deepStrictEqual(rules('int x=1;  // NOLINT(operator-spacing)\n'), []);
});

test('header guard', () => {
  assert.ok(rules('#pragma once\nint F();\n', {}, 'lab/foo.h').includes('header-guard'));
  assert.deepStrictEqual(rules('#ifndef LAB_FOO_H_\n#define LAB_FOO_H_\n\nint F();\n\n#endif  // LAB_FOO_H_\n', {}, 'lab/foo.h'), []);
  const fixed = fixAll('#pragma once\nint F();\n', 'lab/foo.h', {}).text;
  assert.match(fixed, /#ifndef LAB_FOO_H_\n#define LAB_FOO_H_[\s\S]*#endif {2}\/\/ LAB_FOO_H_\n$/);
});
