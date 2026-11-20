/*
 * Synchronous, tree-shaken syntax highlighter powered by `highlight.js/lib/core`.
 * - Registers only curated tutorial languages (~16 grammars) for tiny bundle size and zero async flicker.
 * - Splits multi-line `<span class="hljs-*">` blocks across line breaks with balanced tag stacks so
 *   per-line numbers, hover highlights, and diff tinting never break multi-line comments or strings.
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('rust', rust);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('go', go);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('markdown', markdown);

const LANGUAGE_ALIASES: Record<string, string> = {
  rs: 'rust',
  rust: 'rust',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
  java: 'java',
  sql: 'sql',
  pgsql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  toml: 'ini',
  ini: 'ini',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  bash: 'bash',
  console: 'bash',
  css: 'css',
  scss: 'css',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  go: 'go',
  golang: 'go',
  c: 'cpp',
  cc: 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  cpp: 'cpp',
  'c++': 'cpp',
  diff: 'diff',
  patch: 'diff',
  md: 'markdown',
  markdown: 'markdown',
};

const DISPLAY_LABELS: Record<string, string> = {
  rust: 'Rust',
  rs: 'Rust',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  tsx: 'TSX',
  javascript: 'JavaScript',
  js: 'JavaScript',
  jsx: 'JSX',
  python: 'Python',
  py: 'Python',
  java: 'Java',
  sql: 'SQL',
  toml: 'TOML',
  ini: 'INI',
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  go: 'Go',
  c: 'C',
  cpp: 'C++',
  diff: 'Diff',
  markdown: 'Markdown',
  md: 'Markdown',
  text: 'Plain Text',
  plaintext: 'Plain Text',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Splits highlight.js HTML into per-line HTML fragments while balancing any
 * `<span class="hljs-...">` tags that span multiple lines (e.g. block comments or multi-line strings).
 */
function splitHighlightedHtmlByLines(html: string): string[] {
  const rawLines = html.split('\n');
  const openTags: string[] = [];
  const balancedLines: string[] = [];
  const tagRegex = /<\/?span(?:\s+[^>]*)?>/g;

  for (const rawLine of rawLines) {
    const prefix = openTags.join('');
    let match: RegExpExecArray | null;
    tagRegex.lastIndex = 0;

    while ((match = tagRegex.exec(rawLine)) !== null) {
      const tag = match[0];
      if (tag.startsWith('</')) {
        openTags.pop();
      } else {
        openTags.push(tag);
      }
    }

    const suffix = '</span>'.repeat(openTags.length);
    balancedLines.push(`${prefix}${rawLine}${suffix}`);
  }

  return balancedLines;
}

export interface HighlightedCodeLine {
  html: string;
  diffKind?: 'added' | 'removed';
}

export function getLanguageDisplayLabel(language: string): string {
  const key = language.trim().toLowerCase();
  return DISPLAY_LABELS[key] ?? (key ? key.toUpperCase() : 'TEXT');
}

export function highlightCodeToLines(
  code: string,
  language: string,
): HighlightedCodeLine[] {
  const normalizedRaw = language.trim().toLowerCase();
  const hljsLang = LANGUAGE_ALIASES[normalizedRaw];
  const rawLines = code.split('\n');

  let highlightedHtml: string;
  if (hljsLang && hljs.getLanguage(hljsLang)) {
    try {
      highlightedHtml = hljs.highlight(code, {
        language: hljsLang,
        ignoreIllegals: true,
      }).value;
    } catch {
      highlightedHtml = escapeHtml(code);
    }
  } else {
    highlightedHtml = escapeHtml(code);
  }

  const lineHtmls = splitHighlightedHtmlByLines(highlightedHtml);
  const isDiff = hljsLang === 'diff';

  return rawLines.map((rawLine, idx) => {
    let diffKind: 'added' | 'removed' | undefined;
    if (isDiff) {
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        diffKind = 'added';
      } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        diffKind = 'removed';
      }
    }
    return {
      html: lineHtmls[idx] ?? '',
      diffKind,
    };
  });
}
