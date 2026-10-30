// Проверка и преобразование стилей имён.

export const CPP_KEYWORDS = new Set([
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break', 'case',
  'catch', 'char', 'char8_t', 'char16_t', 'char32_t', 'class', 'compl', 'concept', 'const', 'consteval',
  'constexpr', 'constinit', 'const_cast', 'continue', 'co_await', 'co_return', 'co_yield', 'decltype',
  'default', 'delete', 'do', 'double', 'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern',
  'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace',
  'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected',
  'public', 'register', 'reinterpret_cast', 'requires', 'return', 'short', 'signed', 'sizeof', 'static',
  'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local', 'throw',
  'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void',
  'volatile', 'wchar_t', 'while', 'xor', 'xor_eq', 'final', 'override',
]);

export const BUILTIN_TYPES = new Set([
  'void', 'bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'wchar_t', 'short', 'int', 'long',
  'float', 'double', 'signed', 'unsigned', 'auto',
]);

export const isPascal = (s: string): boolean => /^[A-Z][A-Za-z0-9]*$/.test(s);
export const isSnake = (s: string): boolean => /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(s);
export const isMember = (s: string): boolean => /^[a-z][a-z0-9]*(_[a-z0-9]+)*_$/.test(s);
// kDaysInAWeek, kAndroid8_0_0
export const isConstant = (s: string): boolean => /^k[A-Z0-9][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(s);
export const isMacro = (s: string): boolean => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*_?$/.test(s);

/** Разбивает имя на слова: itemCount → [item, count], MAX_SIZE → [max, size], m_size → [size]. */
export function words(name: string): string[] {
  let s = name.replace(/^_+|_+$/g, '');
  s = s.replace(/^(m|g|s)_(?=[A-Za-z])/, '');
  if (/^k[A-Z]/.test(s)) s = s.slice(1);
  const parts = s.split('_').filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g);
    if (m) out.push(...m.map((w) => w.toLowerCase()));
  }
  return out;
}

const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

function joinPascal(ws: string[]): string {
  return ws.map(cap).join('');
}

function safe(result: string, original: string): string | undefined {
  if (!result || result === original || CPP_KEYWORDS.has(result) || /^[0-9]/.test(result)) return undefined;
  return result;
}

export const toPascal = (n: string): string | undefined => safe(joinPascal(words(n)), n);
export const toSnake = (n: string): string | undefined => safe(words(n).join('_'), n);
export const toMember = (n: string): string | undefined => {
  const s = words(n).join('_');
  return s ? safe(s + '_', n) : undefined;
};
export const toConstant = (n: string): string | undefined => {
  const p = joinPascal(words(n));
  return p ? safe('k' + p, n) : undefined;
};
export const toMacro = (n: string): string | undefined => safe(words(n).map((w) => w.toUpperCase()).join('_'), n);
