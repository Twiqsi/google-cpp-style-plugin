// Лексер-«маскировщик».
// Он не строит полноценное дерево разбора. Вместо этого он делает копию
// исходника, в которой комментарии и содержимое строковых/символьных
// литералов заменены пробелами. Длина строк и позиции символов при этом
// сохраняются, поэтому правила могут искать шаблоны в «чистом» коде
// регулярными выражениями и сразу знать точную колонку в оригинале.

export interface SourceInfo {
  /** Оригинальные строки (без символов перевода строки). */
  lines: string[];
  /** Строки, где комментарии и содержимое литералов заменены пробелами. */
  code: string[];
  /** Колонка начала `//`-комментария в строке, иначе -1. */
  lineComment: number[];
  /** Строка начинается внутри /* ... *\/ комментария или raw-строки. */
  startsInside: boolean[];
  /** Строка — директива препроцессора (включая продолжения через `\`). */
  preproc: boolean[];
  /** Исходный текст заканчивается переводом строки. */
  endsWithNewline: boolean;
  eol: string;
}

const isIdent = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c);

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function analyze(text: string): SourceInfo {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  const n = text.length;
  // Колонка `//` для каждой строки, считаем по ходу.
  const lineCommentStarts: number[] = [];
  const startsInside: boolean[] = [false];
  let lineNo = 0;
  let col = 0;
  lineCommentStarts[0] = -1;

  type State = 'code' | 'line' | 'block' | 'str' | 'chr' | 'raw';
  let state: State = 'code';
  let rawEnd = '';

  const newline = (): void => {
    lineNo++;
    col = 0;
    lineCommentStarts[lineNo] = -1;
    startsInside[lineNo] = state === 'block' || state === 'raw';
  };

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === '\r' && text[i + 1] === '\n') {
      out.push('\r');
      continue;
    }
    if (c === '\n') {
      // `//`-комментарий и обычные строки заканчиваются на переводе строки
      // (кроме продолжения через обратный слэш).
      if (state === 'line') {
        const prev = text[i - 1] === '\r' ? text[i - 2] : text[i - 1];
        if (prev !== '\\') state = 'code';
      } else if (state === 'str' || state === 'chr') {
        const prev = text[i - 1] === '\r' ? text[i - 2] : text[i - 1];
        if (prev !== '\\') state = 'code';
      }
      out.push('\n');
      newline();
      continue;
    }

    switch (state) {
      case 'code': {
        if (c === '/' && text[i + 1] === '/') {
          state = 'line';
          lineCommentStarts[lineNo] = col;
          out.push(' ', ' ');
          i++;
          col += 2;
          continue;
        }
        if (c === '/' && text[i + 1] === '*') {
          state = 'block';
          out.push(' ', ' ');
          i++;
          col += 2;
          continue;
        }
        if (c === '"') {
          // Raw-строка: R"delim( ... )delim"
          if (text[i - 1] === 'R' && (!isIdent(text[i - 2]) || /(?:^|[^A-Za-z0-9_])(?:u8|u|U|L)R$/.test(text.slice(Math.max(0, i - 4), i)))) {
            const open = text.indexOf('(', i);
            if (open !== -1 && open - i <= 17) {
              const delim = text.slice(i + 1, open);
              rawEnd = ')' + delim + '"';
              state = 'raw';
              out.push('"');
              col++;
              // Разделитель и `(` маскируем.
              for (let k = i + 1; k <= open; k++) {
                out.push(' ');
                col++;
              }
              i = open;
              continue;
            }
          }
          state = 'str';
          out.push('"');
          col++;
          continue;
        }
        if (c === '\'') {
          // Разделитель разрядов C++14: 1'000'000 — это не символьный литерал.
          let k = i - 1;
          while (k >= 0 && /[A-Za-z0-9_.']/.test(text[k])) k--;
          const tokenStart = text[k + 1];
          if (tokenStart !== undefined && /[0-9]/.test(tokenStart) && k + 1 < i) {
            out.push('\'');
            col++;
            continue;
          }
          state = 'chr';
          out.push('\'');
          col++;
          continue;
        }
        out.push(c);
        col++;
        continue;
      }
      case 'line': {
        out.push(c === '\t' ? ' ' : ' ');
        col++;
        continue;
      }
      case 'block': {
        if (c === '*' && text[i + 1] === '/') {
          state = 'code';
          out.push(' ', ' ');
          i++;
          col += 2;
          continue;
        }
        out.push(' ');
        col++;
        continue;
      }
      case 'str':
      case 'chr': {
        const quote = state === 'str' ? '"' : '\'';
        if (c === '\\') {
          // Экранированный символ: маскируем оба. Перевод строки после `\`
          // обрабатывается в общей ветке выше.
          out.push(' ');
          col++;
          if (text[i + 1] !== undefined && text[i + 1] !== '\n' && text[i + 1] !== '\r') {
            out.push(' ');
            col++;
            i++;
          }
          continue;
        }
        if (c === quote) {
          state = 'code';
          out.push(quote);
          col++;
          continue;
        }
        out.push(' ');
        col++;
        continue;
      }
      case 'raw': {
        if (c === ')' && text.startsWith(rawEnd, i)) {
          for (let k = 0; k < rawEnd.length - 1; k++) {
            out.push(' ');
            col++;
          }
          out.push('"');
          col++;
          i += rawEnd.length - 1;
          state = 'code';
          continue;
        }
        out.push(' ');
        col++;
        continue;
      }
    }
  }

  const masked = out.join('');
  const lines = splitLines(text);
  const code = splitLines(masked);
  // Подстраховка на случай расхождения длин.
  while (code.length < lines.length) code.push('');

  // Препроцессор.
  const preproc: boolean[] = new Array(lines.length).fill(false);
  let cont = false;
  for (let i = 0; i < lines.length; i++) {
    const isDirective = !startsInside[i] && /^\s*#/.test(code[i]);
    if (cont || isDirective) {
      preproc[i] = true;
      cont = /\\\s*$/.test(lines[i]);
    } else {
      cont = false;
    }
  }

  const lineComment = lines.map((_, i) => (lineCommentStarts[i] ?? -1));

  return {
    lines,
    code,
    lineComment,
    startsInside: lines.map((_, i) => !!startsInside[i]),
    preproc,
    endsWithNewline: text.length === 0 || text.endsWith('\n'),
    eol,
  };
}

/** Индекс парной закрывающей скобки в строке (по замаскированному коду). */
export function matchParen(s: string, openIdx: number): number {
  const open = s[openIdx];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '>';
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
