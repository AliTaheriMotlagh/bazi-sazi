import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import guide from '../../../../docs/GUIDE.md?raw';
import { SiteNav } from './SiteNav';

/**
 * Renders docs/GUIDE.md (single source of truth for the guide). A tiny,
 * dependency-free Markdown subset: headings, lists, code, tables, quotes,
 * bold/italic/code spans and links — built as React nodes (no innerHTML).
 */
type Block =
  | { kind: 'h'; level: number; text: string; id: string }
  | { kind: 'p' | 'quote'; text: string }
  | { kind: 'ol' | 'ul'; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] };

const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

function parse(md: string): Block[] {
  const lines = md.split('\n');
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      out.push({ kind: 'h', level: h[1].length, text: h[2], id: slug(h[2]) });
      continue;
    }
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i].replace(/^ {5}/, ''));
      out.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) if (!/^\|[-|\s]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
      i--;
      out.push({ kind: 'table', rows });
      continue;
    }
    const ordered = /^\d+\.\s/.test(line);
    if (ordered || /^-\s/.test(line)) {
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (/^(\d+\.|-)\s/.test(l)) items.push(l.replace(/^(\d+\.|-)\s+/, ''));
        else if (/^\s{2,}\S/.test(l) && !l.trim().startsWith('```') && items.length) items[items.length - 1] += `\n${l.trim()}`;
        else if (l.trim().startsWith('```') && items.length) {
          const code: string[] = [];
          while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i].trim());
          items[items.length - 1] += `\n\u0000${code.join('\n')}`;
        } else break;
      }
      i--;
      out.push({ kind: ordered ? 'ol' : 'ul', items });
      continue;
    }
    if (line.startsWith('>')) {
      out.push({ kind: 'quote', text: line.replace(/^>\s?/, '') });
      continue;
    }
    out.push({ kind: 'p', text: line });
  }
  return out;
}

/** Inline: **bold**, *italic*, `code`, [text](url). */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) nodes.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) nodes.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      nodes.push(/^https?:/.test(href) ? <a key={k++} href={href} target="_blank" rel="noopener">{label}</a> : <Link key={k++} to={href}>{label}</Link>);
    } else nodes.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Item({ text }: { text: string }) {
  const [main, code] = text.split('\u0000');
  return (
    <li>
      {main.split('\n').map((l, i) => (
        <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>
      ))}
      {code && <pre><code>{code}</code></pre>}
    </li>
  );
}

export function LearnPage() {
  const blocks = useMemo(() => parse(guide), []);
  const toc = blocks.filter((b): b is Extract<Block, { kind: 'h' }> => b.kind === 'h' && b.level === 2);
  return (
    <div className="site">
      <SiteNav />
      <div className="learn">
        <aside className="learn-toc" aria-label="Contents">
          <b>Guide</b>
          {toc.map((h) => (
            <a key={h.id} href={`#${h.id}`}>{h.text}</a>
          ))}
          <Link className="btn primary" to="/" style={{ marginTop: 12 }}>Start building</Link>
        </aside>
        <article className="learn-body">
          {blocks.map((b, i) => {
            switch (b.kind) {
              case 'h': {
                const Tag = `h${b.level}` as 'h2';
                return <Tag key={i} id={b.id}>{inline(b.text)}</Tag>;
              }
              case 'p':
                return <p key={i}>{inline(b.text)}</p>;
              case 'quote':
                return <blockquote key={i}>{inline(b.text)}</blockquote>;
              case 'code':
                return <pre key={i}><code>{b.text}</code></pre>;
              case 'ol':
                return <ol key={i}>{b.items.map((t, j) => <Item key={j} text={t} />)}</ol>;
              case 'ul':
                return <ul key={i}>{b.items.map((t, j) => <Item key={j} text={t} />)}</ul>;
              case 'table':
                return (
                  <table key={i}>
                    <thead><tr>{b.rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                    <tbody>{b.rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x}>{inline(c)}</td>)}</tr>)}</tbody>
                  </table>
                );
            }
          })}
        </article>
      </div>
    </div>
  );
}
