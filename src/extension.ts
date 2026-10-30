// Точка входа расширения VS Code.
// Здесь ядро линтера (src/core) подключается к редактору:
//   • диагностики (подчёркивания) + вкладка «Проблемы»;
//   • всплывающая подсказка с объяснением правила;
//   • быстрые исправления (Ctrl+.) и «Исправить всё»;
//   • счётчик ошибок в строке состояния;
//   • команды и настройки (размер отступа и т.д.).

import * as vscode from 'vscode';
import { lint } from './core/linter';
import { fixAll, renameInText } from './core/fixer';
import { RULES, ruleUrl } from './core/rules';
import { Issue, LintConfig, Severity } from './core/types';

const SOURCE = 'Google C++ Style';
const SECTION = 'googleCppStyle';
const FIX_ALL_KIND = vscode.CodeActionKind.SourceFixAll.append('googleCppStyle');

let diagnostics: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;
let output: vscode.OutputChannel;
const issuesByUri = new Map<string, Issue[]>();
const timers = new Map<string, NodeJS.Timeout>();

// ───────────── настройки ─────────────

function settings(uri?: vscode.Uri): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION, uri);
}

function lintConfig(uri?: vscode.Uri): Partial<LintConfig> {
  const s = settings(uri);
  return {
    indentSize: s.get<number>('indentSize', 2),
    accessModifierIndent: s.get<number>('accessModifierIndent', 1),
    continuationIndent: s.get<number>('continuationIndent', 4),
    lineLength: s.get<number>('lineLength', 80),
    maxFunctionLines: s.get<number>('maxFunctionLines', 40),
    defaultSeverity: s.get<Severity>('severity', 'warning'),
    rules: s.get<Record<string, Severity>>('rules', {}),
  };
}

function isEnabled(uri?: vscode.Uri): boolean {
  return settings(uri).get<boolean>('enable', true);
}

function isCpp(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled' && doc.uri.scheme !== 'vscode-vfs') return false;
  if (doc.languageId === 'cpp' || doc.languageId === 'cuda-cpp') return true;
  // .h часто открывается как язык C — проверяем его тоже.
  return doc.languageId === 'c' && /\.(h|hh|hpp)$/i.test(doc.fileName);
}

function relName(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  return rel || uri.path.split('/').pop() || 'file.cpp';
}

// ───────────── диагностики ─────────────

function toSeverity(s: Severity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'info': return vscode.DiagnosticSeverity.Information;
    case 'hint': return vscode.DiagnosticSeverity.Hint;
    default: return vscode.DiagnosticSeverity.Warning;
  }
}

function toRange(doc: { lineAt(n: number): { text: string }; lineCount: number } | undefined, i: Issue): vscode.Range {
  let endLine = i.endLine;
  let endCol = i.endCol;
  if (doc && endLine < doc.lineCount) {
    const len = doc.lineAt(endLine).text.length;
    if (endCol > len && endLine === i.line) endCol = Math.max(len, i.col + 1);
  }
  return new vscode.Range(i.line, i.col, endLine, endCol);
}

function makeDiagnostics(issues: Issue[], doc?: vscode.TextDocument): vscode.Diagnostic[] {
  return issues.map((i) => {
    const d = new vscode.Diagnostic(toRange(doc, i), i.message, toSeverity(i.severity));
    d.source = SOURCE;
    d.code = { value: i.rule, target: vscode.Uri.parse(ruleUrl(i.rule)) };
    return d;
  });
}

function lintDocument(doc: vscode.TextDocument): void {
  if (!isCpp(doc)) return;
  if (!isEnabled(doc.uri)) {
    diagnostics.delete(doc.uri);
    issuesByUri.delete(doc.uri.toString());
    updateStatusBar();
    return;
  }
  let issues: Issue[] = [];
  try {
    issues = lint(doc.getText(), relName(doc.uri), lintConfig(doc.uri));
  } catch (e) {
    output.appendLine(`Ошибка проверки ${doc.fileName}: ${(e as Error).stack ?? e}`);
  }
  issuesByUri.set(doc.uri.toString(), issues);
  diagnostics.set(doc.uri, makeDiagnostics(issues, doc));
  updateStatusBar();
}

function scheduleLint(doc: vscode.TextDocument): void {
  const key = doc.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    lintDocument(doc);
  }, settings(doc.uri).get<number>('delay', 300)));
}

function findIssue(uri: vscode.Uri, d: vscode.Diagnostic): Issue | undefined {
  const code = typeof d.code === 'object' ? d.code.value : d.code;
  return issuesByUri.get(uri.toString())?.find((i) =>
    i.rule === code && i.line === d.range.start.line && i.col === d.range.start.character && i.message === d.message);
}

// ───────────── строка состояния ─────────────

function updateStatusBar(): void {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isCpp(ed.document)) {
    statusBar.hide();
    return;
  }
  if (!isEnabled(ed.document.uri)) {
    statusBar.text = '$(circle-slash) Google Style: выкл';
    statusBar.tooltip = 'Проверка Google C++ Style выключена. Нажмите, чтобы открыть меню.';
    statusBar.backgroundColor = undefined;
    statusBar.show();
    return;
  }
  const issues = issuesByUri.get(ed.document.uri.toString()) ?? [];
  const count = (s: Severity): number => issues.filter((i) => i.severity === s).length;
  const errors = count('error');
  const warnings = count('warning');
  const infos = count('info') + count('hint');
  const fixable = issues.filter((i) => i.fix || i.rename).length;
  const indent = settings(ed.document.uri).get<number>('indentSize', 2);
  if (issues.length === 0) {
    statusBar.text = '$(pass-filled) Google Style';
    statusBar.backgroundColor = undefined;
  } else {
    statusBar.text = `${errors ? '$(error)' : '$(warning)'} Google Style: ${issues.length}`;
    statusBar.backgroundColor = new vscode.ThemeColor(errors ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground');
  }
  const byRule = new Map<string, number>();
  for (const i of issues) byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);
  const top = [...byRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**Google C++ Style** — отступ ${indent} пробел(ов)\n\n`);
  if (issues.length === 0) {
    md.appendMarkdown('$(pass) Нарушений не найдено\n\n');
  } else {
    md.appendMarkdown(`Всего нарушений: **${issues.length}**\n\n`);
    if (errors) md.appendMarkdown(`$(error) Ошибки: ${errors}  \n`);
    if (warnings) md.appendMarkdown(`$(warning) Предупреждения: ${warnings}  \n`);
    if (infos) md.appendMarkdown(`$(info) Рекомендации: ${infos}  \n`);
    md.appendMarkdown(`$(wrench) Можно исправить автоматически: ${fixable}\n\n`);
    md.appendMarkdown('Чаще всего:\n');
    for (const [rule, n] of top) md.appendMarkdown(`- ${RULES[rule]?.title ?? rule}: ${n}\n`);
  }
  md.appendMarkdown('\n_Нажмите, чтобы открыть меню_');
  statusBar.tooltip = md;
  statusBar.show();
}

// ───────────── подсказка при наведении ─────────────

class StyleHover implements vscode.HoverProvider {
  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    if (!settings(doc.uri).get<boolean>('hover', true)) return undefined;
    const issues = (issuesByUri.get(doc.uri.toString()) ?? []).filter((i) => toRange(doc, i).contains(pos));
    if (!issues.length) return undefined;
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = false;
    const shown = new Set<string>();
    for (const i of issues) {
      const r = RULES[i.rule];
      if (!r || shown.has(i.rule)) continue;
      shown.add(i.rule);
      if (shown.size > 1) md.appendMarkdown('\n\n---\n\n');
      md.appendMarkdown(`#### $(book) Google C++ Style · ${r.title}\n\n`);
      md.appendMarkdown(`**Что не так:** ${i.message}\n\n`);
      md.appendMarkdown(`**Правило:** ${r.explain}\n\n`);
      md.appendMarkdown('❌ Неправильно:\n');
      md.appendCodeblock(r.bad, 'cpp');
      md.appendMarkdown('✅ Правильно:\n');
      md.appendCodeblock(r.good, 'cpp');
      const how = i.fix ? `$(lightbulb) Исправить: **Ctrl+.** → «${i.fix.title}»`
        : i.rename ? `$(lightbulb) **Ctrl+.** → «Переименовать в ${i.rename.to}»`
          : '$(edit) Исправляется вручную';
      md.appendMarkdown(`\n${how} · [Открыть раздел руководства](${ruleUrl(i.rule)}) · \`${i.rule}\``);
    }
    return new vscode.Hover(md);
  }
}

// ───────────── быстрые исправления ─────────────

class StyleActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, FIX_ALL_KIND];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    if (!isCpp(doc) || !isEnabled(doc.uri)) return [];
    if (context.only && FIX_ALL_KIND.contains(context.only)) {
      const a = new vscode.CodeAction('Google Style: исправить всё', FIX_ALL_KIND);
      a.edit = fixAllEdit(doc, false);
      return a.edit ? [a] : [];
    }
    const actions: vscode.CodeAction[] = [];
    const ours = context.diagnostics.filter((d) => d.source === SOURCE);
    for (const d of ours) {
      const issue = findIssue(doc.uri, d);
      if (!issue) continue;
      const rule = RULES[issue.rule];
      if (issue.fix) {
        const a = new vscode.CodeAction(issue.fix.title, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d];
        a.isPreferred = true;
        const we = new vscode.WorkspaceEdit();
        for (const e of issue.fix.edits) {
          we.replace(doc.uri, new vscode.Range(e.line, e.col, e.endLine, e.endCol), e.text.replace(/\n/g, doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n'));
        }
        a.edit = we;
        actions.push(a);
      }
      if (issue.rename) {
        const a = new vscode.CodeAction(`Переименовать «${issue.rename.from}» → «${issue.rename.to}» (везде)`, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d];
        a.isPreferred = !issue.fix;
        a.command = {
          command: `${SECTION}.rename`, title: 'Переименовать',
          arguments: [doc.uri, issue.line, issue.col, issue.rename.from, issue.rename.to],
        };
        actions.push(a);
      }
      const ignore = new vscode.CodeAction(`Игнорировать «${rule?.title ?? issue.rule}» в этой строке`, vscode.CodeActionKind.QuickFix);
      ignore.diagnostics = [d];
      const lineText = doc.lineAt(issue.line).text;
      const we = new vscode.WorkspaceEdit();
      const end = new vscode.Position(issue.line, lineText.length);
      we.insert(doc.uri, end, /\/\//.test(lineText) ? ` NOLINT(${issue.rule})` : `  // NOLINT(${issue.rule})`);
      ignore.edit = we;
      actions.push(ignore);
      const off = new vscode.CodeAction(`Отключить правило «${rule?.title ?? issue.rule}» в настройках`, vscode.CodeActionKind.QuickFix);
      off.diagnostics = [d];
      off.command = { command: `${SECTION}.disableRule`, title: 'Отключить', arguments: [issue.rule] };
      actions.push(off);
    }
    if (ours.length) {
      const all = new vscode.CodeAction('Google Style: исправить все проблемы в файле', vscode.CodeActionKind.QuickFix);
      all.command = { command: `${SECTION}.fixAll`, title: 'Исправить всё' };
      actions.push(all);
    }
    return actions;
  }
}

function fixAllEdit(doc: vscode.TextDocument, renames: boolean): vscode.WorkspaceEdit | undefined {
  const text = doc.getText();
  const r = fixAll(text, relName(doc.uri), lintConfig(doc.uri), renames);
  if (r.text === text) return undefined;
  const we = new vscode.WorkspaceEdit();
  we.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), r.text);
  return we;
}

// ───────────── команды ─────────────

async function cmdFixAll(renamesArg?: boolean): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isCpp(ed.document)) {
    vscode.window.showWarningMessage('Откройте C++ файл, чтобы исправить стиль.');
    return;
  }
  const doc = ed.document;
  const renames = renamesArg ?? settings(doc.uri).get<boolean>('fixAll.renameIdentifiers', false);
  const text = doc.getText();
  const r = fixAll(text, relName(doc.uri), lintConfig(doc.uri), renames);
  if (r.text !== text) {
    await ed.edit((b) => b.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), r.text));
  }
  lintDocument(doc);
  const fixed = Math.max(0, r.before - r.after);
  const namingLeft = r.remaining.filter((i) => i.rename).length;
  let msg = `Google Style: исправлено ${fixed} из ${r.before}.`;
  if (r.after === 0) msg += ' Код полностью соответствует стилю 🎉';
  else msg += ` Осталось ${r.after} — наведите курсор на подчёркивание, чтобы увидеть, что не так.`;
  const actions: string[] = [];
  if (namingLeft && !renames) actions.push(`Исправить и имена (${namingLeft})`);
  if (r.after) actions.push('Показать проблемы');
  const pick = await vscode.window.showInformationMessage(msg, ...actions);
  if (pick?.startsWith('Исправить и имена')) await cmdFixAll(true);
  else if (pick === 'Показать проблемы') vscode.commands.executeCommand('workbench.actions.view.problems');
}

async function cmdRename(uri: vscode.Uri, line: number, col: number, from: string, to: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  // Сначала пробуем «умное» переименование языкового сервера (C/C++ или clangd) —
  // оно меняет имя во всех файлах проекта. Если его нет — меняем в текущем файле.
  try {
    if (settings(uri).get<boolean>('useLanguageServerRename', true)) {
      const we = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider', uri, new vscode.Position(line, col), to);
      if (we && we.size > 0) {
        await vscode.workspace.applyEdit(we);
        return;
      }
    }
  } catch {
    // Языкового сервера нет или он не смог — используем запасной вариант.
  }
  const text = doc.getText();
  const next = renameInText(text, from, to);
  if (next === text) return;
  const we = new vscode.WorkspaceEdit();
  we.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), next);
  await vscode.workspace.applyEdit(we);
}

async function cmdSetIndent(): Promise<void> {
  const current = settings().get<number>('indentSize', 2);
  const items: (vscode.QuickPickItem & { value?: number })[] = [
    { label: '2', description: 'по Google Style (по умолчанию)', value: 2 },
    { label: '4', description: 'частый вариант в учебных курсах', value: 4 },
    { label: '8', value: 8 },
    { label: 'Другое число…' },
  ].map((i) => ({ ...i, picked: i.value === current, detail: i.value === current ? 'сейчас' : undefined }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: `Размер отступа (сейчас ${current})` });
  if (!pick) return;
  let value = pick.value;
  if (value === undefined) {
    const s = await vscode.window.showInputBox({
      prompt: 'Сколько пробелов в одном уровне отступа?', value: String(current),
      validateInput: (v) => (/^[1-9]\d?$/.test(v) && +v <= 16 ? undefined : 'Введите число от 1 до 16'),
    });
    if (!s) return;
    value = +s;
  }
  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await settings().update('indentSize', value, target);
  if (value !== 2 && settings().get<number>('accessModifierIndent', 1) === 1) {
    const ans = await vscode.window.showInformationMessage(
      `Отступ ${value}. Сдвиг public:/private: оставить 1 пробел (как в Google) или сделать ${Math.floor(value / 2)}?`,
      'Оставить 1', `Сделать ${Math.floor(value / 2)}`);
    if (ans?.startsWith('Сделать')) await settings().update('accessModifierIndent', Math.floor(value / 2), target);
  }
  vscode.window.showInformationMessage(`Google Style: размер отступа — ${value} пробел(ов).`);
}

async function cmdCheckWorkspace(): Promise<void> {
  const files = await vscode.workspace.findFiles('**/*.{c,cc,cpp,cxx,h,hh,hpp,hxx}',
    '{**/node_modules/**,**/build/**,**/cmake-build-*/**,**/.git/**,**/out/**,**/third_party/**}', 3000);
  let total = 0;
  let withIssues = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Google Style: проверка проекта' }, async (p) => {
    for (let k = 0; k < files.length; k++) {
      const uri = files[k];
      p.report({ message: relName(uri), increment: 100 / files.length });
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      const text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const issues = lint(text, relName(uri), lintConfig(uri));
      issuesByUri.set(uri.toString(), issues);
      diagnostics.set(uri, makeDiagnostics(issues, open));
      total += issues.length;
      if (issues.length) withIssues++;
    }
  });
  updateStatusBar();
  const pick = await vscode.window.showInformationMessage(
    `Google Style: проверено файлов — ${files.length}, нарушений — ${total} (в ${withIssues} файлах).`, 'Показать проблемы');
  if (pick) vscode.commands.executeCommand('workbench.actions.view.problems');
}

function cmdReport(): void {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !isCpp(ed.document)) return;
  lintDocument(ed.document);
  const issues = issuesByUri.get(ed.document.uri.toString()) ?? [];
  output.clear();
  output.appendLine(`Отчёт Google C++ Style — ${relName(ed.document.uri)}`);
  output.appendLine(`Отступ: ${settings(ed.document.uri).get('indentSize')}, длина строки: ${settings(ed.document.uri).get('lineLength')}`);
  output.appendLine(`Всего нарушений: ${issues.length}\n`);
  const byRule = new Map<string, Issue[]>();
  for (const i of issues) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i]);
  for (const [rule, list] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
    output.appendLine(`■ ${RULES[rule]?.title ?? rule} (${rule}) — ${list.length}`);
    for (const i of list) output.appendLine(`    строка ${i.line + 1}, кол. ${i.col + 1}: ${i.message}`);
    output.appendLine('');
  }
  output.show(true);
}

async function cmdMenu(): Promise<void> {
  const enabled = isEnabled(vscode.window.activeTextEditor?.document.uri);
  const indent = settings().get<number>('indentSize', 2);
  const items: (vscode.QuickPickItem & { cmd: string })[] = [
    { label: '$(wrench) Исправить всё в файле', description: 'форматирование', cmd: `${SECTION}.fixAll` },
    { label: '$(symbol-variable) Исправить всё, включая имена', description: 'переименует переменные/функции в файле', cmd: `${SECTION}.fixAllWithRenames` },
    { label: '$(list-unordered) Показать список проблем', cmd: 'workbench.actions.view.problems' },
    { label: '$(output) Отчёт по файлу', cmd: `${SECTION}.report` },
    { label: '$(folder) Проверить весь проект', cmd: `${SECTION}.checkWorkspace` },
    { label: `$(whitespace) Размер отступа: ${indent}`, description: 'изменить', cmd: `${SECTION}.setIndentSize` },
    { label: '$(gear) Все настройки', cmd: `${SECTION}.openSettings` },
    { label: enabled ? '$(circle-slash) Выключить проверку' : '$(check) Включить проверку', cmd: `${SECTION}.toggle` },
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Google C++ Style' });
  if (pick) vscode.commands.executeCommand(pick.cmd);
}

// ───────────── активация ─────────────

export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection('google-cpp-style');
  output = vscode.window.createOutputChannel('Google C++ Style');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = `${SECTION}.menu`;
  statusBar.name = 'Google C++ Style';

  const selector: vscode.DocumentSelector = [
    { language: 'cpp' }, { language: 'cuda-cpp' }, { language: 'c', pattern: '**/*.{h,hh,hpp}' },
  ];

  const reg = <T extends unknown[]>(id: string, fn: (...a: T) => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(`${SECTION}.${id}`, fn as (...a: unknown[]) => unknown);

  let formatter: vscode.Disposable | undefined;
  const updateFormatter = (): void => {
    formatter?.dispose();
    formatter = undefined;
    if (settings().get<boolean>('formatter.enable', false)) {
      formatter = vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits(doc) {
          const text = doc.getText();
          const r = fixAll(text, relName(doc.uri), lintConfig(doc.uri), false);
          return r.text === text ? [] : [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), r.text)];
        },
      });
    }
  };
  updateFormatter();

  context.subscriptions.push(
    diagnostics, output, statusBar, { dispose: () => formatter?.dispose() },
    vscode.languages.registerHoverProvider(selector, new StyleHover()),
    vscode.languages.registerCodeActionsProvider(selector, new StyleActions(), { providedCodeActionKinds: StyleActions.kinds }),

    reg('checkFile', () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || !isCpp(ed.document)) {
        vscode.window.showWarningMessage('Откройте C++ файл.');
        return;
      }
      lintDocument(ed.document);
      const n = issuesByUri.get(ed.document.uri.toString())?.length ?? 0;
      vscode.window.showInformationMessage(n ? `Google Style: найдено нарушений — ${n}.` : 'Google Style: нарушений нет 🎉');
    }),
    reg('fixAll', () => cmdFixAll()),
    reg('fixAllWithRenames', () => cmdFixAll(true)),
    reg('rename', cmdRename),
    reg('setIndentSize', cmdSetIndent),
    reg('checkWorkspace', cmdCheckWorkspace),
    reg('report', cmdReport),
    reg('menu', cmdMenu),
    reg('openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)),
    reg('toggle', async () => {
      const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await settings().update('enable', !isEnabled(), target);
    }),
    reg('disableRule', async (rule: string) => {
      const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      const rules = { ...settings().get<Record<string, Severity>>('rules', {}), [rule]: 'off' };
      await settings().update('rules', rules, target);
      vscode.window.showInformationMessage(`Правило «${RULES[rule]?.title ?? rule}» отключено. Включить обратно: настройка googleCppStyle.rules.`);
    }),

    vscode.workspace.onDidOpenTextDocument(lintDocument),
    vscode.workspace.onDidSaveTextDocument(lintDocument),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isCpp(e.document) && settings(e.document.uri).get<boolean>('lintOnType', true)) scheduleLint(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      issuesByUri.delete(doc.uri.toString());
    }),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (!isCpp(e.document) || !isEnabled(e.document.uri) || !settings(e.document.uri).get<boolean>('fixOnSave', false)) return;
      const doc = e.document;
      const text = doc.getText();
      const r = fixAll(text, relName(doc.uri), lintConfig(doc.uri), false);
      if (r.text !== text) {
        e.waitUntil(Promise.resolve([vscode.TextEdit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), r.text)]));
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed && isCpp(ed.document) && !issuesByUri.has(ed.document.uri.toString())) lintDocument(ed.document);
      updateStatusBar();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION)) return;
      if (e.affectsConfiguration(`${SECTION}.formatter.enable`)) updateFormatter();
      vscode.workspace.textDocuments.forEach(lintDocument);
      updateStatusBar();
    }),
  );

  vscode.workspace.textDocuments.forEach(lintDocument);
  updateStatusBar();
}

export function deactivate(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
}
