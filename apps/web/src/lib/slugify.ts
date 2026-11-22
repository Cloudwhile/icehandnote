/**
 * Helpers for sanitizing article URL slugs and deriving readable slugs from article titles.
 */

const CJK_SLUG_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['快速入门', 'quickstart'],
  ['快速上手', 'quickstart'],
  ['入门指南', 'getting-started'],
  ['最佳实践', 'best-practices'],
  ['常见问题', 'faq'],
  ['更新日志', 'changelog'],
  ['发布说明', 'release-notes'],
  ['手账', 'notebook'],
  ['贴纸', 'sticker'],
  ['像素', 'pixel'],
  ['流程图', 'flowchart'],
  ['架构图', 'diagram'],
  ['欢迎', 'welcome'],
  ['介绍', 'intro'],
  ['简介', 'intro'],
  ['入门', 'intro'],
  ['概览', 'overview'],
  ['概述', 'overview'],
  ['指南', 'guide'],
  ['教程', 'tutorial'],
  ['实战', 'practice'],
  ['实践', 'practice'],
  ['安装', 'install'],
  ['配置', 'config'],
  ['设置', 'settings'],
  ['部署', 'deploy'],
  ['发布', 'release'],
  ['架构', 'arch'],
  ['设计', 'design'],
  ['原理', 'internals'],
  ['源码', 'source'],
  ['调试', 'debug'],
  ['测试', 'test'],
  ['优化', 'optimize'],
  ['性能', 'perf'],
  ['安全', 'security'],
  ['认证', 'auth'],
  ['登录', 'login'],
  ['权限', 'rbac'],
  ['数据库', 'database'],
  ['存储', 'storage'],
  ['迁移', 'migration'],
  ['归档', 'archive'],
  ['接口', 'api'],
  ['数据', 'data'],
  ['组件', 'component'],
  ['样式', 'style'],
  ['主题', 'theme'],
  ['动画', 'motion'],
  ['编辑器', 'editor'],
  ['笔记', 'note'],
  ['章节', 'chapter'],
  ['总结', 'summary'],
  ['进阶', 'advanced'],
  ['基础', 'basics'],
  ['问题', 'faq'],
  ['故障', 'troubleshoot'],
  ['排查', 'debug'],
  ['网络', 'network'],
  ['容器', 'container'],
  ['服务', 'service'],
  ['開發', 'dev'],
  ['架構', 'arch'],
  ['設置', 'settings'],
  ['筆記', 'note'],
  ['貼紙', 'sticker'],
  ['入門', 'intro'],
  ['總結', 'summary'],
];

export function sanitizeStepSlugDraft(raw: string): string {
  return raw.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function isAutoPlaceholderSlug(slug: string): boolean {
  const clean = slug.trim();
  if (!clean) return true;
  return /^(draft|untitled|new-step|chapter)(-[a-z0-9]+)*$/i.test(clean);
}

function fnv1aBase36(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 5).padStart(4, '0');
}

/**
 * Derive an ASCII URL slug from an article title, translating common CJK technical terms
 * and falling back to a stable short hash if no readable ASCII tokens remain.
 */
export function suggestSlugFromTitle(
  rawTitle: string,
  stepNumber?: number,
): string {
  const stripped = rawTitle.replace(/<[^>]*>/g, ' ').trim();
  if (!stripped) return '';

  let mapped = stripped.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  for (const [term, en] of CJK_SLUG_TERMS) {
    if (mapped.includes(term)) {
      mapped = mapped.split(term).join(` ${en} `);
    }
  }

  const tokens = mapped.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const deduped: string[] = [];
  for (const tok of tokens) {
    if (deduped[deduped.length - 1] !== tok) {
      deduped.push(tok);
    }
  }

  let bodySlug = deduped.join('-').replace(/^-+|-+$/g, '').slice(0, 44);
  bodySlug = bodySlug.replace(/-+$/g, '');

  if (bodySlug.replace(/-/g, '').length < 3) {
    const hash = fnv1aBase36(stripped);
    bodySlug = bodySlug ? `${bodySlug}-${hash}` : `note-${hash}`;
  }

  if (stepNumber && stepNumber > 0 && !/^\d+[-_]/.test(bodySlug)) {
    const prefix = String(Math.min(999, Math.max(1, stepNumber))).padStart(2, '0');
    return `${prefix}-${bodySlug}`;
  }
  return bodySlug;
}
