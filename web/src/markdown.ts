import { marked } from 'marked';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// O conteúdo vem do assistente ou do vault: HTML cru é exibido como texto, não interpretado.
marked.use({ renderer: { html: ({ text }) => escape(text) } });

const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

/** Separa o frontmatter YAML (mostrado como uma tabelinha discreta) do corpo. */
function splitFrontmatter(md: string): { meta: [string, string][]; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: [], body: md };
  const meta = m[1]
    .split(/\r?\n/)
    .map((l) => l.match(/^([^:#]+):\s*(.*)$/))
    .filter((x): x is RegExpMatchArray => !!x)
    .map((x) => [x[1].trim(), x[2].trim()] as [string, string]);
  return { meta, body: md.slice(m[0].length) };
}

/**
 * Markdown → HTML, com [[wikilinks]] virando links clicáveis.
 * `exists` diz se o alvo existe (links quebrados ficam com outro estilo).
 */
export function renderMarkdown(md: string, exists: (target: string) => boolean = () => true): string {
  const { meta, body } = splitFrontmatter(md);
  const link = (target: string) => {
    const label = target.split('|')[1] ?? target.split('|')[0];
    const cls = exists(target) ? 'wikilink' : 'wikilink broken';
    return `<a href="#" class="${cls}" data-wikilink="${escape(target)}">${escape(label)}</a>`;
  };

  // os links viram marcadores antes do marked (que escaparia o HTML) e voltam depois
  const links: string[] = [];
  const marked_ = body.replace(WIKILINK, (_, target: string) => {
    links.push(link(target));
    return `@@WL${links.length - 1}@@`;
  });
  const html = (marked.parse(marked_, { async: false }) as string).replace(/@@WL(\d+)@@/g, (_, i) => links[Number(i)]);

  const metaHtml = meta.length
    ? `<table class="frontmatter">${meta
        .map(([k, v]) => `<tr><th>${escape(k)}</th><td>${escape(v).replace(WIKILINK, (_, t: string) => link(t))}</td></tr>`)
        .join('')}</table>`
    : '';
  return metaHtml + html;
}
