// Автоисправление: применение правок к тексту и «Исправить всё».

import { analyze } from './lexer';
import { lint } from './linter';
import { Issue, LintConfig, TextEdit } from './types';

function lineOffsets(text: string): number[] {
  const offs = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offs.push(i + 1);
  return offs;
}

function toOffset(text: string, offs: number[], line: number, col: number): number {
  if (line >= offs.length) return text.length;
  const start = offs[line];
  const lineEnd = line + 1 < offs.length ? offs[line + 1] - 1 : text.length;
  // Учитываем \r в конце строки: колонки считаются без него.
  const contentEnd = text[lineEnd - 1] === '\r' && lineEnd > start ? lineEnd - 1 : lineEnd;
  return Math.min(start + col, contentEnd);
}

/** Применяет правки (непересекающиеся). Пересекающиеся отбрасываются. Возвращает новый текст и число применённых. */
export function applyEdits(text: string, edits: TextEdit[]): { text: string; applied: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const offs = lineOffsets(text);
  const ranges = edits.map((e) => ({
    s: toOffset(text, offs, e.line, e.col),
    e: e.endLine > e.line && e.endCol === 0 ? (e.endLine < offs.length ? offs[e.endLine] : text.length) : toOffset(text, offs, e.endLine, e.endCol),
    t: e.text.replace(/\r?\n/g, eol),
  }));
  // Убираем дубликаты.
  const seen = new Set<string>();
  const uniq = ranges.filter((r) => {
    const k = `${r.s}:${r.e}:${r.t}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) => a.s - b.s || a.e - b.e);
  const chosen: typeof uniq = [];
  let lastEnd = -1;
  for (const r of uniq) {
    if (r.s < lastEnd || (r.s === lastEnd && r.s === r.e && chosen.length && chosen[chosen.length - 1].s === r.s)) continue;
    chosen.push(r);
    lastEnd = Math.max(lastEnd, r.e);
  }
  let out = text;
  for (let k = chosen.length - 1; k >= 0; k--) {
    const r = chosen[k];
    out = out.slice(0, r.s) + r.t + out.slice(r.e);
  }
  return { text: out, applied: chosen.length };
}

/** Переименование идентификатора во всём файле (только в коде, не в строках и комментариях). */
export function renameInText(text: string, from: string, to: string): string {
  const src = analyze(text);
  const edits: TextEdit[] = [];
  const re = new RegExp(`\\b${from.replace(/[$]/g, '\\$')}\\b`, 'g');
  src.code.forEach((line, i) => {
    for (const m of line.matchAll(re)) {
      const before = line.slice(0, m.index!);
      if (/\bstd\s*::\s*$/.test(before)) continue; // std::count — не наше
      edits.push({ line: i, col: m.index!, endLine: i, endCol: m.index! + from.length, text: to });
    }
  });
  return applyEdits(text, edits).text;
}

export interface FixAllResult {
  text: string;
  before: number;
  after: number;
  remaining: Issue[];
}

/**
 * Многократно применяет все доступные исправления (одни исправления могут
 * открыть другие — например, после переноса `{` пересчитываются отступы).
 */
export function fixAll(text: string, fileName: string, cfg: Partial<LintConfig>, renames = false): FixAllResult {
  const before = lint(text, fileName, cfg).length;
  let cur = text;
  for (let pass = 0; pass < 20; pass++) {
    const issues = lint(cur, fileName, cfg);
    const edits = issues.flatMap((i) => i.fix?.edits ?? []);
    if (!edits.length) break;
    const r = applyEdits(cur, edits);
    if (r.text === cur) break;
    cur = r.text;
  }
  if (renames) {
    const done = new Set<string>();
    for (let pass = 0; pass < 5; pass++) {
      const issues = lint(cur, fileName, cfg).filter((i) => i.rename && !done.has(i.rename.from));
      if (!issues.length) break;
      for (const i of issues) {
        const { from, to } = i.rename!;
        if (done.has(from)) continue;
        done.add(from);
        cur = renameInText(cur, from, to);
      }
    }
  }
  const remaining = lint(cur, fileName, cfg);
  return { text: cur, before, after: remaining.length, remaining };
}
