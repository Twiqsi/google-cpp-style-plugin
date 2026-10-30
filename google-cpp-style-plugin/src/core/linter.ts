// Главный модуль проверки. lint(text, fileName, config) → список нарушений.
//
// Как это работает:
// 1) lexer.analyze() маскирует комментарии и строки;
// 2) structurePass() идёт по строкам и отслеживает фигурные скобки, скобки
//    и границы инструкций — так вычисляется ожидаемый отступ каждой строки
//    и «область видимости» (namespace / class / функция / switch / enum);
// 3) lineRules() — правила, которые смотрят на одну строку (пробелы, касты...);
// 4) declarationRules() — разбор объявлений и проверка имён;
// 5) fileRules() — правила уровня файла (header guard, #include, пустые строки).

import { analyze, matchParen, SourceInfo } from './lexer';
import { BUILTIN_TYPES, CPP_KEYWORDS, isConstant, isMacro, isMember, isPascal, isSnake,
  toConstant, toMacro, toMember, toPascal, toSnake } from './naming';
import { RULES } from './rules';
import { Fix, Issue, LintConfig, Rename, Severity, TextEdit, withDefaults } from './types';

type Kind = 'namespace' | 'class' | 'enum' | 'switch' | 'function' | 'block' | 'lambda' | 'init';

interface Brace {
  kind: Kind;
  keyword?: string; // class | struct | union
  name?: string;
  base: number;
  line: number;
  col: number;
  restore: boolean;
  savedParen: number;
  savedStmtOpen: boolean;
  savedStmtBase: number;
  savedStmtText: string;
  savedStmtLine: number;
  hasDefault?: boolean;
  enumExpect?: boolean;
}

interface LineInfo {
  /** Строка начинает новую инструкцию (не продолжение предыдущей). */
  stmtStart: boolean;
  /** Строка — продолжение незаконченной инструкции. */
  continued: boolean;
  /** Ближайшая открытая фигурная скобка в начале строки. */
  scope?: Brace;
  /** Вид блока, который открывается в конце этой строки (если строка кончается на `{`). */
  opensKind?: Kind;
  /** Вид блока, который закрывается первой `}` этой строки. */
  closesKind?: Kind;
  isAccess: boolean;
  /** Ожидаемый отступ строки и строгая ли проверка. */
  expected?: number;
  strict?: boolean;
}

const ACCESS_RE = /^(public|protected|private)\s*:$/;
const isIdentChar = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c);
const HEADER_EXT = /\.(h|hh|hpp|hxx|h\+\+)$/i;

class Ctx {
  issues: Issue[] = [];
  nolint = new Map<number, Set<string> | 'all'>();
  info: LineInfo[] = [];
  guardName?: string;
  readonly isHeader: boolean;

  constructor(readonly src: SourceInfo, readonly cfg: LintConfig, readonly fileName: string) {
    this.isHeader = HEADER_EXT.test(fileName);
    src.lines.forEach((l, i) => {
      const m = l.match(/\/\/.*\bNOLINT(NEXTLINE)?\b(?:\(([^)]*)\))?/);
      if (!m) return;
      const target = m[1] ? i + 1 : i;
      if (!m[2]) this.nolint.set(target, 'all');
      else this.nolint.set(target, new Set(m[2].split(',').map((s) => s.trim())));
    });
  }

  severity(rule: string): Severity {
    return this.cfg.rules[rule] ?? RULES[rule]?.severity ?? this.cfg.defaultSeverity;
  }

  report(rule: string, line: number, col: number, endCol: number, message: string,
    fix?: Fix, rename?: Rename, endLine = line): void {
    const severity = this.severity(rule);
    if (severity === 'off') return;
    const nl = this.nolint.get(line);
    if (nl === 'all' || (nl && nl.has(rule))) return;
    if (endLine === line && endCol <= col) endCol = col + 1;
    this.issues.push({ rule, line, col, endLine, endCol, message, severity, fix, rename });
  }
}

// ───────────────────────── вспомогательные функции ─────────────────────────

const edit = (line: number, col: number, endCol: number, text: string, endLine = line): TextEdit =>
  ({ line, col, endLine, endCol, text });
const insert = (line: number, col: number, text: string): TextEdit => edit(line, col, col, text);

function leading(s: string): string {
  return s.match(/^[ \t]*/)![0];
}

function firstNonSpace(s: string): number {
  const m = s.search(/\S/);
  return m;
}

function stripTemplatePrefix(s: string): string {
  const m = s.match(/^\s*template\s*</);
  if (!m) return s;
  let depth = 0;
  for (let i = m[0].length - 1; i < s.length; i++) {
    if (s[i] === '<') depth++;
    else if (s[i] === '>') {
      depth--;
      if (depth === 0) return s.slice(i + 1);
    }
  }
  return s;
}

/** Разбить список по запятым верхнего уровня (учитывая () [] {} <>). */
function splitTopLevel(s: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  let depth = 0;
  let angle = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '<' && s[i + 1] !== '<' && s[i - 1] !== '<') angle++;
    else if (c === '>' && angle > 0 && s[i - 1] !== '-') angle--;
    else if (c === ',' && depth === 0 && angle === 0) {
      parts.push({ text: s.slice(start, i), start });
      start = i + 1;
    }
  }
  parts.push({ text: s.slice(start), start });
  return parts;
}

interface Tok { t: string; col: number }

function tokenize(s: string, offset = 0): Tok[] {
  const toks: Tok[] = [];
  const re = /([A-Za-z_]\w*)|(\d[\w.']*)|("[^"]*"|'[^']*')|(::|->|&&|\.\.\.|\[\[|\]\])|(\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) toks.push({ t: m[0], col: m.index + offset });
  return toks;
}

const SPEC_WORDS = new Set(['static', 'const', 'constexpr', 'consteval', 'constinit', 'inline', 'mutable',
  'volatile', 'extern', 'thread_local', 'register', 'virtual', 'explicit', 'typename', '[[nodiscard]]']);
const TYPE_WORDS = new Set([...BUILTIN_TYPES, 'size_t']);
const NOT_A_TYPE = new Set(['return', 'delete', 'new', 'throw', 'goto', 'case', 'default', 'else', 'if',
  'for', 'while', 'switch', 'do', 'break', 'continue', 'using', 'typedef', 'namespace', 'class', 'struct',
  'enum', 'union', 'public', 'private', 'protected', 'template', 'friend', 'co_return', 'co_yield',
  'co_await', 'sizeof', 'static_assert', 'operator', 'this', 'true', 'false', 'nullptr', 'try', 'catch',
  'and', 'or', 'not', 'decltype', 'alignof', 'requires', 'concept', 'asm', 'export']);

interface Decl {
  specs: Set<string>;
  typeText: string;
  typeConst: boolean;
  ptr: string;
  name: Tok;
  qualified: boolean;
  isOperator: boolean;
  next: Tok | undefined;
  nextIndex: number;
}

/** Пробует разобрать начало объявления: [спецификаторы] тип [*&] имя <следующий токен>. */
function parseDecl(toks: Tok[], start = 0): Decl | null {
  let i = start;
  const specs = new Set<string>();
  let typeConst = false;
  // [[атрибуты]]
  while (toks[i]?.t === '[[') {
    while (i < toks.length && toks[i].t !== ']]') i++;
    i++;
  }
  while (toks[i] && SPEC_WORDS.has(toks[i].t)) specs.add(toks[i++].t);
  if (specs.has('const')) typeConst = true;
  const typeStart = i;
  const t0 = toks[i];
  if (!t0) return null;
  if (TYPE_WORDS.has(t0.t)) {
    while (toks[i] && (TYPE_WORDS.has(toks[i].t) || toks[i].t === 'const' || toks[i].t === 'volatile')) {
      if (toks[i].t === 'const') typeConst = true;
      i++;
    }
  } else {
    if (toks[i].t === '::') i++;
    const first = toks[i];
    if (!first || !/^[A-Za-z_]/.test(first.t) || NOT_A_TYPE.has(first.t) || CPP_KEYWORDS.has(first.t)) return null;
    i++;
    for (;;) {
      // аргументы шаблона
      if (toks[i]?.t === '<') {
        let depth = 0;
        let j = i;
        let ok = false;
        for (; j < toks.length; j++) {
          const t = toks[j].t;
          if (t === '<') {
            if (toks[j + 1]?.t === '<') break; // это <<
            depth++;
          } else if (t === '>') {
            depth--;
            if (depth === 0) {
              ok = true;
              break;
            }
          } else if (t === ';' || t === '{' || t === '}' || t === '&&' || t === '|' || t === '=') break;
        }
        if (!ok) break;
        i = j + 1;
      }
      if (toks[i]?.t === '::' && toks[i + 1] && /^[A-Za-z_]/.test(toks[i + 1].t)) {
        i += 2;
        continue;
      }
      if (toks[i]?.t === '::') return null; // Foo::~Foo, Foo::operator
      break;
    }
  }
  while (toks[i] && (toks[i].t === 'const' || toks[i].t === 'volatile')) {
    typeConst = true;
    i++;
  }
  const typeText = toks.slice(typeStart, i).map((t) => t.t).join(' ');
  let ptr = '';
  while (toks[i] && (toks[i].t === '*' || toks[i].t === '&' || toks[i].t === '&&' || toks[i].t === 'const')) {
    ptr += toks[i].t === 'const' ? ' const' : toks[i].t;
    i++;
  }
  if (ptr.includes('*') && !ptr.endsWith('const')) typeConst = false;
  let qualified = false;
  if (toks[i]?.t === '::') i++;
  let name = toks[i];
  if (!name || !/^[A-Za-z_]/.test(name.t)) return null;
  if (name.t === 'operator') {
    return { specs, typeText, typeConst, ptr, name, qualified, isOperator: true, next: undefined, nextIndex: i + 1 };
  }
  if (CPP_KEYWORDS.has(name.t) && name.t !== 'final' && name.t !== 'override') return null;
  i++;
  while (toks[i]?.t === '::' && toks[i + 1]) {
    qualified = true;
    if (toks[i + 1].t === '~' || toks[i + 1].t === 'operator') {
      return { specs, typeText, typeConst, ptr, name: toks[i + 1], qualified, isOperator: true, next: undefined, nextIndex: i + 2 };
    }
    name = toks[i + 1];
    i += 2;
  }
  const next = toks[i];
  if (!next) return { specs, typeText, typeConst, ptr, name, qualified, isOperator: false, next, nextIndex: i };
  if (!['(', '=', ';', ',', '[', '{', ':', ')'].includes(next.t)) return null;
  return { specs, typeText, typeConst, ptr, name, qualified, isOperator: false, next, nextIndex: i };
}

// ───────────────────────── 1. структура и отступы ─────────────────────────

function classify(text: string, inParen: boolean, top: Brace | undefined): Kind {
  if (inParen) return 'lambda';
  const s = stripTemplatePrefix(text).trim();
  if (/\bnamespace\b/.test(s)) return 'namespace';
  if (/\bextern\s*"/.test(s)) return 'namespace';
  if (/\benum\b/.test(s)) return 'enum';
  if (/^(typedef\s+)?(class|struct|union)\b/.test(s) && !s.includes('(')) return 'class';
  if (/^\}?\s*(if|for|while|else|do|try|catch|switch)\b/.test(s) || /^(case\b|default\s*:)/.test(s)) {
    return /^switch\b/.test(s) ? 'switch' : 'block';
  }
  if (s === '') return 'block';
  if (/(=|\breturn|,|\(|\[|\{|\?)$/.test(s)) return 'init';
  const lastWord = s.match(/([A-Za-z_]\w*)$/);
  if (lastWord && !s.includes('(') &&
    !['else', 'do', 'try', 'const', 'override', 'final', 'noexcept', 'mutable'].includes(lastWord[1])) {
    return 'init';
  }
  if ((!top || top.kind === 'namespace' || top.kind === 'class') && s.includes('(')) return 'function';
  return 'block';
}

function structurePass(ctx: Ctx): void {
  const { src, cfg } = ctx;
  const ind = cfg.indentSize;
  const stack: Brace[] = [];
  let parenDepth = 0;
  let stmtOpen = false;
  let stmtBase = 0;
  let stmtText = '';
  let stmtLine = 0;

  const top = (): Brace | undefined => stack[stack.length - 1];
  const contentIndent = (b: Brace | undefined): number => {
    if (!b) return 0;
    if (b.kind === 'namespace') return b.base;
    return b.base + ind;
  };

  for (let i = 0; i < src.lines.length; i++) {
    const orig = src.lines[i];
    const code = src.code[i];
    const info: LineInfo = { stmtStart: false, continued: false, scope: top(), isAccess: false };
    ctx.info[i] = info;

    if (src.preproc[i]) {
      if (code.trimStart().startsWith('#') && !src.startsInside[i]) {
        const hash = code.indexOf('#');
        if (hash > 0 && (i === 0 || !src.preproc[i - 1] || !/\\\s*$/.test(src.lines[i - 1]))) {
          ctx.report('preprocessor-indent', i, 0, hash + 1,
            'Директива препроцессора должна начинаться с начала строки (`#` в колонке 1)',
            { title: 'Перенести `#` в начало строки', edits: [edit(i, 0, hash, '')] });
        }
      }
      continue;
    }

    const trimmed = code.trim();
    if (trimmed === '') continue;

    const lead = leading(orig);
    const actual = lead.length;
    const firstCol = firstNonSpace(code);
    const checkIndent = firstCol === actual && !lead.includes('\t') && !src.startsInside[i];
    let cur = top();

    info.continued = stmtOpen || parenDepth > 0;
    info.stmtStart = !stmtOpen && parenDepth === 0;
    info.isAccess = ACCESS_RE.test(trimmed);

    // Ожидаемый отступ.
    let expected: number;
    let strict = true;
    if (trimmed.startsWith('}') && cur) {
      expected = cur.base;
    } else if (stmtOpen && parenDepth === 0 && /^template\s*<.*>$/.test(stmtText.trim())) {
      expected = stmtBase; // строка после template <...> не сдвигается
    } else if (stmtOpen || parenDepth > 0) {
      strict = false;
      expected = stmtBase;
    } else if (cur && cur.kind === 'init') {
      strict = false;
      expected = cur.base;
    } else if (info.isAccess && cur && cur.kind === 'class') {
      expected = cur.base + cfg.accessModifierIndent;
    } else if (cur && cur.kind === 'switch') {
      expected = /^(case\b|default\s*:)/.test(trimmed) ? cur.base + ind : cur.base + 2 * ind;
    } else {
      expected = contentIndent(cur);
    }

    info.expected = expected;
    info.strict = strict;
    if (checkIndent && !trimmed.startsWith('{')) {
      if (strict && actual !== expected) {
        ctx.report('indentation', i, 0, Math.max(actual, 1),
          `Неверный отступ: ожидается ${expected} пробел(ов), сейчас ${actual} (размер уровня — ${ind})`,
          { title: `Сделать отступ ${expected} пробел(ов)`, edits: [edit(i, 0, actual, ' '.repeat(expected))] });
      } else if (!strict) {
        const closing = /^[)\]]/.test(trimmed);
        const bad = closing ? actual < expected : actual <= expected;
        if (bad) {
          const target = expected + cfg.continuationIndent;
          ctx.report('indentation', i, 0, Math.max(actual, 1),
            `Перенесённая строка должна быть сдвинута дальше начала инструкции (больше ${expected} пробел(ов)), сейчас ${actual}`,
            { title: `Сделать отступ ${target} пробел(ов)`, edits: [edit(i, 0, actual, ' '.repeat(target))] });
        }
      }
    }

    // Проход по символам строки.
    let lastPoppedBase = -1;
    for (let j = 0; j < code.length; j++) {
      const ch = code[j];
      if (ch === ' ' || ch === '\t') {
        stmtText += ' ';
        continue;
      }
      if (!stmtOpen && parenDepth === 0 && ch !== '}' && ch !== ';' && ch !== ',') {
        stmtOpen = true;
        stmtBase = j === firstCol ? expected : lastPoppedBase >= 0 ? lastPoppedBase : contentIndent(top());
        stmtText = '';
        stmtLine = i;
      }
      cur = top();
      if (/[A-Za-z_]/.test(ch) && !isIdentChar(code[j - 1])) {
        let k = j;
        while (isIdentChar(code[k])) k++;
        const word = code.slice(j, k);
        if (cur && cur.kind === 'enum' && cur.enumExpect && parenDepth === 0) {
          cur.enumExpect = false;
          if (!isConstant(word)) {
            const to = toConstant(word);
            ctx.report('naming-enumerator', i, j, k,
              `Значение enum «${word}» должно называться как константа: k + PascalCase${to ? ` (например, «${to}»)` : ''}`,
              undefined, to ? { from: word, to } : undefined);
          }
        }
        if (word === 'default' && cur && cur.kind === 'switch' && /^\s*:/.test(code.slice(k))) cur.hasDefault = true;
        stmtText += word;
        j = k - 1;
        continue;
      }
      stmtText += ch;
      switch (ch) {
        case '(':
        case '[':
          parenDepth++;
          break;
        case ')':
        case ']':
          parenDepth = Math.max(0, parenDepth - 1);
          break;
        case '{': {
          const before = stmtText.slice(0, -1);
          const kind = classify(before, parenDepth > 0, cur);
          const b: Brace = {
            kind, base: stmtBase, line: i, col: j,
            restore: kind === 'lambda' || kind === 'init' || kind === 'class' || kind === 'enum',
            savedParen: parenDepth, savedStmtOpen: stmtOpen, savedStmtBase: stmtBase,
            savedStmtText: before, savedStmtLine: stmtLine,
            enumExpect: kind === 'enum',
          };
          if (kind === 'namespace' && /\bextern\s*"/.test(before)) {
            b.keyword = 'extern';
          } else if (kind === 'namespace') {
            const m = before.match(/\bnamespace\s+([\w:]+)/);
            b.name = m ? m[1] : '';
          } else if (kind === 'class') {
            const m = stripTemplatePrefix(before).match(/\b(class|struct|union)\b\s*(?:alignas\s*\([^)]*\)\s*)?([A-Za-z_]\w*)?/);
            b.keyword = m?.[1];
            b.name = m?.[2];
          }
          stack.push(b);
          parenDepth = 0;
          stmtOpen = false;
          stmtText = '';
          break;
        }
        case '}': {
          const e = stack.pop();
          if (!e) break;
          if (info.closesKind === undefined && j === firstCol) info.closesKind = e.kind;
          onBraceClose(ctx, e, i, j);
          if (e.restore) {
            parenDepth = e.savedParen;
            stmtOpen = true;
            stmtBase = e.savedStmtBase;
            stmtText = e.savedStmtText + '{}';
            stmtLine = e.savedStmtLine;
          } else {
            parenDepth = 0;
            stmtOpen = false;
            stmtText = '';
          }
          lastPoppedBase = e.base;
          break;
        }
        case ';':
          if (parenDepth === 0) {
            stmtOpen = false;
            stmtText = '';
          }
          break;
        case ',':
          if (parenDepth === 0 && cur && (cur.kind === 'enum' || cur.kind === 'init')) {
            stmtOpen = false;
            stmtText = '';
            if (cur.kind === 'enum') cur.enumExpect = true;
          }
          break;
      }
    }

    // Метка (case X:, public:, label:) завершает «инструкцию».
    if (stmtOpen && parenDepth === 0 && /[^:]:\s*$/.test(' ' + trimmed) && !/\)\s*:\s*$/.test(trimmed) &&
      !stmtText.includes('?') && !/^\s*(class|struct)\b/.test(stmtText)) {
      stmtOpen = false;
      stmtText = '';
    }
    if (trimmed.endsWith('{') && top() && top()!.line === i) info.opensKind = top()!.kind;
  }
}

function onBraceClose(ctx: Ctx, e: Brace, line: number, col: number): void {
  const { src, cfg } = ctx;
  if (e.kind === 'namespace' && line > e.line && e.name !== undefined) {
    const rest = src.lines[line].slice(col + 1);
    const restCode = src.code[line].slice(col + 1).trim();
    const label = e.name ? `namespace ${e.name}` : 'namespace';
    if (!/\/\/\s*namespace\b/.test(rest) && !/\/\*\s*namespace/.test(rest)) {
      const canFix = restCode === '' && src.lineComment[line] === -1;
      ctx.report('namespace-end-comment', line, col, col + 1,
        `Закрывающая скобка namespace должна иметь комментарий «// ${label}»`,
        canFix ? { title: `Добавить «// ${label}»`, edits: [edit(line, col + 1, src.lines[line].length, `  // ${label}`)] } : undefined);
    }
  }
  if (e.kind === 'function') {
    let count = 0;
    for (let k = e.line + 1; k < line; k++) if (src.code[k].trim() !== '') count++;
    if (count > cfg.maxFunctionLines) {
      const startLine = e.savedStmtLine;
      const c = firstNonSpace(src.lines[startLine]);
      ctx.report('function-length', startLine, Math.max(c, 0), src.lines[startLine].length,
        `Функция занимает ${count} строк кода — Google рекомендует не больше ${cfg.maxFunctionLines}. Попробуйте разбить её на части`);
    }
  }
  if (e.kind === 'switch' && !e.hasDefault) {
    const sl = e.savedStmtLine;
    const c = src.code[sl].search(/\bswitch\b/);
    ctx.report('switch-default', sl, Math.max(c, 0), Math.max(c, 0) + 6,
      'В switch нет ветки `default` (не нужна, только если switch по enum и перечислены все значения)');
  }
}

// ───────────────────────── 2. правила одной строки ─────────────────────────

const CHECKED_OPS = new Set(['=', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '<<=', '>>=', '&&', '||']);
const ALL_OPS = ['<<=', '>>=', '<=>', '...', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=',
  '^=', '&&', '||', '->', '::', '<<', '>>', '++', '--'];

const ARITH_TYPE =
  /^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:long\s+long|long\s+double|long|short|int|char|float|double|bool|size_t|std::size_t|u?int(?:8|16|32|64)_t|wchar_t|char16_t|char32_t|unsigned|signed)(?:\s+int)?$/;
const PTR_TYPE = /^(?:const\s+)?(?:(?:unsigned|signed)\s+)?(?:[A-Za-z_][\w:]*(?:<[^()]*>)?|long\s+long)\s*(?:\*\s*(?:const\s*)?)+$/;

const PTR_DECL_RE = new RegExp(
  '(\\b(?:void|bool|char|char8_t|char16_t|char32_t|wchar_t|short|int|long|float|double|signed|unsigned|auto|' +
  'size_t|[A-Za-z_]\\w*_t|[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*|[A-Z]|std::[A-Za-z_]\\w*)\\b|[^\\s>\\-<]>)' +
  '( *)(\\*+|&&|&)( *)(?=[A-Za-z_])', 'g');

function lineRules(ctx: Ctx, i: number): void {
  const { src, cfg } = ctx;
  const o = src.lines[i];
  const c = src.code[i];

  // Табуляция.
  if (c.includes('\t')) {
    const edits: TextEdit[] = [];
    const lead = leading(o);
    if (lead.includes('\t')) {
      edits.push(edit(i, 0, lead.length, lead.replace(/\t/g, ' '.repeat(cfg.indentSize))));
    }
    for (let j = lead.length; j < c.length; j++) if (c[j] === '\t') edits.push(edit(i, j, j + 1, ' '));
    const first = c.indexOf('\t');
    ctx.report('tab', i, first, first + 1, 'Символ табуляции — в Google Style используются только пробелы',
      { title: 'Заменить табуляцию пробелами', edits });
  }

  // Пробелы в конце строки.
  const tw = o.match(/[ \t]+$/);
  if (tw) {
    const start = o.length - tw![0].length;
    ctx.report('trailing-whitespace', i, start, o.length, 'Лишние пробелы в конце строки',
      { title: 'Удалить пробелы в конце строки', edits: [edit(i, start, o.length, '')] });
  }

  // Длина строки.
  const len = [...o].length;
  if (len > cfg.lineLength) {
    const exempt = /^\s*#\s*include\b/.test(o) ||
      (ctx.guardName && o.includes(ctx.guardName) && src.preproc[i]) ||
      /^\s*using\s+[\w:]+\s*;/.test(o) || /https?:\/\/\S{10,}/.test(o);
    if (!exempt) {
      ctx.report('line-length', i, cfg.lineLength, o.length,
        `Строка длиной ${len} символов — максимум ${cfg.lineLength}`);
    }
  }

  // Комментарии.
  const lc = src.lineComment[i];
  if (lc >= 0 && o.slice(lc, lc + 2) === '//') {
    const after = o[lc + 2];
    const body = o.slice(lc + 2);
    if (after !== undefined && !/[\s/!<]/.test(after) && !/^[-=*#~_+]+\s*$/.test(body)) {
      ctx.report('comment-spacing', i, lc, lc + 2, 'После `//` нужен пробел',
        { title: 'Добавить пробел после //', edits: [insert(i, lc + 2, ' ')] });
    }
    const before = c.slice(0, lc);
    if (before.trim() !== '') {
      const spaces = before.length - before.trimEnd().length;
      if (spaces < 2) {
        ctx.report('comment-spacing', i, lc - spaces, lc + 2,
          'Перед комментарием в конце строки нужно минимум два пробела',
          { title: 'Поставить два пробела перед комментарием', edits: [edit(i, lc - spaces, lc, '  ')] });
      }
    }
    const todo = body.match(/\b(TODO|todo|Todo|FIXME|fixme)\b(\s*\(([^)]*)\))?/);
    if (todo && (todo[1] !== 'TODO' || !todo[2] || !todo[3].trim())) {
      const at = lc + 2 + (todo.index ?? 0);
      ctx.report('todo-format', i, at, at + todo[0].length,
        'TODO оформляется как `// TODO(автор или задача): описание`');
    }
  }

  if (src.preproc[i]) {
    preprocLineRules(ctx, i);
    return;
  }
  if (c.trim() === '') return;

  const trimmed = c.trim();
  const firstCol = firstNonSpace(c);

  // Пробел после ключевого слова.
  for (const m of c.matchAll(/\b(if|for|while|switch|catch)\(/g)) {
    const at = m.index! + m[1].length;
    ctx.report('space-after-keyword', i, m.index!, at + 1, `После \`${m[1]}\` нужен пробел перед \`(\``,
      { title: `Добавить пробел после ${m[1]}`, edits: [insert(i, at, ' ')] });
  }

  // Пробел перед {.
  const braceRes = [/\)\{/g, /\b(else|do|try|const|override|final|noexcept|mutable)\{/g];
  for (const re of braceRes) {
    for (const m of c.matchAll(re)) {
      const at = m.index! + m[0].length - 1;
      ctx.report('space-before-brace', i, at - 1, at + 1, 'Перед `{` нужен пробел',
        { title: 'Добавить пробел перед {', edits: [insert(i, at, ' ')] });
    }
  }
  const typeBrace = c.match(/^\s*(?:template\s*<.*>\s*)?(?:class|struct|union|enum(?:\s+class)?|namespace)\b[^;(){}=]*[^\s{]\{/);
  if (typeBrace) {
    const at = typeBrace[0].length - 1;
    ctx.report('space-before-brace', i, at - 1, at + 1, 'Перед `{` нужен пробел',
      { title: 'Добавить пробел перед {', edits: [insert(i, at, ' ')] });
  }

  // Пробелы внутри скобок.
  for (const m of c.matchAll(/\(( +)(?=[^\s)])/g)) {
    const s = m.index! + 1;
    ctx.report('paren-spacing', i, m.index!, s + m[1].length, 'Лишний пробел после `(`',
      { title: 'Удалить пробел после (', edits: [edit(i, s, s + m[1].length, '')] });
  }
  for (const m of c.matchAll(/([^\s(;])( +)\)/g)) {
    const s = m.index! + 1;
    ctx.report('paren-spacing', i, s, s + m[2].length + 1, 'Лишний пробел перед `)`',
      { title: 'Удалить пробел перед )', edits: [edit(i, s, s + m[2].length, '')] });
  }

  // Пробел между именем функции и (.
  for (const m of c.matchAll(/\b([A-Za-z_]\w*)( +)\(/g)) {
    const name = m[1];
    if (CPP_KEYWORDS.has(name) || TYPE_WORDS.has(name)) continue;
    const before = c.slice(0, m.index!);
    if (/\boperator\s*\S*$/.test(before)) continue;
    const s = m.index! + name.length;
    ctx.report('function-call-space', i, m.index!, s + m[2].length + 1,
      `Между «${name}» и \`(\` не должно быть пробела`,
      { title: 'Удалить пробел перед (', edits: [edit(i, s, s + m[2].length, '')] });
  }

  operatorSpacing(ctx, i, c, firstCol);

  // Запятые.
  for (const m of c.matchAll(/,(?=[^\s,)])/g)) {
    ctx.report('comma-spacing', i, m.index!, m.index! + 1, 'После запятой нужен пробел',
      { title: 'Добавить пробел после запятой', edits: [insert(i, m.index! + 1, ' ')] });
  }
  for (const m of c.matchAll(/([^\s,(])( +),/g)) {
    const s = m.index! + 1;
    ctx.report('comma-spacing', i, s, s + m[2].length + 1, 'Перед запятой не нужен пробел',
      { title: 'Удалить пробел перед запятой', edits: [edit(i, s, s + m[2].length, '')] });
  }

  // Точка с запятой.
  for (const m of c.matchAll(/;(?=[^\s;)])/g)) {
    ctx.report('semicolon-spacing', i, m.index!, m.index! + 1, 'После `;` нужен пробел',
      { title: 'Добавить пробел после ;', edits: [insert(i, m.index! + 1, ' ')] });
  }
  for (const m of c.matchAll(/([^\s;(])( +);/g)) {
    const s = m.index! + 1;
    ctx.report('semicolon-spacing', i, s, s + m[2].length + 1, 'Перед `;` не нужен пробел',
      { title: 'Удалить пробел перед ;', edits: [edit(i, s, s + m[2].length, '')] });
  }

  // for: range-for и префиксный инкремент.
  for (const m of c.matchAll(/\bfor\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchParen(c, open);
    if (close < 0) continue;
    const inner = c.slice(open + 1, close);
    if (!inner.includes(';')) {
      let depth = 0;
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k];
        if ('([{<'.includes(ch)) depth++;
        else if (')]}>'.includes(ch)) depth--;
        else if (ch === ':' && depth === 0 && inner[k + 1] !== ':' && inner[k - 1] !== ':') {
          if (inner[k - 1] !== ' ' || inner[k + 1] !== ' ') {
            let a = k;
            while (inner[a - 1] === ' ') a--;
            let b = k + 1;
            while (inner[b] === ' ') b++;
            ctx.report('range-for-colon', i, open + 1 + k, open + 2 + k, 'В range-based for вокруг `:` нужны пробелы',
              { title: 'Поставить пробелы вокруг :', edits: [edit(i, open + 1 + a, open + 1 + b, ' : ')] });
          }
          break;
        }
      }
    } else {
      const parts = inner.split(';');
      if (parts.length === 3) {
        const third = parts[2];
        const tm = third.match(/^(\s*)([A-Za-z_][\w.]*(?:->\w+)*)(\+\+|--)(\s*)$/);
        if (tm) {
          const s = open + 1 + parts[0].length + 1 + parts[1].length + 1 + tm[1].length;
          const e = s + tm[2].length + 2;
          ctx.report('preincrement', i, s, e, `Используйте префиксную форму: \`${tm[3]}${tm[2]}\``,
            { title: `Заменить на ${tm[3]}${tm[2]}`, edits: [edit(i, s, e, tm[3] + tm[2])] });
        }
      }
    }
  }
  const inc = trimmed.match(/^([A-Za-z_][\w.]*(?:->\w+)*)(\+\+|--);$/);
  if (inc) {
    const e = firstCol + inc[1].length + 2;
    ctx.report('preincrement', i, firstCol, e, `Используйте префиксную форму: \`${inc[2]}${inc[1]}\``,
      { title: `Заменить на ${inc[2]}${inc[1]}`, edits: [edit(i, firstCol, e, inc[2] + inc[1])] });
  }

  // template<
  for (const m of c.matchAll(/\btemplate</g)) {
    ctx.report('template-space', i, m.index!, m.index! + 9, 'Между `template` и `<` нужен пробел',
      { title: 'Добавить пробел', edits: [insert(i, m.index! + 8, ' ')] });
  }

  // Положение * и &.
  for (const m of c.matchAll(PTR_DECL_RE)) {
    const [, type, sb, ops, sa] = m;
    if (/^[A-Z][A-Z0-9_]+$/.test(type)) continue; // МАКРОС
    const nameStart = m.index! + m[0].length;
    const nameMatch = c.slice(nameStart).match(/^[A-Za-z_]\w*/);
    if (!nameMatch) continue;
    if (CPP_KEYWORDS.has(nameMatch[0]) && nameMatch[0] !== 'const') continue;
    const before = c.slice(0, m.index!);
    if (/\b(return|case|throw|co_return|and|or|not)\s*$/.test(before + (type.length === 1 ? '' : ''))) continue;
    if (sb.length === 0 && sa.length === 1) continue; // int* x — правильно
    if (ops === '&&' && sb.length > 0 && sa.length > 0) continue; // логическое И
    const typeEnd = m.index! + type.length;
    ctx.report('pointer-alignment', i, typeEnd, nameStart,
      `\`${ops}\` прижимается к типу и отделяется пробелом от имени: \`${type.trim()}${ops} ${nameMatch[0]}\``,
      { title: `Переписать как ${type.trim()}${ops} ${nameMatch[0]}`, edits: [edit(i, typeEnd, nameStart, ops + ' ')] });
  }

  // Запрещённые конструкции.
  const un = c.match(/\busing\s+namespace\b/);
  if (un) {
    ctx.report('using-namespace', i, un.index!, c.indexOf(';', un.index!) > 0 ? c.indexOf(';', un.index!) + 1 : c.length,
      'using namespace запрещён — пишите `std::` явно или `using std::имя;`');
  }
  const nstd = c.match(/^\s*namespace\s+std\s*\{/);
  if (nstd) ctx.report('namespace-std', i, firstCol, firstCol + nstd[0].trim().length, 'Нельзя ничего объявлять в namespace std');
  for (const m of c.matchAll(/\bNULL\b/g)) {
    ctx.report('nullptr', i, m.index!, m.index! + 4, 'Используйте `nullptr` вместо `NULL`',
      { title: 'Заменить на nullptr', edits: [edit(i, m.index!, m.index! + 4, 'nullptr')] });
  }
  for (const m of c.matchAll(/\b(?:(unsigned|signed)\s+)?(long\s+long|long|short)(?:\s+int)?\b(?!\s+double)/g)) {
    if (/\blong\s*$/.test(c.slice(0, m.index!))) continue;
    const unsigned = m[1] === 'unsigned';
    const isShort = m[2] === 'short';
    const to = `${unsigned ? 'u' : ''}int${isShort ? 16 : 64}_t`;
    ctx.report('integer-types', i, m.index!, m.index! + m[0].length,
      `Вместо \`${m[0]}\` используйте \`${to}\` из <cstdint> (из встроенных целых типов Google разрешает только int)`,
      { title: `Заменить на ${to}`, edits: [edit(i, m.index!, m.index! + m[0].length, to), ...ensureInclude(ctx, 'cstdint')] });
  }
  cStyleCasts(ctx, i, c, o);
  const vo = c.match(/\bvirtual\b/);
  if (vo && /\b(override|final)\b/.test(c)) {
    const end = vo.index! + 7 + (c.slice(vo.index! + 7).match(/^ */)![0].length);
    ctx.report('virtual-override', i, vo.index!, vo.index! + 7, 'При `override`/`final` не пишите `virtual`',
      { title: 'Удалить virtual', edits: [edit(i, vo.index!, end, '')] });
  }
  const rp = c.match(/\breturn\s*\(/);
  if (rp) {
    const open = rp.index! + rp[0].length - 1;
    const close = matchParen(c, open);
    if (close > 0 && c.slice(close + 1).trim() === ';' && splitTopLevel(c.slice(open + 1, close)).length === 1) {
      const inner = o.slice(open + 1, close).trim();
      ctx.report('return-parens', i, rp.index!, close + 1, 'Лишние скобки вокруг выражения в return',
        { title: 'Убрать скобки', edits: [edit(i, rp.index! + 6, close + 1, ' ' + inner)] });
    }
  }
  const ex = c.match(/\b(throw|try)\b/);
  if (ex) ctx.report('exceptions', i, ex.index!, ex.index! + ex[1].length, `\`${ex[1]}\`: в Google Style исключения C++ не используются`);
  const rt = c.match(/\b(dynamic_cast|typeid)\b/);
  if (rt) ctx.report('rtti', i, rt.index!, rt.index! + rt[1].length, `\`${rt[1]}\` (RTTI) не рекомендуется — используйте виртуальные функции`);

  // Несколько инструкций на строке.
  let s = c;
  for (const m of c.matchAll(/\bfor\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchParen(c, open);
    if (close > 0) s = s.slice(0, open + 1) + ' '.repeat(close - open - 1) + s.slice(close);
  }
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ';' && depth <= 0) {
      const rest = s.slice(k + 1).trim();
      if (rest !== '' && !rest.startsWith('}')) {
        ctx.report('one-statement-per-line', i, k + 1 + (s.slice(k + 1).length - s.slice(k + 1).trimStart().length), s.length,
          'Несколько инструкций в одной строке — перенесите каждую на свою строку');
        break;
      }
    }
  }

  // Скобки и else.
  bracesRules(ctx, i, c, trimmed, firstCol);
}

function operatorSpacing(ctx: Ctx, i: number, c: string, firstCol: number): void {
  ternarySpacing(ctx, i, c);
  for (let j = 0; j < c.length; j++) {
    const ch = c[j];
    if (!'=!<>+-*/%&|^:.'.includes(ch)) continue;
    let op = ALL_OPS.find((x) => c.startsWith(x, j));
    if (!op) op = ch;
    const start = j;
    j += op.length - 1;
    if (!CHECKED_OPS.has(op)) {
      if (op.length === 1 && '+-<>'.includes(op)) binaryOp(ctx, i, c, start, op);
      continue;
    }
    const before = c.slice(0, start);
    if (/\boperator\s*$/.test(before)) continue;
    const after = c.slice(start + op.length);
    const prevNS = before.trimEnd().slice(-1);
    const nextNS = after.trimStart()[0];
    if (op === '=' && (prevNS === '[' || nextNS === ']' || (prevNS === ',' && /\[[^\]]*$/.test(before)))) continue;
    if (op === '=' && /\[\s*&\s*,?\s*$/.test(before)) continue;
    const leftSpace = before.length === 0 || /\s$/.test(before);
    const rightSpace = after.length === 0 || /^\s/.test(after);
    const atLineStart = before.trim() === '';
    const atLineEnd = after.trim() === '';
    if (op === '&&') {
      // T&& x — rvalue-ссылка, это не оператор.
      if (!leftSpace && rightSpace) continue;
      if (leftSpace && !rightSpace && !/[\w)\]]\s*$/.test(before)) continue;
      if (leftSpace && !rightSpace && /\b([A-Z]\w*|int|char|auto|bool|double|float|void|const)\s*$/.test(before)) continue;
    }
    if (op === '>=' && /<[^<>]*$/.test(before) && /^[^=]/.test(after)) continue; // vector<int>=...
    const missLeft = !leftSpace && !atLineStart;
    const missRight = !rightSpace && !atLineEnd;
    if (!missLeft && !missRight) continue;
    let a = start;
    while (a > 0 && c[a - 1] === ' ') a--;
    let b = start + op.length;
    while (b < c.length && c[b] === ' ') b++;
    const text = (atLineStart ? c.slice(a, start) : ' ') + op + (atLineEnd ? '' : ' ');
    ctx.report('operator-spacing', i, start, start + op.length, `Оператор \`${op}\` нужно окружить пробелами`,
      { title: `Поставить пробелы вокруг ${op}`, edits: [edit(i, atLineStart ? start : a, atLineEnd ? start + op.length : b, atLineStart ? op + ' ' : text)] });
  }
  void firstCol;
}

/** a ? b : c — пробелы вокруг ? и :. */
function ternarySpacing(ctx: Ctx, i: number, c: string): void {
  for (let q = c.indexOf('?'); q >= 0; q = c.indexOf('?', q + 1)) {
    if (c[q - 1] === '?' || c[q + 1] === '?') continue;
    // Парное двоеточие на той же глубине скобок.
    let depth = 0;
    let colon = -1;
    let nested = 0;
    for (let k = q + 1; k < c.length; k++) {
      const ch = c[k];
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) {
        if (--depth < 0) break;
      } else if (depth === 0 && ch === '?') nested++;
      else if (depth === 0 && ch === ';') break;
      else if (depth === 0 && ch === ':' && c[k + 1] !== ':' && c[k - 1] !== ':') {
        if (nested === 0) {
          colon = k;
          break;
        }
        nested--;
      }
    }
    for (const pos of colon >= 0 ? [q, colon] : [q]) {
      const op = c[pos];
      const leftOk = /\s/.test(c[pos - 1] ?? ' ') || c.slice(0, pos).trim() === '';
      const rightOk = /\s/.test(c[pos + 1] ?? ' ') || c.slice(pos + 1).trim() === '';
      if (leftOk && rightOk) continue;
      let a = pos;
      while (a > 0 && c[a - 1] === ' ') a--;
      let b = pos + 1;
      while (b < c.length && c[b] === ' ') b++;
      const atStart = c.slice(0, pos).trim() === '';
      const atEnd = c.slice(pos + 1).trim() === '';
      ctx.report('operator-spacing', i, pos, pos + 1, `В тернарном операторе \`?:\` вокруг \`${op}\` нужны пробелы`,
        { title: `Поставить пробелы вокруг ${op}`, edits: [edit(i, atStart ? pos : a, atEnd ? pos + 1 : b, (atStart ? '' : ' ') + op + (atEnd ? '' : ' '))] });
    }
  }
}

/** + - < > : проверяем только там, где это точно бинарный оператор. */
function binaryOp(ctx: Ctx, i: number, c: string, start: number, op: string): void {
  const before = c.slice(0, start);
  const after = c.slice(start + 1);
  if (/\boperator\s*$/.test(before)) return;
  const prevTrim = before.trimEnd();
  const prevCh = prevTrim.slice(-1);
  const nextCh = after.trimStart()[0];
  if (!prevCh || !nextCh) return;
  if (!/[\w)\]]/.test(prevCh)) return; // унарный минус/плюс, *p, &x и т.п.
  const prevWord = prevTrim.match(/([A-Za-z_]\w*)$/);
  if (prevWord && CPP_KEYWORDS.has(prevWord[1]) && !['this', 'true', 'false', 'nullptr'].includes(prevWord[1])) return;
  if ((op === '+' || op === '-') && /\d[eE]$/.test(prevTrim) && /^[0-9]/.test(after)) return; // 1e-5
  if ((op === '+' || op === '-') && /^[+\-=]/.test(after)) return;
  if (op === '<' || op === '>') {
    if (/^[<>=]/.test(after) || /[<>\-]$/.test(before)) return;
    // Похоже на шаблон? Тогда не трогаем.
    if (op === '<') {
      let depth = 0;
      for (let k = start; k < c.length; k++) {
        if (c[k] === '(') depth++;
        else if (c[k] === ')') {
          if (--depth < 0) break;
        } else if (c[k] === ';' || c[k] === '{') break;
        else if (c[k] === '>' && depth === 0 && c[k + 1] !== '=' && c[k - 1] !== '-') return;
      }
      if (!/^\s*[\w(\-!]/.test(after)) return;
    } else {
      let depth = 0;
      for (let k = start - 1; k >= 0; k--) {
        if (c[k] === ')') depth++;
        else if (c[k] === '(') {
          if (--depth < 0) break;
        } else if (c[k] === ';' || c[k] === '{') break;
        else if (c[k] === '<' && depth === 0 && c[k - 1] !== '<' && c[k + 1] !== '<' && c[k + 1] !== '=') return;
      }
      if (/^\s*[(;,)]/.test(after) || /^\s*$/.test(after)) return;
    }
  }
  const leftSpace = /\s$/.test(before);
  const rightSpace = /^\s/.test(after);
  if (leftSpace && rightSpace) return;
  let a = start;
  while (a > 0 && c[a - 1] === ' ') a--;
  let b = start + 1;
  while (b < c.length && c[b] === ' ') b++;
  ctx.report('operator-spacing', i, start, start + 1, `Бинарный оператор \`${op}\` нужно окружить пробелами`,
    { title: `Поставить пробелы вокруг ${op}`, edits: [edit(i, a, b, ` ${op} `)] });
}

function cStyleCasts(ctx: Ctx, i: number, c: string, o: string): void {
  for (let j = 0; j < c.length; j++) {
    if (c[j] !== '(') continue;
    const close = matchParen(c, j);
    if (close < 0) continue;
    const inner = c.slice(j + 1, close).trim().replace(/\s+/g, ' ');
    const isArith = ARITH_TYPE.test(inner);
    const isPtr = !isArith && (PTR_TYPE.test(inner) || /^void\s*\*+$/.test(inner));
    if (!isArith && !isPtr) continue;
    // До скобки не должно быть имени функции/типа (иначе это вызов или объявление).
    const before = c.slice(0, j).trimEnd();
    const prevWord = before.match(/([A-Za-z_]\w*)$/);
    if (prevWord && !['return', 'case', 'throw', 'co_return', 'and', 'or', 'not'].includes(prevWord[1])) continue;
    if (/[)\]>]$/.test(before)) continue;
    const afterIdx = close + 1 + (c.slice(close + 1).length - c.slice(close + 1).trimStart().length);
    const nextCh = c[afterIdx];
    if (!nextCh || !/[\w("'\-!~*&.]/.test(nextCh)) continue;
    if ((nextCh === '-' || nextCh === '*' || nextCh === '&') && /^\s/.test(c.slice(afterIdx + 1))) continue; // (x) - y
    const typeOrig = o.slice(j + 1, close).trim().replace(/\s+/g, ' ');
    let fix: Fix | undefined;
    if (isArith) {
      let opEnd = -1;
      let operand = '';
      if (nextCh === '(') {
        const e = matchParen(c, afterIdx);
        if (e > 0) {
          opEnd = e + 1;
          operand = o.slice(afterIdx + 1, e);
        }
      } else {
        const m = c.slice(afterIdx).match(/^[-!~]?[A-Za-z_0-9][\w.]*(?:->\w+|\.\w+|\[[^\][]*\]|::\w+)*/);
        if (m) {
          opEnd = afterIdx + m[0].length;
          operand = o.slice(afterIdx, opEnd);
        }
      }
      const tail = c.slice(opEnd).trimStart();
      if (opEnd > 0 && !/^(\(|\[|\.|->|\+\+|--)/.test(tail)) {
        fix = { title: `Заменить на static_cast<${typeOrig}>(...)`, edits: [edit(i, j, opEnd, `static_cast<${typeOrig}>(${operand})`)] };
      }
    }
    ctx.report('c-style-cast', i, j, close + 1,
      isArith ? `C-style приведение \`(${typeOrig})\` — используйте \`static_cast<${typeOrig}>(...)\``
        : `C-style приведение \`(${typeOrig})\` — используйте \`static_cast\`/\`reinterpret_cast\`/\`const_cast\``,
      fix);
    j = close;
  }
}

function prevCodeLine(ctx: Ctx, i: number): number {
  for (let k = i - 1; k >= 0; k--) {
    if (ctx.src.preproc[k]) continue;
    if (ctx.src.code[k].trim() !== '') return k;
  }
  return -1;
}

function nextCodeLine(ctx: Ctx, i: number): number {
  for (let k = i + 1; k < ctx.src.lines.length; k++) {
    if (ctx.src.preproc[k]) continue;
    if (ctx.src.code[k].trim() !== '') return k;
  }
  return -1;
}

function bracesRules(ctx: Ctx, i: number, c: string, trimmed: string, firstCol: number): void {
  const { src } = ctx;
  const info = ctx.info[i];
  const prev = prevCodeLine(ctx, i);
  const prevTrim = prev >= 0 ? src.code[prev].trim() : '';
  const canJoin = prev >= 0 && src.lineComment[prev] === -1 && !/\\\s*$/.test(src.lines[prev]);

  if (trimmed.startsWith('{') && info?.continued && prev >= 0 && !/[,(]$/.test(prevTrim) &&
    info.scope?.kind !== 'init') {
    const prevEnd = src.lines[prev].trimEnd().length;
    ctx.report('brace-same-line', i, firstCol, firstCol + 1, 'Открывающая `{` должна стоять в конце предыдущей строки',
      canJoin ? { title: 'Перенести { на предыдущую строку', edits: [edit(prev, prevEnd, firstCol + 1, ' {', i)] } : undefined);
  }

  const ec = trimmed.match(/^(else|catch)\b/);
  if (ec && prevTrim.endsWith('}')) {
    const prevEnd = src.lines[prev].trimEnd().length;
    ctx.report('else-same-line', i, firstCol, firstCol + ec[1].length, `\`${ec[1]}\` должен стоять на одной строке с \`}\``,
      canJoin ? { title: `Перенести ${ec[1]} к }`, edits: [edit(prev, prevEnd, firstCol, ' ', i)] } : undefined);
  }

  for (const m of c.matchAll(/\belse\b/g)) {
    const after = c.slice(m.index! + 4).trim();
    let bad = false;
    if (after === '') {
      const nx = nextCodeLine(ctx, i);
      bad = nx < 0 || !src.code[nx].trim().startsWith('{');
    } else if (!after.startsWith('{') && !/^if\b/.test(after)) {
      bad = true;
    }
    if (bad) {
      ctx.report('braces-if-else', i, m.index!, m.index! + 4, 'В конструкции if-else фигурные скобки обязательны во всех ветках');
    }
  }
  if (/^else\b/.test(trimmed) && prev >= 0 && !prevTrim.endsWith('}')) {
    ctx.report('braces-if-else', i, firstCol, firstCol + 4, 'Ветка перед `else` без фигурных скобок — в if-else скобки обязательны везде');
  }

  const loop = trimmed.match(/^(while|for)\s*\(/);
  if (loop) {
    const open = c.indexOf('(', firstCol);
    const close = matchParen(c, open);
    if (close > 0 && c.slice(close + 1).trim() === ';') {
      const semi = c.indexOf(';', close);
      ctx.report('empty-loop-body', i, semi, semi + 1, 'Пустое тело цикла пишется как `{}`, а не `;`',
        { title: 'Заменить ; на {}', edits: [edit(i, close + 1, semi + 1, ' {}')] });
    }
  }
}

function preprocLineRules(ctx: Ctx, i: number): void {
  const c = ctx.src.code[i];
  const inc = c.match(/^\s*#\s*include\s*<bits\/stdc\+\+\.h>/);
  if (inc) ctx.report('include-bits', i, 0, inc[0].length, '`<bits/stdc++.h>` — нестандартный заголовок, подключайте только нужные (<iostream>, <vector>...)');
  const def = c.match(/^\s*#\s*define\s+([A-Za-z_]\w*)(\(?)(.*)$/);
  if (def && def[1] !== ctx.guardName) {
    const name = def[1];
    const col = c.indexOf(name, c.indexOf('define') + 6);
    if (!isMacro(name)) {
      const to = toMacro(name);
      ctx.report('naming-macro', i, col, col + name.length,
        `Макрос «${name}» должен называться ЗАГЛАВНЫМИ_БУКВАМИ${to ? ` (например, «${to}»)` : ''}`,
        undefined, to ? { from: name, to } : undefined);
    }
    const value = ctx.src.lines[i].slice(col + name.length).trim();
    if (!def[2] && /^(-?[\d.]+[a-zA-Z]*|"[^"]*"|'.')(\s*\/\/.*)?$/.test(value)) {
      const k = toConstant(name);
      ctx.report('macro-constant', i, col, col + name.length,
        `Вместо макроса-константы используйте \`constexpr\`${k ? `: \`constexpr ... ${k} = ${value.replace(/\s*\/\/.*$/, '')};\`` : ''}`);
    }
  }
}

// ───────────────────────── 3. объявления и имена ─────────────────────────

function declarationRules(ctx: Ctx, i: number): void {
  const { src } = ctx;
  const info = ctx.info[i];
  if (!info || src.preproc[i]) return;
  const c = src.code[i];
  const trimmed = c.trim();
  if (trimmed === '' || trimmed.startsWith('}')) return;

  let start = info.stmtStart;
  if (!start && info.continued) {
    const p = prevCodeLine(ctx, i);
    if (p >= 0 && ctx.info[p]?.stmtStart && /^\s*template\s*<.*>\s*$/.test(src.code[p])) start = true;
  }

  // Переменные в заголовке for.
  for (const m of c.matchAll(/\bfor\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = matchParen(c, open);
    const inner = c.slice(open + 1, close > 0 ? close : c.length);
    const stop = inner.search(/;|[^:]:[^:]/);
    const head = stop >= 0 ? inner.slice(0, stop + (inner[stop] === ';' ? 0 : 1)) + (inner[stop] === ';' ? ';' : ':') : inner;
    const d = parseDecl(tokenize(head, open + 1));
    if (d && !d.isOperator) checkVariable(ctx, i, d, { kind: 'block' } as Brace, tokenize(head, open + 1));
  }

  if (!start) return;
  const scope = info.scope;
  if (scope && (scope.kind === 'enum' || scope.kind === 'init')) return;

  let body = c;
  let offset = 0;
  // template <...>
  const tm = c.match(/^\s*template\s*</);
  if (tm) {
    const lt = c.indexOf('<', tm.index!);
    let depth = 0;
    let gt = -1;
    for (let k = lt; k < c.length; k++) {
      if (c[k] === '<') depth++;
      else if (c[k] === '>') {
        depth--;
        if (depth === 0) {
          gt = k;
          break;
        }
      }
    }
    const params = c.slice(lt + 1, gt > 0 ? gt : c.length);
    for (const p of params.matchAll(/\b(?:typename|class)\s+(?:\.\.\.\s*)?([A-Za-z_]\w*)/g)) {
      const name = p[1];
      if (!isPascal(name)) {
        const col = lt + 1 + p.index! + p[0].length - name.length;
        const to = toPascal(name);
        ctx.report('naming-template-param', i, col, col + name.length,
          `Параметр шаблона «${name}» — это тип, его имя пишется в PascalCase${to ? ` (например, «${to}»)` : ''}`,
          undefined, to ? { from: name, to } : undefined);
      }
    }
    if (gt < 0) return;
    offset = gt + 1;
    body = ' '.repeat(offset) + c.slice(offset);
    if (body.trim() === '') return;
  }

  // namespace
  const ns = body.match(/^\s*(?:inline\s+)?namespace\s+([A-Za-z_][\w:]*)/);
  if (ns) {
    let col = body.indexOf(ns[1], body.indexOf('namespace') + 9);
    for (const part of ns[1].split('::')) {
      if (part && part !== 'std' && !isSnake(part)) {
        const to = toSnake(part);
        ctx.report('naming-namespace', i, col, col + part.length,
          `Имя namespace «${part}» должно быть в snake_case${to ? ` (например, «${to}»)` : ''}`,
          undefined, to ? { from: part, to } : undefined);
      }
      col += part.length + 2;
    }
    return;
  }

  // class / struct / union / enum
  const ty = body.match(/^\s*(?:typedef\s+)?(class|struct|union|enum(?:\s+class|\s+struct)?)\s+(?:alignas\s*\([^)]*\)\s*)?(?:\[\[[^\]]*\]\]\s*)?([A-Za-z_]\w*)/);
  if (ty) {
    const name = ty[2];
    if (name !== 'final' && !isPascal(name)) {
      const col = ty.index! + ty[0].length - name.length;
      const to = toPascal(name);
      ctx.report('naming-type', i, col, col + name.length,
        `Имя типа «${name}» должно быть в PascalCase${to ? ` (например, «${to}»)` : ''}`,
        undefined, to ? { from: name, to } : undefined);
    }
    return;
  }

  // typedef / using
  if (/^\s*typedef\b/.test(body)) {
    const fp = body.match(/\(\s*\*\s*([A-Za-z_]\w*)\s*\)/);
    const plain = body.match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;\s*$/);
    const m = fp ?? plain;
    if (m) {
      const name = m[1];
      const col = body.lastIndexOf(name, m.index! + m[0].length);
      if (!isPascal(name)) {
        const to = toPascal(name);
        ctx.report('naming-type', i, col, col + name.length,
          `Имя типа «${name}» должно быть в PascalCase${to ? ` (например, «${to}»)` : ''}`,
          undefined, to ? { from: name, to } : undefined);
      }
    }
    return;
  }
  const us = body.match(/^\s*using\s+([A-Za-z_]\w*)\s*=/);
  if (us) {
    const name = us[1];
    if (!isPascal(name)) {
      const col = body.indexOf(name, body.indexOf('using') + 5);
      const to = toPascal(name);
      ctx.report('naming-type', i, col, col + name.length,
        `Имя псевдонима типа «${name}» должно быть в PascalCase${to ? ` (например, «${to}»)` : ''}`,
        undefined, to ? { from: name, to } : undefined);
    }
    return;
  }
  if (/^\s*(using|friend|return|delete|throw|goto|case|default|public|private|protected|static_assert)\b/.test(body)) return;

  // explicit-конструктор
  if (scope && scope.kind === 'class' && scope.name) {
    const re = new RegExp(`^(\\s*(?:(?:constexpr|inline)\\s+)*)(${scope.name})\\s*\\(`);
    const m = body.match(re);
    if (m && !/\bexplicit\b/.test(body.slice(0, m.index! + m[0].length))) {
      const open = m.index! + m[0].length - 1;
      const close = matchParen(c, open);
      if (close > 0 && !/=\s*delete/.test(c.slice(close))) {
        const params = splitTopLevel(c.slice(open + 1, close)).map((p) => p.text.trim()).filter((p) => p && p !== 'void');
        const callableWithOne = params.length >= 1 && params.slice(1).every((p) => p.includes('='));
        const first = params[0] ?? '';
        const copyMove = new RegExp(`\\b${scope.name}\\b(\\s*<[^>]*>)?\\s*(const\\s*)?&`).test(first);
        if (callableWithOne && !copyMove && !/initializer_list/.test(first) && !/^\.\.\./.test(first)) {
          const col = m[1].length;
          ctx.report('explicit-constructor', i, col, col + scope.name.length,
            'Конструктор, который можно вызвать с одним аргументом, нужно пометить `explicit`',
            { title: 'Добавить explicit', edits: [insert(i, col, 'explicit ')] });
        }
      }
    }
  }

  const toks = tokenize(body.slice(offset), offset);
  const d = parseDecl(toks);
  if (!d || d.isOperator) return;
  if (d.next?.t === '(') {
    const inValues = (scope && !['namespace', 'class'].includes(scope.kind));
    const afterParen = toks[d.nextIndex + 1];
    const looksLikeValues = afterParen && (/^[\d"']/.test(afterParen.t) || afterParen.t === '{' || afterParen.t === '-' ||
      (/^[a-z_]\w*$/.test(afterParen.t) && !TYPE_WORDS.has(afterParen.t) && !SPEC_WORDS.has(afterParen.t) &&
        [',', ')'].includes(toks[d.nextIndex + 2]?.t ?? '') ));
    if (inValues || looksLikeValues) {
      checkVariable(ctx, i, d, scope, toks);
    } else {
      checkFunction(ctx, i, d, scope, c);
    }
    return;
  }
  checkVariable(ctx, i, d, scope, toks);
}

function checkFunction(ctx: Ctx, i: number, d: Decl, scope: Brace | undefined, c: string): void {
  if (scope?.keyword === 'extern') return; // функции C называются по правилам C
  const name = d.name.t;
  const open = d.next!.col;
  const close = matchParen(c, open);
  const paramsText = c.slice(open + 1, close > 0 ? close : c.length);
  const tail = close > 0 ? c.slice(close + 1) : '';
  if (name !== 'main' && !isPascal(name) && !(scope?.kind === 'class' && name === scope.name)) {
    const isMethod = scope?.kind === 'class' || d.qualified;
    const accessor = isMethod && isSnake(name) &&
      ((paramsText.trim() === '' && /\bconst\b/.test(tail)) || (/^set_/.test(name) && splitTopLevel(paramsText).length === 1));
    if (!accessor) {
      const to = toPascal(name);
      ctx.report('naming-function', i, d.name.col, d.name.col + name.length,
        `Имя функции «${name}» должно быть в PascalCase${to ? ` (например, «${to}»)` : ''}` +
        (isMethod && isSnake(name) ? '. snake_case допустим только для геттеров (`int count() const`) и сеттеров (`set_count(x)`)' : ''),
        undefined, to ? { from: name, to } : undefined);
    }
  }
  // Параметры.
  for (const p of splitTopLevel(paramsText)) {
    let text = p.text;
    const eq = splitEq(text);
    if (eq >= 0) text = text.slice(0, eq);
    text = text.replace(/\[[^\]]*\]\s*$/, '');
    const pt = tokenize(text, open + 1 + p.start);
    if (pt.length < 2) continue;
    const last = pt[pt.length - 1];
    const prevTok = pt[pt.length - 2];
    if (!/^[A-Za-z_]\w*$/.test(last.t) || CPP_KEYWORDS.has(last.t) || TYPE_WORDS.has(last.t)) continue;
    if (prevTok.t === '::' || prevTok.t === '(' || prevTok.t === ',') continue;
    if (pt.some((t) => t.t === '(')) continue;
    if (!isSnake(last.t)) {
      const to = toSnake(last.t);
      ctx.report('naming-variable', i, last.col, last.col + last.t.length,
        `Имя параметра «${last.t}» должно быть в snake_case${to ? ` (например, «${to}»)` : ''}`,
        undefined, to ? { from: last.t, to } : undefined);
    }
  }
}

function splitEq(s: string): number {
  let depth = 0;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    else if (ch === '=' && depth === 0 && s[k + 1] !== '=' && !'=!<>'.includes(s[k - 1] ?? '')) return k;
  }
  return -1;
}

const NON_TRIVIAL = /^(?:::)?(?:std\s*::\s*)?(string|wstring|vector|map|set|unordered_map|unordered_set|multimap|multiset|list|deque|queue|stack|priority_queue|function|shared_ptr|unique_ptr)\b/;

function checkVariable(ctx: Ctx, i: number, d: Decl, scope: Brace | undefined, toks: Tok[]): void {
  const kind = scope?.kind;
  if (kind === 'enum' || kind === 'init') return;
  const isStatic = d.specs.has('static');
  const isConstexpr = d.specs.has('constexpr');
  const isConst = d.typeConst || isConstexpr;
  const global = !scope || kind === 'namespace';
  const inClass = kind === 'class' && scope?.keyword === 'class';
  const inStruct = kind === 'class' && scope?.keyword !== 'class';

  // Все имена в этом объявлении: первое + после запятых.
  const names: Tok[] = [d.name];
  let ptrCount = d.ptr.replace(/const/g, '').trim() ? 1 : 0;
  if (d.next?.t === ',') {
    let depth = 0;
    for (let k = d.nextIndex; k < toks.length; k++) {
      const t = toks[k].t;
      if ('([{<'.includes(t)) depth++;
      else if (')]}>'.includes(t)) depth--;
      else if (t === ';') break;
      else if (t === ',' && depth === 0) {
        let q = k + 1;
        let hasPtr = false;
        while (toks[q] && ['*', '&', '&&', 'const'].includes(toks[q].t)) {
          if (toks[q].t !== 'const') hasPtr = true;
          q++;
        }
        if (hasPtr) ptrCount++;
        if (toks[q] && /^[A-Za-z_]\w*$/.test(toks[q].t)) names.push(toks[q]);
      }
    }
  }
  if (names.length > 1 && ptrCount > 0) {
    ctx.report('pointer-alignment', i, d.name.col, names[names.length - 1].col + names[names.length - 1].t.length,
      'Нельзя объявлять несколько переменных в одной строке, если среди них есть указатель или ссылка');
  }

  for (const n of names) {
    const name = n.t;
    let rule = 'naming-variable';
    let ok: boolean;
    let to: string | undefined;
    let what: string;
    if (global || ((inClass || inStruct || isStatic) && isStatic && isConst)) {
      if (isConst) {
        rule = 'naming-constant';
        ok = isConstant(name);
        to = toConstant(name);
        what = `Константа «${name}» должна называться с k и PascalCase`;
      } else {
        ok = isSnake(name);
        to = toSnake(name);
        what = `Имя переменной «${name}» должно быть в snake_case`;
      }
    } else if (inClass) {
      rule = 'naming-member';
      ok = isMember(name);
      to = toMember(name);
      what = `Поле класса «${name}» должно быть в snake_case с «_» в конце`;
    } else if (inStruct) {
      rule = 'naming-member';
      ok = isSnake(name);
      to = toSnake(name);
      what = `Поле структуры «${name}» должно быть в snake_case (без «_» в конце — это только для class)`;
    } else {
      ok = isSnake(name) || (isConst && isConstant(name));
      to = toSnake(name);
      what = `Имя переменной «${name}» должно быть в snake_case`;
    }
    if (!ok) {
      ctx.report(rule, i, n.col, n.col + name.length, what + (to ? ` (например, «${to}»)` : ''),
        undefined, to ? { from: name, to } : undefined);
    }
  }

  if ((global || isStatic) && !isConstexpr && !d.ptr.includes('*') && !d.ptr.includes('&') && NON_TRIVIAL.test(d.typeText.replace(/\s+/g, ''))) {
    ctx.report('global-object', i, d.name.col, d.name.col + d.name.t.length,
      `Глобальный/статический объект типа \`${d.typeText.replace(/\s+/g, '')}\` запрещён (нетривиальный деструктор). ` +
      'Используйте constexpr, `const char[]`, `std::string_view` или локальную переменную');
  }
}

/** Комментарий на отдельной строке выравнивается по коду, к которому относится. */
function commentIndent(ctx: Ctx): void {
  const { src, cfg } = ctx;
  for (let i = 0; i < src.lines.length; i++) {
    const lc = src.lineComment[i];
    const o = src.lines[i];
    const lead = leading(o);
    if (src.preproc[i] || src.startsInside[i] || src.code[i].trim() !== '') continue;
    const isLine = lc >= 0 && lc === lead.length;
    const isBlock = lc < 0 && /^\s*\/\*/.test(o);
    if (!isLine && !isBlock) continue;
    if (lead.includes('\t')) continue;
    // Следующая строка кода.
    let k = i + 1;
    while (k < src.lines.length && (src.code[k].trim() === '' || src.preproc[k])) k++;
    const next = ctx.info[k];
    if (!next || next.expected === undefined || !next.strict) continue;
    const allowed = new Set<number>([next.expected]);
    const nt = src.code[k].trim();
    if (nt.startsWith('}')) allowed.add(next.expected + cfg.indentSize);
    if (/^(case\b|default\s*:)/.test(nt)) allowed.add(next.expected + cfg.indentSize);
    if (next.isAccess) allowed.add(next.expected + cfg.indentSize - cfg.accessModifierIndent);
    if (allowed.has(lead.length)) continue;
    const target = nt.startsWith('}') ? next.expected + cfg.indentSize : next.expected;
    ctx.report('indentation', i, 0, Math.max(lead.length, 1),
      `Комментарий должен иметь тот же отступ, что и код под ним (${target} пробел(ов)), сейчас ${lead.length}`,
      { title: `Сделать отступ ${target} пробел(ов)`, edits: [edit(i, 0, lead.length, ' '.repeat(target))] });
  }
}

// ───────────────────────── 4. правила файла ─────────────────────────

function guardFromPath(fileName: string): string {
  return fileName.replace(/\\/g, '/').replace(/^\.?\//, '').toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_';
}

function ensureInclude(ctx: Ctx, header: string): TextEdit[] {
  const { lines, code } = ctx.src;
  if (lines.some((l) => new RegExp(`#\\s*include\\s*<(${header}|stdint\\.h|cinttypes|inttypes\\.h)>`).test(l))) return [];
  let last = -1;
  let guardDefine = -1;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*#\s*include\b/.test(code[k])) last = k;
    if (ctx.guardName && new RegExp(`^\\s*#\\s*define\\s+${ctx.guardName}\\b`).test(code[k])) guardDefine = k;
  }
  if (last >= 0) return [insert(last + 1, 0, `#include <${header}>\n`)];
  if (guardDefine >= 0) return [insert(guardDefine + 1, 0, `\n#include <${header}>\n`)];
  return [insert(0, 0, `#include <${header}>\n\n`)];
}

function headerGuard(ctx: Ctx): void {
  const { src } = ctx;
  const expected = guardFromPath(ctx.fileName);
  const directives: { line: number; text: string }[] = [];
  let firstCode = -1;
  for (let k = 0; k < src.lines.length; k++) {
    if (src.preproc[k] && /^\s*#/.test(src.code[k])) directives.push({ line: k, text: src.code[k].trim() });
    else if (!src.preproc[k] && src.code[k].trim() !== '' && firstCode < 0) firstCode = k;
  }
  const n = src.lines.length;
  const lastIdx = n - 1;
  const endEdit = (g: string): TextEdit => (src.endsWithNewline
    ? insert(lastIdx, 0, `\n#endif  // ${g}\n`)
    : insert(lastIdx, src.lines[lastIdx].length, `\n\n#endif  // ${g}\n`));

  const first = directives[0];
  if (first && /^#\s*pragma\s+once\b/.test(first.text) && (firstCode < 0 || first.line < firstCode)) {
    ctx.guardName = undefined;
    ctx.report('header-guard', first.line, 0, src.lines[first.line].length,
      `В Google Style вместо #pragma once используется #define guard: #ifndef ${expected}`,
      { title: `Заменить на #ifndef ${expected}`, edits: [edit(first.line, 0, src.lines[first.line].length, `#ifndef ${expected}\n#define ${expected}`), endEdit(expected)] });
    return;
  }
  const ifn = first?.text.match(/^#\s*ifndef\s+(\w+)/);
  const def = directives[1]?.text.match(/^#\s*define\s+(\w+)/);
  if (first && ifn && def && ifn[1] === def[1] && (firstCode < 0 || first.line < firstCode)) {
    const g = ifn[1];
    ctx.guardName = g;
    const last = directives[directives.length - 1];
    const endif = /^#\s*endif\b/.test(last.text) ? last : undefined;
    if (!/_H_$/.test(g)) {
      const edits: TextEdit[] = [];
      for (const dl of [first, directives[1]]) {
        const col = src.lines[dl.line].indexOf(g);
        edits.push(edit(dl.line, col, col + g.length, expected));
      }
      if (endif) {
        const l = src.lines[endif.line];
        const e = l.indexOf('endif') + 5;
        edits.push(edit(endif.line, e, l.length, `  // ${expected}`));
      }
      const col = src.lines[first.line].indexOf(g);
      ctx.report('header-guard', first.line, col, col + g.length,
        `Имя header guard должно иметь вид <ПУТЬ>_<ФАЙЛ>_H_, например «${expected}»`,
        endif ? { title: `Переименовать в ${expected}`, edits } : undefined);
    } else if (endif && !src.lines[endif.line].includes(g)) {
      const l = src.lines[endif.line];
      const e = l.indexOf('endif') + 5;
      ctx.report('header-guard', endif.line, 0, l.length, `После #endif нужен комментарий «// ${g}»`,
        { title: `Добавить // ${g}`, edits: [edit(endif.line, e, l.length, `  // ${g}`)] });
    }
    if (!endif) ctx.report('header-guard', first.line, 0, src.lines[first.line].length, 'Header guard не закрыт `#endif` в конце файла');
    return;
  }
  // Guard отсутствует.
  const at = firstCode >= 0 && (!first || firstCode < first.line) ? firstCode : (first ? first.line : 0);
  ctx.report('header-guard', at, 0, Math.max(1, src.lines[at]?.length ?? 1),
    `В заголовочном файле нет header guard. Добавьте #ifndef ${expected} / #define ${expected} / #endif`,
    { title: `Добавить header guard ${expected}`, edits: [insert(at, 0, `#ifndef ${expected}\n#define ${expected}\n\n`), endEdit(expected)] });
}

const GROUP_NAMES = ['свой заголовок', 'системные C-заголовки (<....h>)', 'стандартная библиотека C++ (<...>)',
  'другие библиотеки', 'заголовки проекта ("...")'];

function includeRules(ctx: Ctx): void {
  const { src } = ctx;
  const base = ctx.fileName.replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '').replace(/_test$/, '');
  const incs: { line: number; path: string; angle: boolean; cat: number; col: number }[] = [];
  for (let k = 0; k < src.lines.length; k++) {
    const m = src.lines[k].match(/^\s*#\s*include\s*([<"])([^>"]+)[>"]/);
    if (!m || !src.preproc[k]) continue;
    const angle = m[1] === '<';
    const path = m[2];
    const col = src.lines[k].indexOf(m[1] + path);
    let cat: number;
    if (!angle && incs.length === 0 && path.replace(/.*\//, '').replace(/\.[^.]+$/, '') === base && !ctx.isHeader) cat = 0;
    else if (angle && /\.h$/.test(path)) cat = 1;
    else if (angle && !/\./.test(path)) cat = 2;
    else if (angle) cat = 3;
    else cat = 4;
    incs.push({ line: k, path, angle, cat, col });
    if (!angle && /(^|\/)\.\.?\//.test(path)) {
      ctx.report('include-order', k, col, col + path.length + 2,
        'Не используйте `.` и `..` в путях #include — указывайте путь от корня проекта');
    }
    if (/\.(c|cc|cpp|cxx)$/.test(path)) {
      ctx.report('include-order', k, col, col + path.length + 2, 'Не подключайте .cpp-файлы через #include — подключайте заголовки (.h)');
    }
  }
  if (incs.length < 2) return;

  // Можно ли безопасно пересортировать весь блок include?
  const firstLine = incs[0].line;
  const lastLine = incs[incs.length - 1].line;
  let sortable = true;
  for (let k = firstLine; k <= lastLine; k++) {
    if (src.lines[k].trim() === '') continue;
    if (!incs.some((x) => x.line === k) || src.lineComment[k] >= 0) {
      sortable = false;
      break;
    }
  }
  let sortFix: Fix | undefined;
  if (sortable) {
    const sorted = [...incs].sort((a, b) => a.cat - b.cat || (a.path.toLowerCase() < b.path.toLowerCase() ? -1 : a.path.toLowerCase() > b.path.toLowerCase() ? 1 : 0));
    const out: string[] = [];
    let prevCat = -1;
    const seen = new Set<string>();
    for (const x of sorted) {
      const lineText = src.lines[x.line].trim();
      if (seen.has(lineText)) continue;
      seen.add(lineText);
      if (prevCat !== -1 && x.cat !== prevCat) out.push('');
      out.push(lineText);
      prevCat = x.cat;
    }
    sortFix = { title: 'Упорядочить все #include по правилам Google', edits: [edit(firstLine, 0, src.lines[lastLine].length, out.join('\n'), lastLine)] };
  }

  let maxCat = -1;
  for (let k = 0; k < incs.length; k++) {
    const x = incs[k];
    const p = incs[k - 1];
    const len = x.path.length + 2;
    if (x.cat < maxCat) {
      ctx.report('include-order', x.line, x.col, x.col + len,
        `Неверный порядок #include: «${GROUP_NAMES[x.cat]}» должны идти раньше, чем «${GROUP_NAMES[maxCat]}»`, sortFix);
    } else if (p && p.cat === x.cat && x.line === p.line + 1 && x.path.toLowerCase() < p.path.toLowerCase()) {
      ctx.report('include-order', x.line, x.col, x.col + len,
        `#include внутри группы сортируются по алфавиту: ${x.angle ? '<' : '"'}${x.path}${x.angle ? '>' : '"'} должен быть выше`, sortFix);
    } else if (p && p.cat !== x.cat && x.line === p.line + 1) {
      ctx.report('include-order', x.line, x.col, x.col + len, 'Группы #include разделяются пустой строкой',
        { title: 'Вставить пустую строку', edits: [insert(x.line, 0, '\n')] });
    }
    maxCat = Math.max(maxCat, x.cat);
  }
}

function blankLineRules(ctx: Ctx): void {
  const { src } = ctx;
  const n = src.lines.length;
  const isBlank = (k: number): boolean => k >= 0 && k < n && src.lines[k].trim() === '' && !src.startsInside[k];
  // Где начинаются пустые строки в конце файла.
  let tail = n;
  while (tail > 0 && src.lines[tail - 1].trim() === '') tail--;
  const del = (k: number): Fix => ({ title: 'Удалить пустую строку', edits: [edit(k, 0, 0, '', k + 1)] });

  for (let k = 0; k < tail; k++) {
    if (!isBlank(k)) continue;
    const prevK = k - 1;
    const nextK = k + 1;
    if (isBlank(prevK)) {
      ctx.report('blank-lines', k, 0, 1, 'Несколько пустых строк подряд — оставьте одну', del(k));
      continue;
    }
    const pInfo = ctx.info[prevK];
    const nInfo = ctx.info[nextK];
    if (prevK >= 0 && src.code[prevK].trim().endsWith('{') && pInfo?.opensKind && pInfo.opensKind !== 'namespace') {
      ctx.report('blank-lines', k, 0, 1, 'Пустая строка в начале блока не нужна', del(k));
    } else if (nextK < n && src.code[nextK].trim().startsWith('}') && nInfo?.closesKind && nInfo.closesKind !== 'namespace') {
      ctx.report('blank-lines', k, 0, 1, 'Пустая строка в конце блока не нужна', del(k));
    } else if (pInfo?.isAccess) {
      ctx.report('blank-lines', k, 0, 1, 'После public:/protected:/private: пустая строка не ставится', del(k));
    }
  }
  // Пустая строка перед public/private.
  for (let k = 1; k < n; k++) {
    const info = ctx.info[k];
    if (!info?.isAccess || info.scope?.kind !== 'class') continue;
    const p = k - 1;
    if (isBlank(p)) continue;
    const pc = src.code[p].trim();
    if (pc.endsWith('{') && ctx.info[p]?.opensKind === 'class') continue; // первая секция
    if (src.code[p].trim() === '' && src.lineComment[p] >= 0) continue; // комментарий над секцией
    const col = firstNonSpace(src.lines[k]);
    ctx.report('access-specifier-blank-line', k, col, src.lines[k].trimEnd().length,
      'Перед public:/protected:/private: (кроме первого) ставится пустая строка',
      { title: 'Вставить пустую строку', edits: [insert(k, 0, '\n')] });
  }
  // Конец файла.
  const lastReal = tail - 1;
  if (!src.endsWithNewline) {
    const l = n - 1;
    ctx.report('end-of-file', l, src.lines[l].length, src.lines[l].length + 1, 'Файл должен заканчиваться переводом строки',
      { title: 'Добавить перевод строки', edits: [insert(l, src.lines[l].length, '\n')] });
  } else if (tail < n - 1 && lastReal >= 0) {
    ctx.report('end-of-file', tail, 0, 1, 'Лишние пустые строки в конце файла',
      { title: 'Удалить пустые строки в конце', edits: [edit(lastReal, src.lines[lastReal].length, 0, '\n', n - 1)] });
  }
}

// ───────────────────────── точка входа ─────────────────────────

export function lint(text: string, fileName = 'file.cpp', config: Partial<LintConfig> = {}): Issue[] {
  const cfg = withDefaults(config);
  const src = analyze(text);
  const ctx = new Ctx(src, cfg, fileName);

  if (ctx.isHeader) headerGuard(ctx);
  structurePass(ctx);
  for (let i = 0; i < src.lines.length; i++) {
    lineRules(ctx, i);
    declarationRules(ctx, i);
  }
  commentIndent(ctx);
  includeRules(ctx);
  blankLineRules(ctx);
  if (!src.lines.slice(0, 10).some((l) => /copyright/i.test(l))) {
    ctx.report('copyright', 0, 0, Math.max(1, src.lines[0]?.length ?? 1), 'В начале файла нет строки с лицензией/авторством (Copyright)');
  }

  ctx.issues.sort((a, b) => a.line - b.line || a.col - b.col);
  return ctx.issues;
}
