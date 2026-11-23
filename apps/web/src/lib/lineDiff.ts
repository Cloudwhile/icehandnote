import type { DiffLineDto } from './types';

function splitNormalizedLines(raw: string): string[] {
  if (!raw) return [];
  return raw.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * Line-level LCS diff mirroring backend `compute_line_diff_ops`:
 * trims unchanged prefix/suffix lines first and guards huge quadratic matrices.
 */
export function computeClientLineDiff(oldText: string, newText: string): DiffLineDto[] {
  const oldLines = splitNormalizedLines(oldText);
  const newLines = splitNormalizedLines(newText);

  let prefix = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = Math.min(oldLines.length - prefix, newLines.length - prefix);
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const out: DiffLineDto[] = [];
  for (let i = 0; i < prefix; i++) {
    out.push({
      op: 'equal',
      left_line: i + 1,
      right_line: i + 1,
      text: oldLines[i],
    });
  }

  const midOld = oldLines.slice(prefix, oldLines.length - suffix);
  const midNew = newLines.slice(prefix, newLines.length - suffix);
  const n = midOld.length;
  const m = midNew.length;

  if (n === 0) {
    for (let j = 0; j < m; j++) {
      out.push({
        op: 'insert',
        left_line: null,
        right_line: prefix + j + 1,
        text: midNew[j],
      });
    }
  } else if (m === 0) {
    for (let i = 0; i < n; i++) {
      out.push({
        op: 'delete',
        left_line: prefix + i + 1,
        right_line: null,
        text: midOld[i],
      });
    }
  } else if (n * m > 1_000_000) {
    for (let i = 0; i < n; i++) {
      out.push({
        op: 'delete',
        left_line: prefix + i + 1,
        right_line: null,
        text: midOld[i],
      });
    }
    for (let j = 0; j < m; j++) {
      out.push({
        op: 'insert',
        left_line: null,
        right_line: prefix + j + 1,
        text: midNew[j],
      });
    }
  } else {
    const cols = m + 1;
    const dp = new Uint32Array((n + 1) * cols);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * cols + j] =
          midOld[i] === midNew[j]
            ? dp[(i + 1) * cols + (j + 1)] + 1
            : Math.max(dp[(i + 1) * cols + j], dp[i * cols + (j + 1)]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midOld[i] === midNew[j]) {
        out.push({
          op: 'equal',
          left_line: prefix + i + 1,
          right_line: prefix + j + 1,
          text: midOld[i],
        });
        i++;
        j++;
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + (j + 1)]) {
        out.push({
          op: 'delete',
          left_line: prefix + i + 1,
          right_line: null,
          text: midOld[i],
        });
        i++;
      } else {
        out.push({
          op: 'insert',
          left_line: null,
          right_line: prefix + j + 1,
          text: midNew[j],
        });
        j++;
      }
    }
    while (i < n) {
      out.push({
        op: 'delete',
        left_line: prefix + i + 1,
        right_line: null,
        text: midOld[i],
      });
      i++;
    }
    while (j < m) {
      out.push({
        op: 'insert',
        left_line: null,
        right_line: prefix + j + 1,
        text: midNew[j],
      });
      j++;
    }
  }

  for (let k = 0; k < suffix; k++) {
    const oldIdx = oldLines.length - suffix + k;
    const newIdx = newLines.length - suffix + k;
    out.push({
      op: 'equal',
      left_line: oldIdx + 1,
      right_line: newIdx + 1,
      text: oldLines[oldIdx],
    });
  }
  return out;
}

/**
 * Produce clean Markdown containing standard Git-style conflict markers ONLY around
 * diverging hunks between local edits and the latest server revision.
 */
export function buildConflictMergedMarkdown(
  localText: string,
  remoteText: string,
  localLabel: string,
  remoteLabel: string,
): string {
  const ops = computeClientLineDiff(localText, remoteText);
  const out: string[] = [];
  let idx = 0;

  while (idx < ops.length) {
    if (ops[idx].op === 'equal') {
      out.push(ops[idx].text);
      idx++;
      continue;
    }
    const localChunk: string[] = [];
    const remoteChunk: string[] = [];
    while (idx < ops.length && ops[idx].op !== 'equal') {
      if (ops[idx].op === 'delete') {
        localChunk.push(ops[idx].text);
      } else {
        remoteChunk.push(ops[idx].text);
      }
      idx++;
    }
    out.push(`<<<<<<< ${localLabel}`);
    out.push(...localChunk);
    out.push('=======');
    out.push(...remoteChunk);
    out.push(`>>>>>>> ${remoteLabel}`);
  }

  return out.join('\n');
}
