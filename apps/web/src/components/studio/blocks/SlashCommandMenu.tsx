/*
 * Notion/Yuque-style "/" Slash Command Menu (`SlashCommandMenu`) for IceHandNote Flow Editor:
 * - Filters localized commands & short aliases (`/h2`, `/tip`, `/code`, `/task`, `/img`, `/sketch`).
 * - Viewport-clamped floating list with smooth keyboard selection & outside pointer dismissal.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { AlertKind, LocaleCode } from '../../../lib/types';
import { createVisualId, type VisualBlock } from '../../../lib/visualBlocks';
import { ALERT_DOODLE_ICONS } from '../../notebook/StationeryStickers';
import {
  IconCheckSquare,
  IconCode,
  IconDiagram,
  IconHeading,
  IconImage,
  IconKeyboardKey,
  IconList,
  IconParagraph,
  IconPixelSticker,
  IconQuote,
} from '../../ui/Icons';

export type SlashCommandId =
  | 'paragraph'
  | 'heading_2'
  | 'heading_3'
  | 'section_task'
  | 'steps'
  | 'alert_tip'
  | 'alert_note'
  | 'alert_warn'
  | 'alert_danger'
  | 'code_card'
  | 'kbd_shortcut'
  | 'image'
  | 'list_bullet'
  | 'list_ordered'
  | 'quote'
  | 'rough_diagram'
  | 'pixel_sticker';

export interface SlashCommandItem {
  id: SlashCommandId;
  alias: string;
  label: string;
  keywords: string;
  icon: ReactNode;
  accent?: boolean;
}

export function getSlashCommands(locale: LocaleCode): SlashCommandItem[] {
  const copy = UI_COPY[locale];
  const v = copy.studio.visual;

  const makeAlertItem = (
    id: Extract<
      SlashCommandId,
      'alert_tip' | 'alert_note' | 'alert_warn' | 'alert_danger'
    >,
    kind: AlertKind,
    alias: string,
    keywords: string,
  ): SlashCommandItem => ({
    id,
    alias,
    label: `${v.types.alert} · ${copy.alertStamps[kind]}`,
    keywords: `alert sticker card tiezhi 贴纸 卡片 便签 ${kind} ${copy.alertStamps[kind]} ${keywords}`,
    icon: (
      <span className="text-accent-amber inline-flex">
        {ALERT_DOODLE_ICONS[kind]}
      </span>
    ),
  });

  return [
    {
      id: 'steps',
      alias: '/task',
      label: copy.taskScopeParagraph,
      keywords: 'task todo check steps 任务 清单 勾选 待办 段落',
      icon: <IconCheckSquare className="w-4 h-4 text-accent-ice" />,
      accent: true,
    },
    {
      id: 'section_task',
      alias: '/milestone',
      label: copy.taskScopeSection,
      keywords: 'section milestone task heading 节任务 里程碑 章节',
      icon: <IconCheckSquare className="w-4 h-4 text-link-ink" />,
      accent: true,
    },
    {
      id: 'heading_2',
      alias: '/h2',
      label: `H2 · ${v.types.heading}`,
      keywords: 'h2 heading title 标题 章节 二级',
      icon: <IconHeading className="w-4 h-4" />,
    },
    {
      id: 'heading_3',
      alias: '/h3',
      label: `H3 · ${v.types.heading}`,
      keywords: 'h3 subheading 小节 三级 标题',
      icon: <IconHeading className="w-4 h-4" />,
    },
    makeAlertItem('alert_tip', 'tip', '/tip', 'hint 提示'),
    makeAlertItem('alert_note', 'note', '/note', 'memo 便签 笔记'),
    makeAlertItem('alert_warn', 'warning', '/warn', 'caution 警告 注意'),
    makeAlertItem('alert_danger', 'danger', '/danger', 'error 危险 警示'),
    {
      id: 'code_card',
      alias: '/code',
      label: v.types.code_card,
      keywords: 'code block snippet card 代码 源码 草稿纸',
      icon: <IconCode className="w-4 h-4" />,
    },
    {
      id: 'kbd_shortcut',
      alias: '/kbd',
      label: EXT_COPY[locale].studio.richFormat.slashKbdTitle,
      keywords: 'kbd keyboard shortcut keycap 按键 快捷键 组合键',
      icon: <IconKeyboardKey className="w-4 h-4 text-link-ink" />,
    },
    {
      id: 'image',
      alias: '/img',
      label: v.types.image,
      keywords: 'image photo upload picture screenshot 图片 上传 截图',
      icon: <IconImage className="w-4 h-4 text-link-ink" />,
    },
    {
      id: 'list_bullet',
      alias: '/list',
      label: v.listUnordered,
      keywords: 'ul bullet list 列表 无序',
      icon: <IconList className="w-4 h-4" />,
    },
    {
      id: 'list_ordered',
      alias: '/num',
      label: v.listOrdered,
      keywords: 'ol numbered ordered list 编号 有序 列表',
      icon: <IconList className="w-4 h-4" />,
    },
    {
      id: 'quote',
      alias: '/quote',
      label: v.types.quote,
      keywords: 'quote blockquote citation 引用 摘录',
      icon: <IconQuote className="w-4 h-4" />,
    },
    {
      id: 'rough_diagram',
      alias: '/sketch',
      label: v.types.rough_diagram,
      keywords: 'diagram sketch flowchart graph 流程图 架构图 手绘',
      icon: <IconDiagram className="w-4 h-4" />,
    },
    {
      id: 'pixel_sticker',
      alias: '/pixel',
      label: v.types.pixel_sticker,
      keywords:
        'pixel sticker cute icon stamp cat coffee lightbulb heart 像素 贴纸 装饰 猫 灯泡 爱心',
      icon: <IconPixelSticker className="w-4 h-4 text-accent-amber" />,
    },
    {
      id: 'paragraph',
      alias: '/text',
      label: v.types.paragraph,
      keywords: 'text paragraph plain 文本 段落 正文',
      icon: <IconParagraph className="w-4 h-4" />,
    },
  ];
}

export function filterSlashCommands(
  query: string,
  locale: LocaleCode,
): SlashCommandItem[] {
  const clean = query.trim().toLowerCase();
  const all = getSlashCommands(locale);
  if (!clean) return all;
  return all.filter(
    (item) =>
      item.alias.toLowerCase().includes(clean) ||
      item.label.toLowerCase().includes(clean) ||
      item.keywords.toLowerCase().includes(clean),
  );
}

export function createBlockFromSlashCommand(id: SlashCommandId): VisualBlock {
  const newId = createVisualId();
  switch (id) {
    case 'paragraph':
      return { id: newId, type: 'paragraph', text: '', marginNote: '' };
    case 'heading_2':
      return { id: newId, type: 'heading', level: 2, text: '', isTask: false, defaultChecked: false };
    case 'heading_3':
      return { id: newId, type: 'heading', level: 3, text: '', isTask: false, defaultChecked: false };
    case 'section_task':
      return { id: newId, type: 'heading', level: 2, text: '', isTask: true, defaultChecked: false };
    case 'steps':
      return {
        id: newId,
        type: 'steps',
        title: '',
        scope: 'paragraph',
        items: [{ id: createVisualId('st'), title: '', detail: '', defaultChecked: false }],
      };
    case 'alert_tip':
      return { id: newId, type: 'alert', kind: 'tip', title: '', body: '', detailSummary: '', detailBody: '', style: '', tone: '', badge: '' };
    case 'alert_note':
      return { id: newId, type: 'alert', kind: 'note', title: '', body: '', detailSummary: '', detailBody: '', style: '', tone: '', badge: '' };
    case 'alert_warn':
      return { id: newId, type: 'alert', kind: 'warning', title: '', body: '', detailSummary: '', detailBody: '', style: '', tone: '', badge: '' };
    case 'alert_danger':
      return { id: newId, type: 'alert', kind: 'danger', title: '', body: '', detailSummary: '', detailBody: '', style: '', tone: '', badge: '' };
    case 'code_card':
      return { id: newId, type: 'code_card', language: 'text', filename: '', code: '', marginNote: '', style: 'washi' };
    case 'kbd_shortcut':
      return {
        id: newId,
        type: 'paragraph',
        text: '<span class="ink-kbd-combo"><kbd class="ink-kbd">Ctrl</kbd><span class="ink-kbd-sep">+</span><kbd class="ink-kbd">K</kbd></span> ',
        marginNote: '',
      };
    case 'image':
      return { id: newId, type: 'image', src: '', alt: '', caption: '', marginNote: '' };
    case 'list_bullet':
      return { id: newId, type: 'list', ordered: false, items: [''] };
    case 'list_ordered':
      return { id: newId, type: 'list', ordered: true, items: [''] };
    case 'quote':
      return { id: newId, type: 'quote', text: '' };
    case 'pixel_sticker':
      return {
        id: newId,
        type: 'pixel_sticker',
        sprite: 'cat',
        align: 'center',
        size: 'md',
        caption: '',
      };
    case 'rough_diagram':
      return {
        id: newId,
        type: 'rough_diagram',
        caption: '',
        spec: {
          nodes: [
            { id: 'n1', label: 'A', sublabel: '', x: 24, y: 36, width: 155, height: 64, tone: 'ice' },
            { id: 'n2', label: 'B', sublabel: '', x: 245, y: 36, width: 160, height: 64, tone: 'violet' },
          ],
          edges: [{ from: 'n1', to: 'n2', label: '' }],
        },
      };
  }
}

interface SlashCommandMenuProps {
  locale: LocaleCode;
  open: boolean;
  anchorEl: HTMLElement | null;
  commands: SlashCommandItem[];
  activeIndex: number;
  onSelect: (id: SlashCommandId) => void;
  onDismiss: () => void;
}

export function SlashCommandMenu({
  locale,
  open,
  anchorEl,
  commands,
  activeIndex,
  onSelect,
  onDismiss,
}: SlashCommandMenuProps) {
  const flow = EXT_COPY[locale].studio.flowEditor;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: 120,
    left: 24,
  });

  useEffect(() => {
    if (!open || !anchorEl) return;

    const updatePos = () => {
      const rect = anchorEl.getBoundingClientRect();
      const menuW = Math.min(336, window.innerWidth - 32);
      const menuH = Math.min(320, menuRef.current?.offsetHeight ?? 300);
      const left = Math.max(
        16,
        Math.min(rect.left, window.innerWidth - menuW - 16),
      );
      const fitsBelow = rect.bottom + 8 + menuH <= window.innerHeight - 12;
      const top = fitsBelow
        ? rect.bottom + 6
        : Math.max(12, rect.top - menuH - 6);
      setCoords({ top: Math.round(top), left: Math.round(left) });
    };

    updatePos();
    window.addEventListener('scroll', updatePos, { passive: true, capture: true });
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, { capture: true });
      window.removeEventListener('resize', updatePos);
    };
  }, [open, anchorEl, commands.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !menuRef.current?.contains(target) &&
        !anchorEl?.contains(target)
      ) {
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, anchorEl, onDismiss]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label={flow.slashMenuTitle}
      className="flow-slash-popover ui-popover-enter origin-top-left"
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
    >
      <div className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted border-b border-border-subtle mb-1">
        {flow.slashMenuTitle}
      </div>

      {commands.length === 0 ? (
        <div className="px-3 py-3 text-xs text-ink-muted">{flow.slashEmpty}</div>
      ) : (
        <div className="space-y-0.5">
          {commands.map((cmd, idx) => {
            const active = idx === activeIndex;
            return (
              <button
                key={cmd.id}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // Prevent textarea blur flash so focus jumps smoothly to the new block
                  e.preventDefault();
                }}
                onClick={() => onSelect(cmd.id)}
                className={`w-full min-h-9 px-2.5 py-1.5 rounded-lg text-start flex items-center gap-2.5 cursor-pointer transition-colors ${
                  active
                    ? 'bg-action-subtle text-ink-primary'
                    : 'text-ink-primary hover:bg-surface-raised'
                }`}
              >
                <span className="w-7 h-7 rounded-lg bg-surface-raised border border-border-subtle inline-flex items-center justify-center shrink-0">
                  {cmd.icon}
                </span>
                <span
                  className={`flex-1 text-xs truncate ${
                    cmd.accent || active ? 'font-semibold' : ''
                  }`}
                >
                  {cmd.label}
                </span>
                <span className="font-mono text-xs text-ink-muted shrink-0">
                  {cmd.alias}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
