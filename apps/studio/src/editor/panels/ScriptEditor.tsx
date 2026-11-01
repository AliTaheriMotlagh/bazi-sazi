import MonacoEditor, { loader, type OnMount } from '@monaco-editor/react';
import { compileScript, SCRIPT_API_DTS } from '@bazi/engine';
import * as monaco from '../monacoSlim';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { useEffect, useMemo, useRef } from 'react';
import { newScript, updateScript } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { useUi } from '../../store/ui';
import { useMedia } from '../../ui/hooks';
import { Icon } from '../../ui/Icon';
import { askAi } from '../ai/AiPanel';

// Bundle Monaco locally (no CDN) so the studio works offline / behind firewalls.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker()),
};
loader.config({ monaco });

let configured = false;
function configure(m: typeof monaco): void {
  if (configured) return;
  configured = true;
  // The script API as ambient declarations => autocomplete + hover docs.
  for (const defaults of [m.typescript.javascriptDefaults, m.typescript.typescriptDefaults]) {
    defaults.addExtraLib(SCRIPT_API_DTS, 'file:///bazi-script-api.d.ts');
    defaults.setCompilerOptions({ target: m.typescript.ScriptTarget.ESNext, allowNonTsExtensions: true, checkJs: true, noLib: false, lib: ['es2022'] });
    defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [2393, 2451, 6133, 7027, 1375, 1378, 2304] });
  }
}

type CodeEditor = Parameters<OnMount>[0];

/** Characters that are slow to find on a phone keyboard. Tapping inserts them without closing the keyboard. */
export const QUICK_KEYS: { label: string; text: string; aria: string }[] = [
  { label: '→', text: '\t', aria: 'Tab' },
  { label: '{ }', text: '{}', aria: 'Curly braces' },
  { label: '( )', text: '()', aria: 'Parentheses' },
  { label: '[ ]', text: '[]', aria: 'Square brackets' },
  { label: ';', text: ';', aria: 'Semicolon' },
  { label: '.', text: '.', aria: 'Dot' },
  { label: '=', text: '=', aria: 'Equals' },
  { label: '=>', text: '=>', aria: 'Arrow' },
  { label: '"', text: '"', aria: 'Double quote' },
  { label: "'", text: "'", aria: 'Single quote' },
  { label: '`', text: '`', aria: 'Backtick' },
  { label: '<', text: '<', aria: 'Less than' },
  { label: '>', text: '>', aria: 'Greater than' },
  { label: '!', text: '!', aria: 'Exclamation' },
  { label: '&&', text: '&&', aria: 'And' },
  { label: '||', text: '||', aria: 'Or' },
];

/** Phone-only key row. pointerdown is cancelled so the editor keeps focus (and the keyboard stays up). */
function QuickKeys({ editorRef }: { editorRef: React.RefObject<CodeEditor | null> }) {
  const run = (fn: (ed: CodeEditor) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    fn(ed);
  };
  return (
    <div className="code-keys" role="toolbar" aria-label="Code shortcuts">
      <button onPointerDown={run((ed) => ed.trigger('keys', 'undo', null))} aria-label="Undo"><Icon name="Undo2" size={16} /></button>
      <button onPointerDown={run((ed) => ed.trigger('keys', 'redo', null))} aria-label="Redo"><Icon name="Redo2" size={16} /></button>
      <button onPointerDown={run((ed) => ed.trigger('keys', 'editor.action.triggerSuggest', null))} aria-label="Suggestions"><Icon name="Sparkles" size={16} /></button>
      {QUICK_KEYS.map((k) => (
        <button
          key={k.aria}
          aria-label={k.aria}
          onPointerDown={run((ed) => {
            if (k.text === '\t') return void ed.trigger('keys', 'tab', null);
            ed.trigger('keys', 'type', { text: k.text });
            // For pairs, leave the cursor between the brackets.
            if (k.text.length === 2 && /^[{([]/.test(k.text)) ed.trigger('keys', 'cursorLeft', null);
          })}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

/** Full-size code editor for one script (opened as a document tab). */
export default function ScriptEditor({ id }: { id: string }) {
  const script = useEditor((s) => s.project?.scripts.find((x) => x.id === id));
  const theme = useUi((s) => s.theme);
  const editorRef = useRef<CodeEditor | null>(null);
  const phone = useMedia('(max-width: 720px)');
  const error = useMemo(() => (script ? compileScript(script).error : null), [script]);

  if (!script)
    return (
      <div className="empty">
        <p>No scripts yet.</p>
        <button className="btn primary" onClick={() => newScript('Game Script', { attachTo: editor().selection[0] })}>
          <Icon name="Plus" size={14} /> Create a script
        </button>
      </div>
    );

  const aiAction = (kind: 'explain' | 'fix' | 'improve') => {
    const code = editorRef.current?.getModel()?.getValue() ?? script.code;
    const prompts = {
      explain: `Explain what the script "${script.name}" does, simply, for a beginner:\n\n${code}`,
      fix: `The script "${script.name}" has a problem${error ? ` (${error})` : ''}. Find and fix bugs, then save it with write_script.\n\n${code}`,
      improve: `Improve the script "${script.name}" (clarity, game feel, comments for beginners) and save it with write_script.\n\n${code}`,
    };
    askAi(prompts[kind]);
  };

  return (
    <div className="col" style={{ height: '100%', gap: 0, minWidth: 0, overflow: 'hidden' }}>
      <div className="script-bar">
        <span className="doc-title truncate"><Icon name="FileCode" size={14} /> {script.name}</span>
        <select className="select hide-phone" style={{ width: 120 }} value={script.language} onChange={(e) => updateScript(script.id, { language: e.target.value as 'javascript' | 'typescript' })} aria-label="Language">
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
        </select>
        {error ? (
          <span className="badge error script-status" title={error}><Icon name="CircleAlert" size={12} /> <span className="truncate">{error.slice(0, 60)}</span></span>
        ) : (
          <span className="badge script-status" style={{ color: 'var(--success)' }} title="No problems found"><Icon name="Check" size={12} /> <span className="hide-phone">OK</span></span>
        )}
        <span className="spacer" />
        <button className="btn sm" onClick={() => aiAction('explain')} aria-label="Explain this script with AI"><Icon name="Bot" size={13} /> <span className="hide-phone">Explain</span></button>
        <button className="btn sm" onClick={() => aiAction('fix')} aria-label="Fix this script with AI"><Icon name="WandSparkles" size={13} /> <span className="hide-phone">Fix</span></button>
        <button className="btn sm hide-phone" onClick={() => aiAction('improve')}><Icon name="Sparkles" size={13} /> Improve</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
        <MonacoEditor
          key={script.id}
          path={`file:///scripts/${script.id}.${script.language === 'typescript' ? 'ts' : 'js'}`}
          language={script.language}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          defaultValue={script.code}
          beforeMount={configure}
          onMount={(ed) => {
            editorRef.current = ed;
          }}
          onChange={(value) => {
            if (value !== undefined && value !== editor().project?.scripts.find((s) => s.id === script.id)?.code) updateScript(script.id, { code: value });
          }}
          options={{
            fontSize: phone ? 14 : 13,
            ...(phone ? PHONE_OPTIONS : {}),
            fontFamily: 'JetBrains Mono, SF Mono, Menlo, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            automaticLayout: true,
            fixedOverflowWidgets: true,
            wordWrap: 'on',
            padding: { top: 8 },
          }}
        />
      </div>
      {phone && <QuickKeys editorRef={editorRef} />}
      <ExternalSync id={script.id} code={script.code} editorRef={editorRef} />
    </div>
  );
}

/** Monaco tuned for a small touch screen: no gutters, no hover popups, gentle scrollbars, taller suggestions. */
const PHONE_OPTIONS = {
  lineNumbers: 'off' as const,
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 8,
  lineNumbersMinChars: 0,
  renderLineHighlight: 'none' as const,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  scrollbar: { vertical: 'auto' as const, horizontal: 'hidden' as const, verticalScrollbarSize: 6, useShadows: false },
  contextmenu: false,
  hover: { enabled: 'off' as const },
  occurrencesHighlight: 'off' as const,
  selectionHighlight: false,
  matchBrackets: 'near' as const,
  stickyScroll: { enabled: false },
  parameterHints: { enabled: true },
  quickSuggestions: { other: true, comments: false, strings: false },
  suggest: { showStatusBar: false, preview: false, showIcons: false },
  suggestOnTriggerCharacters: true,
  mouseWheelZoom: false,
  dragAndDrop: false,
  accessibilitySupport: 'auto' as const,
};

/** Push changes made outside Monaco (undo, AI edits) into the open editor. */
function ExternalSync({ id, code, editorRef }: { id: string; code: string; editorRef: React.RefObject<CodeEditor | null> }) {
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== code) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
  }, [id, code, editorRef]);
  return null;
}
