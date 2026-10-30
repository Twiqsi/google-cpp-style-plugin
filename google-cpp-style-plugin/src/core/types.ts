// Общие типы ядра линтера. Ядро не зависит от VS Code и может
// запускаться в обычном Node.js (так оно и тестируется).

export type Severity = 'error' | 'warning' | 'info' | 'hint' | 'off';

/** Правка текста: заменить диапазон [line:col, endLine:endCol) на text. Всё 0-based. */
export interface TextEdit {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  text: string;
}

export interface Fix {
  title: string;
  edits: TextEdit[];
}

export interface Rename {
  from: string;
  to: string;
}

export interface Issue {
  rule: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  message: string;
  severity: Severity;
  fix?: Fix;
  rename?: Rename;
}

export interface LintConfig {
  /** Размер одного уровня отступа в пробелах (Google: 2). */
  indentSize: number;
  /** Отступ public:/protected:/private: относительно class (Google: 1). */
  accessModifierIndent: number;
  /** Отступ строк-продолжений (Google: 4). */
  continuationIndent: number;
  /** Максимальная длина строки (Google: 80). */
  lineLength: number;
  /** Максимальная длина функции в строках (Google рекомендует ~40). */
  maxFunctionLines: number;
  /** Важность по умолчанию для правил, у которых нет своей. */
  defaultSeverity: Severity;
  /** Переопределения важности по правилам: { "line-length": "off" }. */
  rules: Record<string, Severity>;
}

export const DEFAULT_CONFIG: LintConfig = {
  indentSize: 2,
  accessModifierIndent: 1,
  continuationIndent: 4,
  lineLength: 80,
  maxFunctionLines: 40,
  defaultSeverity: 'warning',
  rules: {},
};

export function withDefaults(partial: Partial<LintConfig> = {}): LintConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    rules: { ...DEFAULT_CONFIG.rules, ...(partial.rules ?? {}) },
  };
}
