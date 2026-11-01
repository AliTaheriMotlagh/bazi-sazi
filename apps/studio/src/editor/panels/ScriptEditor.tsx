import MonacoEditor, { loader, type OnMount } from '@monaco-editor/react';
import { compileScript, SCRIPT_API_DTS } from '@bazi/engine';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';
import { useEffect, useMemo, useRef } from 'react';
import { newScript, updateScript } from '../../store/commands';
import { editor, useEditor } from '../../store/editor';
import { useUi } from '../../store/ui';
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

/** Full-size code editor for one script (opened as a document tab). */
export default function ScriptEditor({ id }: { id: string }) {
  const script = useEditor((s) => s.project?.scripts.find((x) => x.id === id));
  const theme = useUi((s) => s.theme);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
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
    <div className="col" style={{ height: '100%', gap: 0 }}>
      <div className="row" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 6 }}>
        <span className="doc-title"><Icon name="FileCode" size={14} /> {script.name}</span>
        <select className="select" style={{ width: 120 }} value={script.language} onChange={(e) => updateScript(script.id, { language: e.target.value as 'javascript' | 'typescript' })} aria-label="Language">
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
        </select>
        {error ? (
          <span className="badge error" title={error}><Icon name="CircleAlert" size={12} /> {error.slice(0, 60)}</span>
        ) : (
          <span className="badge" style={{ color: 'var(--success)' }}><Icon name="Check" size={12} /> OK</span>
        )}
        <span className="spacer" />
        <button className="btn sm" onClick={() => aiAction('explain')}><Icon name="Bot" size={13} /> Explain</button>
        <button className="btn sm" onClick={() => aiAction('fix')}><Icon name="WandSparkles" size={13} /> Fix</button>
        <button className="btn sm hide-phone" onClick={() => aiAction('improve')}><Icon name="Sparkles" size={13} /> Improve</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
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
            fontSize: 13,
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
      <ExternalSync id={script.id} code={script.code} editorRef={editorRef} />
    </div>
  );
}

/** Push changes made outside Monaco (undo, AI edits) into the open editor. */
function ExternalSync({ id, code, editorRef }: { id: string; code: string; editorRef: React.RefObject<Parameters<OnMount>[0] | null> }) {
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getValue() !== code) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: code }], () => null);
  }, [id, code, editorRef]);
  return null;
}
