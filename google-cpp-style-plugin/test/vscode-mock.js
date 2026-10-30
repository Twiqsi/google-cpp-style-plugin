// Минимальная имитация API VS Code для смоук-теста extension.js в Node.
const fs = require('fs');
const listeners = {};
const on = (name) => (fn) => { (listeners[name] ||= []).push(fn); return { dispose() {} }; };
const fire = (name, arg) => (listeners[name] || []).forEach((f) => f(arg));

class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
  contains(p) {
    const s = this.start, e = this.end;
    if (p.line < s.line || p.line > e.line) return false;
    if (p.line === s.line && p.character < s.character) return false;
    if (p.line === e.line && p.character > e.character) return false;
    return true;
  }
}
class Kind {
  constructor(v) { this.value = v; }
  append(x) { return new Kind(this.value + '.' + x); }
  contains(o) { return o.value === this.value || o.value.startsWith(this.value + '.'); }
}
const CodeActionKind = { QuickFix: new Kind('quickfix'), SourceFixAll: new Kind('source.fixAll') };
class WorkspaceEdit {
  constructor() { this.edits = []; }
  replace(uri, range, text) { this.edits.push({ uri, range, text }); }
  insert(uri, pos, text) { this.edits.push({ uri, range: new Range(pos, pos), text }); }
  get size() { return this.edits.length; }
}
class MarkdownString {
  constructor(v = '') { this.value = v; }
  appendMarkdown(s) { this.value += s; return this; }
  appendCodeblock(s, l) { this.value += '\n```' + l + '\n' + s + '\n```\n'; return this; }
}
const Uri = { file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => 'file://' + p }), parse: (s) => ({ toString: () => s }) };

function makeDoc(path, text, languageId = 'cpp') {
  const doc = {
    uri: Uri.file(path), fileName: path, languageId, eol: 1, _text: text,
    getText() { return this._text; },
    get lineCount() { return this._text.split('\n').length; },
    lineAt(n) { return { text: this._text.split('\n')[n] ?? '' }; },
    offsetAt(p) { const ls = this._text.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    positionAt(off) { const before = this._text.slice(0, off).split('\n'); return new Position(before.length - 1, before[before.length - 1].length); },
  };
  return doc;
}

function applyToDoc(doc, edits) {
  const sorted = [...edits].sort((a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start));
  for (const e of sorted) {
    const s = doc.offsetAt(e.range.start), en = doc.offsetAt(e.range.end);
    doc._text = doc._text.slice(0, s) + e.text + doc._text.slice(en);
  }
}

const config = { indentSize: 2, enable: true, lintOnType: true, delay: 0, hover: true, rules: {} };
const state = { diagnostics: new Map(), statusBar: null, messages: [], commands: {}, hover: null, actions: null, docs: [], activeEditor: undefined };

const vscode = {
  Position, Range, CodeActionKind, WorkspaceEdit, MarkdownString, Uri,
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CodeAction: class { constructor(title, kind) { this.title = title; this.kind = kind; } },
  Hover: class { constructor(c) { this.contents = c; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ProgressLocation: { Notification: 15 },
  EndOfLine: { LF: 1, CRLF: 2 },
  TextEdit: { replace: (range, text) => ({ range, text }) },
  languages: {
    createDiagnosticCollection: () => ({
      set: (uri, d) => state.diagnostics.set(uri.toString(), d), delete: (uri) => state.diagnostics.delete(uri.toString()), dispose() {},
    }),
    registerHoverProvider: (_s, p) => { state.hover = p; return { dispose() {} }; },
    registerCodeActionsProvider: (_s, p) => { state.actions = p; return { dispose() {} }; },
    registerDocumentFormattingEditProvider: (_s, p) => { state.formatter = p; return { dispose() {} }; },
  },
  window: {
    createOutputChannel: () => ({ lines: [], appendLine(s) { this.lines.push(s); }, clear() { this.lines = []; }, show() {}, dispose() {} }),
    createStatusBarItem: () => (state.statusBar = { text: '', visible: false, show() { this.visible = true; }, hide() { this.visible = false; }, dispose() {} }),
    get activeTextEditor() { return state.activeEditor; },
    showInformationMessage: async (m) => { state.messages.push(m); return undefined; },
    showWarningMessage: async (m) => { state.messages.push(m); return undefined; },
    showQuickPick: async (items) => state.quickPick ? state.quickPick(items) : undefined,
    showInputBox: async () => undefined,
    withProgress: async (_o, fn) => fn({ report() {} }),
    onDidChangeActiveTextEditor: on('activeEditor'),
  },
  workspace: {
    getConfiguration: () => ({
      get: (k, d) => (k in config ? config[k] : d),
      update: async (k, v) => { config[k] = v; fire('config', { affectsConfiguration: () => true }); },
    }),
    get textDocuments() { return state.docs; },
    workspaceFolders: [{ uri: Uri.file('/ws') }],
    asRelativePath: (uri) => uri.fsPath.replace(/^\/ws\//, ''),
    findFiles: async () => [],
    fs: { readFile: async (u) => fs.readFileSync(u.fsPath) },
    applyEdit: async (we) => { for (const e of we.edits) applyToDoc(state.docs.find((d) => d.uri.toString() === e.uri.toString()), [e]); return true; },
    openTextDocument: async (uri) => state.docs.find((d) => d.uri.toString() === uri.toString()),
    onDidOpenTextDocument: on('open'), onDidSaveTextDocument: on('save'), onDidChangeTextDocument: on('change'),
    onDidCloseTextDocument: on('close'), onWillSaveTextDocument: on('willSave'), onDidChangeConfiguration: on('config'),
  },
  commands: {
    registerCommand: (id, fn) => { state.commands[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...a) => {
      if (state.commands[id]) return state.commands[id](...a);
      if (id === 'vscode.executeDocumentRenameProvider') return undefined; // нет языкового сервера
      state.messages.push('exec:' + id);
    },
  },
};

function openEditor(doc) {
  state.docs.push(doc);
  state.activeEditor = {
    document: doc,
    edit: async (cb) => { const eds = []; cb({ replace: (range, text) => eds.push({ range, text }) }); applyToDoc(doc, eds); return true; },
  };
  fire('open', doc);
  fire('activeEditor', state.activeEditor);
}

module.exports = { vscode, state, config, makeDoc, openEditor, fire, applyToDoc };
