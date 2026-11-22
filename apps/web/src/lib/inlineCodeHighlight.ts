/*
 * Lightweight, synchronous lexical syntax highlighter for inline `<code>` chips
 * and non-destructive link class tagging inside rendered Rich HTML fragments.
 * Emits `.hljs-*` token spans matching IceHandnote's dual-theme `--code-syn-*` tokens.
 */

const INLINE_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'crate',
  'def',
  'default',
  'defer',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'finally',
  'fn',
  'for',
  'from',
  'func',
  'function',
  'if',
  'impl',
  'import',
  'in',
  'insert',
  'interface',
  'join',
  'keyof',
  'lambda',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'new',
  'of',
  'package',
  'pub',
  'readonly',
  'ref',
  'return',
  'select',
  'static',
  'struct',
  'switch',
  'throw',
  'trait',
  'try',
  'type',
  'typeof',
  'update',
  'use',
  'var',
  'void',
  'where',
  'while',
  'yield',
]);

const INLINE_LITERALS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'None',
  'Some',
  'Ok',
  'Err',
  'self',
  'Self',
  'this',
  'super',
]);

const CLI_COMMANDS = new Set([
  'cargo',
  'pnpm',
  'npm',
  'npx',
  'yarn',
  'bun',
  'git',
  'docker',
  'kubectl',
  'python',
  'pip',
  'uv',
  'rustc',
  'rustup',
  'go',
  'curl',
  'ssh',
  'echo',
  'rg',
  'grep',
  'vite',
  'tsc',
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function span(cls: string | null, rawText: string): string {
  const safe = escapeHtml(rawText);
  return cls ? `<span class="${cls}">${safe}</span>` : safe;
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_$]/.test(ch);
}

function isIdentChar(ch: string): boolean {
  return /[a-zA-Z0-9_$-]/.test(ch);
}

function highlightMarkupTag(src: string): string | null {
  const m = src.match(/^(\s*)(<\/?)([a-zA-Z][a-zA-Z0-9.:-]*)([\s\S]*?)(\/?>)(\s*)$/);
  if (!m) return null;
  const [, lead, openBracket, tagName, attrsRaw, closeBracket, tail] = m;

  // Avoid misclassifying generic comparisons like `<T extends U>` unless it is HTML/JSX markup
  if (attrsRaw.includes('<') && !attrsRaw.includes('{')) return null;

  const isComponent = /^[A-Z]/.test(tagName) || tagName.includes('.');
  let out =
    escapeHtml(lead) +
    span('hljs-punctuation', openBracket) +
    span(isComponent ? 'hljs-type' : 'hljs-name', tagName);

  let i = 0;
  while (i < attrsRaw.length) {
    const ch = attrsRaw[i];
    if (/\s/.test(ch)) {
      const wsEnd = i + (attrsRaw.slice(i).match(/^\s+/)?.[0].length ?? 1);
      out += escapeHtml(attrsRaw.slice(i, wsEnd));
      i = wsEnd;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < attrsRaw.length && attrsRaw[j] !== ch) {
        if (attrsRaw[j] === '\\') j += 1;
        j += 1;
      }
      if (j < attrsRaw.length) j += 1;
      out += span('hljs-string', attrsRaw.slice(i, j));
      i = j;
      continue;
    }

    if (ch === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < attrsRaw.length && depth > 0) {
        if (attrsRaw[j] === '{') depth += 1;
        else if (attrsRaw[j] === '}') depth -= 1;
        j += 1;
      }
      const hasClose = depth === 0;
      const inner = attrsRaw.slice(i + 1, hasClose ? j - 1 : j);
      out += span('hljs-punctuation', '{') + scanGeneralInlineCode(inner);
      if (hasClose) out += span('hljs-punctuation', '}');
      i = j;
      continue;
    }

    if (ch === '=') {
      out += span('hljs-operator', '=');
      i += 1;
      continue;
    }

    if (/[a-zA-Z_@:]/.test(ch)) {
      const attrMatch = attrsRaw.slice(i).match(/^[a-zA-Z_@:][a-zA-Z0-9_.:-]*/);
      if (attrMatch) {
        out += span('hljs-attr', attrMatch[0]);
        i += attrMatch[0].length;
        continue;
      }
    }

    out += span('hljs-punctuation', ch);
    i += 1;
  }

  return out + span('hljs-punctuation', closeBracket) + escapeHtml(tail);
}

function highlightPathOrFile(src: string): string | null {
  const m = src.match(/^(\s*)([^\s]+)(\s*)$/);
  if (!m) return null;
  const [, lead, token, tail] = m;

  // Do not hijack URLs/JS expressions containing quotes or parentheses
  if (/[()"'`=<>!;,?*&|]/.test(token)) return null;

  const isSlashPath = token.includes('/') || token.includes('\\');
  const fileLineMatch = token.match(
    /^([a-zA-Z0-9_.*@/\\-]+?)\.([a-zA-Z0-9]{1,8})(?::(\d+(?:[-–]\d+)?))?$/,
  );

  if (!isSlashPath && !fileLineMatch) return null;

  let out = escapeHtml(lead);
  if (isSlashPath) {
    const parts = token.split(/([/\\])/);
    for (let idx = 0; idx < parts.length; idx += 1) {
      const part = parts[idx];
      if (!part) continue;
      if (part === '/' || part === '\\') {
        out += span('hljs-punctuation', part);
        continue;
      }
      const isLast = idx === parts.length - 1;
      if (!isLast) {
        out += span('hljs-attr', part);
      } else {
        const lastFile = part.match(/^(.+?)\.([a-zA-Z0-9]{1,8})(?::(\d+(?:[-–]\d+)?))?$/);
        if (lastFile) {
          out +=
            span('hljs-title', lastFile[1]) +
            span('hljs-punctuation', '.') +
            span('hljs-type', lastFile[2]);
          if (lastFile[3]) {
            out += span('hljs-punctuation', ':') + span('hljs-number', lastFile[3]);
          }
        } else if (part.includes(':')) {
          const [name, line] = part.split(':', 2);
          out += span('hljs-title', name) + span('hljs-punctuation', ':');
          out += /^\d/.test(line) ? span('hljs-number', line) : span('hljs-title', line);
        } else {
          out += span('hljs-title', part);
        }
      }
    }
    return out + escapeHtml(tail);
  }

  if (fileLineMatch) {
    const [, stem, ext, line] = fileLineMatch;
    out +=
      span('hljs-title', stem) +
      span('hljs-punctuation', '.') +
      span('hljs-type', ext);
    if (line) {
      out += span('hljs-punctuation', ':') + span('hljs-number', line);
    }
    return out + escapeHtml(tail);
  }

  return null;
}

function highlightIdentifier(ident: string, opts: {
  atStatementStart: boolean;
  followedBySpace: boolean;
  followedByCall: boolean;
  followedByBangCall: boolean;
  followedByKeyAssign: boolean;
  standaloneSingleToken: boolean;
}): string {
  if (opts.followedByBangCall) {
    return span('hljs-meta', ident);
  }
  if (INLINE_KEYWORDS.has(ident)) {
    return span('hljs-keyword', ident);
  }
  if (INLINE_LITERALS.has(ident)) {
    return span('hljs-literal', ident);
  }
  if (opts.atStatementStart && opts.followedBySpace && CLI_COMMANDS.has(ident)) {
    return span('hljs-title', ident);
  }
  if (opts.followedByCall) {
    return span('hljs-title', ident);
  }
  if (opts.followedByKeyAssign) {
    return span('hljs-attr', ident);
  }
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(ident)) {
    return span('hljs-meta', ident);
  }
  if (/^[A-Z][a-zA-Z0-9]*$/.test(ident)) {
    return span('hljs-type', ident);
  }
  if (ident.includes('_')) {
    const pieces = ident.split(/(_+)/);
    return pieces
      .filter(Boolean)
      .map((p) => (p.startsWith('_') ? span('hljs-punctuation', p) : span('hljs-title', p)))
      .join('');
  }
  if (ident.includes('-')) {
    const pieces = ident.split(/(-)/);
    return pieces
      .filter(Boolean)
      .map((p) => {
        if (p === '-') return span('hljs-punctuation', p);
        if (/^\d+$/.test(p)) return span('hljs-number', p);
        return span('hljs-attr', p);
      })
      .join('');
  }
  if (opts.standaloneSingleToken) {
    return span('hljs-keyword', ident);
  }
  return span(null, ident);
}

function scanGeneralInlineCode(raw: string): string {
  const trimmed = raw.trim();
  const isSingleBareToken =
    trimmed.length > 0 &&
    !/\s/.test(trimmed) &&
    /^[a-zA-Z0-9_$-]+$/.test(trimmed);

  let out = '';
  let i = 0;

  while (i < raw.length) {
    const rest = raw.slice(i);
    const ch = raw[i];

    // Whitespace
    if (/\s/.test(ch)) {
      const ws = rest.match(/^\s+/)?.[0] ?? ch;
      out += escapeHtml(ws);
      i += ws.length;
      continue;
    }

    // Comments (//... or /*...*/)
    if (rest.startsWith('//')) {
      out += span('hljs-comment', rest);
      break;
    }
    if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/', 2);
      const commentSlice = end !== -1 ? rest.slice(0, end + 2) : rest;
      out += span('hljs-comment', commentSlice);
      i += commentSlice.length;
      continue;
    }

    // Quoted strings ("...", '...', `...`)
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = 1;
      while (j < rest.length && rest[j] !== ch) {
        if (rest[j] === '\\') j += 1;
        j += 1;
      }
      if (j < rest.length) j += 1;
      const strSlice = rest.slice(0, j);
      out += span('hljs-string', strSlice);
      i += strSlice.length;
      continue;
    }

    // CSS custom properties (--var) & CLI flags (--flag / -f)
    if (ch === '-') {
      const flagOrCssVar = rest.match(/^--?[a-zA-Z0-9][a-zA-Z0-9_*-]*/);
      const prevChar = i > 0 ? raw[i - 1] : '';
      if (
        flagOrCssVar &&
        (rest.startsWith('--') || i === 0 || /[\s([,=]/.test(prevChar))
      ) {
        out += span('hljs-attr', flagOrCssVar[0]);
        i += flagOrCssVar[0].length;
        continue;
      }
    }

    // Hex colors (#fffffa, #222435)
    if (ch === '#') {
      const hexMatch = rest.match(/^#[0-9a-fA-F]{3,8}\b/);
      if (hexMatch) {
        out += span('hljs-number', hexMatch[0]);
        i += hexMatch[0].length;
        continue;
      }
      const attrMacro = rest.match(/^#!?\[[^\]]*\]/);
      if (attrMacro) {
        out += span('hljs-meta', attrMacro[0]);
        i += attrMacro[0].length;
        continue;
      }
    }

    // Rust / Python decorators (@decorator) & CSS pseudo-classes (:hover, ::after)
    if (ch === '@') {
      const decMatch = rest.match(/^@[a-zA-Z_][\w-]*/);
      if (decMatch) {
        out += span('hljs-meta', decMatch[0]);
        i += decMatch[0].length;
        continue;
      }
    }
    if (ch === ':' && (i === 0 || !isIdentChar(raw[i - 1]))) {
      const pseudoMatch = rest.match(/^::?[a-zA-Z][a-zA-Z0-9-]*/);
      if (pseudoMatch) {
        out += span('hljs-meta', pseudoMatch[0]);
        i += pseudoMatch[0].length;
        continue;
      }
    }

    // Numeric literals, semver, CSS units
    const numMatch = rest.match(
      /^(?:v?\d+(?:\.\d+)*(?:px|rem|em|d?vh|d?vw|ms|s|%|deg|ch|fr|kB|MB|GB)?\b|0x[0-9a-fA-F_]+\b)/,
    );
    if (numMatch && (i === 0 || !isIdentChar(raw[i - 1]))) {
      out += span('hljs-number', numMatch[0]);
      i += numMatch[0].length;
      continue;
    }

    // Identifiers, keywords, calls, snake_case, kebab-case
    if (isIdentStart(ch)) {
      const idMatch = rest.match(/^[a-zA-Z_$][a-zA-Z0-9_$]*(?:-[a-zA-Z0-9_$]+)*/);
      if (idMatch) {
        const ident = idMatch[0];
        const after = raw.slice(i + ident.length);
        const beforeTrimmed = raw.slice(0, i).trim();

        const followedByBangCall = /^!\s*[([{]/.test(after);
        const followedByCall = /^\s*\(/.test(after);
        const followedByKeyAssign =
          /^\s*(?::(?!:)|=(?![=>]))/.test(after) &&
          (beforeTrimmed === '' || /[,{;]$/.test(beforeTrimmed));
        const followedBySpace = /^\s+\S/.test(after);

        out += highlightIdentifier(ident, {
          atStatementStart: beforeTrimmed.length === 0,
          followedBySpace,
          followedByCall,
          followedByBangCall,
          followedByKeyAssign,
          standaloneSingleToken: isSingleBareToken,
        });
        i += ident.length;
        continue;
      }
    }

    // Multi-char operators & punctuation
    const opMatch = rest.match(/^(?:===|!==|=>|->|::|&&|\|\||<=|>=|==|!=|\.\.\.?)/);
    if (opMatch) {
      out += span('hljs-punctuation', opMatch[0]);
      i += opMatch[0].length;
      continue;
    }

    if (/[()[\]{}.,:;?!+\-*/%=&|^~<>]/.test(ch)) {
      out += span('hljs-punctuation', ch);
      i += 1;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}

/**
 * Highlights a short inline code string into safe HTML containing `.hljs-*` spans.
 */
export function highlightInlineCodeHtml(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return escapeHtml(raw);

  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    const tagResult = highlightMarkupTag(raw);
    if (tagResult) return tagResult;
  }

  const pathResult = highlightPathOrFile(raw);
  if (pathResult) return pathResult;

  return scanGeneralInlineCode(raw);
}

export type RichLinkVariant = 'prose' | 'chrome';

/**
 * Enhances sanitized rich HTML containers with inline code syntax tokens and
 * explicit link-variant hooks (`.ink-inline-link` for editorial prose or
 * `.ink-chrome-link` for understated UI chrome such as custom footers).
 */
export function enhanceRichHtmlElement(
  root: ParentNode,
  opts?: {
    skipActiveSelectionIn?: HTMLElement | null;
    linkVariant?: RichLinkVariant;
  },
): void {
  const activeSel =
    opts?.skipActiveSelectionIn && typeof window !== 'undefined'
      ? window.getSelection()
      : null;

  root.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.closest('pre') || codeEl.querySelector('kbd, .ink-kbd-combo')) {
      return;
    }
    if (
      activeSel &&
      activeSel.rangeCount > 0 &&
      codeEl.contains(activeSel.getRangeAt(0).commonAncestorContainer)
    ) {
      return;
    }
    codeEl.classList.add('ink-inline-code');
    const plain = codeEl.textContent ?? '';
    const highlighted = highlightInlineCodeHtml(plain);
    if (codeEl.innerHTML !== highlighted) {
      codeEl.innerHTML = highlighted;
    }
  });

  const linkVariant = opts?.linkVariant ?? 'prose';
  root.querySelectorAll('a[href]').forEach((anchorEl) => {
    if (linkVariant === 'chrome') {
      anchorEl.classList.remove('ink-inline-link');
      anchorEl.classList.add('ink-chrome-link');
    } else {
      anchorEl.classList.remove('ink-chrome-link');
      if (!anchorEl.classList.contains('ink-inline-link')) {
        anchorEl.classList.add('ink-inline-link');
      }
    }
  });
}
