/*
 * Right-Click Editor Context Menu (`modern-web-guidance/menu`):
 * - Uses native `popover="auto"` anchored to a zero-size fixed pointer placeholder via `showPopover({ source })`.
 * - Falls back cleanly when `!CSS.supports('position-area: block-end')` (viewport-clamped fixed coords)
 *   and when `!('focusGroup' in HTMLElement.prototype)` (`role="menu"` + arrow/Home/End/Escape handling).
 * - Contextualizes seamlessly between sticker actions (including locked `pointer-events: none` stickers)
 *   and block/text actions (`在此处贴上像素贴纸`, quick block insertion, text selection formatting, block move/delete).
 */

import { useCallback, useEffect, useId, useRef } from 'react';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { ActiveInlineFormats, RichInlineCommand } from '../../../lib/richInline';
import { RICH_FONT_SIZES } from '../../../lib/richInline';
import type { LocaleCode, TextAlign, TextSizePreset } from '../../../lib/types';
import type { AttachedPixelSticker, VisualBlock } from '../../../lib/visualBlocks';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconEraser,
  IconInlineCode,
  IconItalic,
  IconKeyboardKey,
  IconPixelSticker,
  IconStrikethrough,
  IconUnderline,
} from '../../ui/Icons';
import { ColorHighlightPalette } from './BlockFloatingControls';

export type ContextMenuTarget =
  | {
      kind: 'sticker';
      x: number;
      y: number;
      blockId: string;
      sticker: AttachedPixelSticker;
    }
  | {
      kind: 'block';
      x: number;
      y: number;
      blockId: string;
      blockIndex: number;
      totalBlocks: number;
      blockType: VisualBlock['type'];
      relX: number;
      relY: number;
      hasTextSelection: boolean;
      activeFormats?: ActiveInlineFormats;
      supportsAlign?: boolean;
      blockAlign?: TextAlign;
      supportsFontSize?: boolean;
      blockSize?: TextSizePreset;
      supportsMarginToggle: boolean;
      hasMarginOpen: boolean;
    };

interface EditorContextMenuProps {
  locale: LocaleCode;
  target: ContextMenuTarget | null;
  onClose: () => void;
  onPasteStickerHere: (blockId: string, coords: { x: number; y: number }) => void;
  onStickerAction: (
    blockId: string,
    stickerId: string,
    action:
      | 'toggle-lock'
      | 'rotate-left'
      | 'rotate-right'
      | 'flip'
      | 'scale-up'
      | 'scale-down'
      | 'reset'
      | 'toggle-layer'
      | 'duplicate'
      | 'delete',
  ) => void;
  onRichCommand: (cmd: RichInlineCommand) => void;
  onOpenKbdComposer: () => void;
  onChangeBlockAlign: (blockId: string, align: TextAlign) => void;
  onChangeBlockSize: (blockId: string, size: TextSizePreset) => void;
  onInsertBlockBelow: (
    afterBlockId: string,
    kind: 'paragraph' | 'heading' | 'alert' | 'steps' | 'code_card' | 'rough_diagram',
  ) => void;
  onBlockAction: (
    blockId: string,
    action: 'move-up' | 'move-down' | 'duplicate' | 'delete' | 'toggle-margin',
  ) => void;
}

function supportsAnchorArea(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.CSS?.supports?.('position-area: block-end'))
  );
}

function supportsFocusgroup(): boolean {
  return (
    typeof window !== 'undefined' && 'focusGroup' in HTMLElement.prototype
  );
}

export function EditorContextMenu({
  locale,
  target,
  onClose,
  onPasteStickerHere,
  onStickerAction,
  onRichCommand,
  onOpenKbdComposer,
  onChangeBlockAlign,
  onChangeBlockSize,
  onInsertBlockBelow,
  onBlockAction,
}: EditorContextMenuProps) {
  const menuId = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const copy = UI_COPY[locale];
  const extCtx = EXT_COPY[locale].studio.contextMenu;
  const rf = EXT_COPY[locale].studio.richFormat;
  const v = copy.studio.visual;

  const hideMenu = useCallback(() => {
    const pop = popoverRef.current;
    if (pop && pop.matches(':popover-open')) {
      pop.hidePopover();
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    const pop = popoverRef.current;
    const anchor = anchorRef.current;
    if (!pop || !anchor || !target) return;

    prevFocusRef.current = document.activeElement as HTMLElement | null;

    if (pop.matches(':popover-open')) {
      pop.hidePopover();
    }

    try {
      (
        pop as HTMLElement & {
          showPopover: (opts?: { source?: HTMLElement }) => void;
        }
      ).showPopover({ source: anchor });
    } catch {
      pop.showPopover();
    }

    if (!supportsAnchorArea()) {
      const rect = pop.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(8, Math.min(target.x, vw - rect.width - 8));
      const top = Math.max(8, Math.min(target.y, vh - rect.height - 8));
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    } else {
      pop.style.left = '';
      pop.style.top = '';
    }

    const firstBtn = groupRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled)',
    );
    requestAnimationFrame(() => {
      firstBtn?.focus({ preventScroll: true });
    });
  }, [target]);

  useEffect(() => {
    const pop = popoverRef.current;
    const group = groupRef.current;
    if (!pop || !group) return;

    const nativeFg = supportsFocusgroup();
    if (!nativeFg) {
      group.setAttribute('role', 'menu');
      group
        .querySelectorAll('button:not([role])')
        .forEach((el) => el.setAttribute('role', 'menuitem'));
    }

    const onToggle = (ev: Event) => {
      if ((ev as ToggleEvent).newState === 'closed') {
        onClose();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideMenu();
        prevFocusRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key === 'Tab') {
        hideMenu();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      if (nativeFg && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        return;
      }
      const items = Array.from(
        group.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
      );
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      const nextIdx =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : idx < 0
              ? 0
              : (idx + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
                items.length;
      event.preventDefault();
      event.stopPropagation();
      items[nextIdx]?.focus({ preventScroll: true });
    };

    pop.addEventListener('toggle', onToggle);
    group.addEventListener('keydown', onKeyDown, true);
    return () => {
      pop.removeEventListener('toggle', onToggle);
      group.removeEventListener('keydown', onKeyDown, true);
    };
  }, [hideMenu, onClose, target]);

  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: `${target?.x ?? 0}px`,
          top: `${target?.y ?? 0}px`,
          width: 0,
          height: 0,
          pointerEvents: 'none',
        }}
      />
      <div
        ref={popoverRef}
        id={menuId}
        popover="auto"
        data-testid="editor-context-menu"
        className={`ink-menu-popover ${
          target?.kind === 'block'
            ? 'min-w-[19rem] max-w-[min(23rem,calc(100dvw-1.5rem))]'
            : 'min-w-[13.5rem]'
        }`}
      >
        <div
          ref={groupRef}
          aria-label={extCtx.menuAria}
          className="ink-menu-list"
          {...({ focusgroup: 'menu nomemory' } as Record<string, string>)}
        >
          {target?.kind === 'sticker' && (
            <>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={Boolean(target.sticker.locked)}
                data-testid="ctx-toggle-sticker-lock"
                onClick={() => {
                  onStickerAction(
                    target.blockId,
                    target.sticker.id,
                    'toggle-lock',
                  );
                  hideMenu();
                }}
              >
                <span>
                  {target.sticker.locked
                    ? extCtx.unlockSticker
                    : extCtx.lockSticker}
                </span>
              </button>

              <hr />

              <button
                type="button"
                onClick={() => {
                  onStickerAction(
                    target.blockId,
                    target.sticker.id,
                    'rotate-left',
                  );
                  hideMenu();
                }}
              >
                <span>{extCtx.rotateLeft}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onStickerAction(
                    target.blockId,
                    target.sticker.id,
                    'rotate-right',
                  );
                  hideMenu();
                }}
              >
                <span>{extCtx.rotateRight}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onStickerAction(target.blockId, target.sticker.id, 'flip');
                  hideMenu();
                }}
              >
                <span>{extCtx.flipHorizontal}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onStickerAction(target.blockId, target.sticker.id, 'scale-up');
                  hideMenu();
                }}
              >
                <span>{extCtx.scaleUp}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onStickerAction(
                    target.blockId,
                    target.sticker.id,
                    'scale-down',
                  );
                  hideMenu();
                }}
              >
                <span>{extCtx.scaleDown}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onStickerAction(
                    target.blockId,
                    target.sticker.id,
                    'toggle-layer',
                  );
                  hideMenu();
                }}
              >
                <span>{extCtx.toggleLayer}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onStickerAction(target.blockId, target.sticker.id, 'reset');
                  hideMenu();
                }}
              >
                <span>{extCtx.resetTransform}</span>
              </button>

              <hr />

              <button
                type="button"
                onClick={() => {
                  onStickerAction(
                    target.blockId,
                    target.sticker.id,
                    'duplicate',
                  );
                  hideMenu();
                }}
              >
                <span>{extCtx.duplicateSticker}</span>
              </button>
              <button
                type="button"
                data-tone="danger"
                onClick={() => {
                  onStickerAction(target.blockId, target.sticker.id, 'delete');
                  hideMenu();
                }}
              >
                <span>{extCtx.deleteSticker}</span>
              </button>
            </>
          )}

          {target?.kind === 'block' && (
            <>
              {target.hasTextSelection && (
                <div className="ink-menu-compact space-y-1.5 border-b border-border-subtle pb-1.5 mb-1">
                  <div
                    role="group"
                    aria-label={rf.toolbarAria}
                    className="px-1.5 pt-1 flex flex-wrap items-center gap-1"
                  >
                    <button
                      type="button"
                      data-testid="ctx-bold-btn"
                      aria-label={extCtx.formatBold}
                      title={extCtx.formatBold}
                      onClick={() => {
                        onRichCommand({ type: 'bold' });
                        hideMenu();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconBold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid="ctx-italic-btn"
                      aria-label={extCtx.formatItalic}
                      title={extCtx.formatItalic}
                      onClick={() => {
                        onRichCommand({ type: 'italic' });
                        hideMenu();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconItalic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid="ctx-underline-btn"
                      aria-label={rf.underline}
                      title={rf.underline}
                      onClick={() => {
                        onRichCommand({ type: 'underline' });
                        hideMenu();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconUnderline className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid="ctx-strike-btn"
                      aria-label={rf.strikethrough}
                      title={rf.strikethrough}
                      onClick={() => {
                        onRichCommand({ type: 'strike' });
                        hideMenu();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconStrikethrough className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid="ctx-inline-code-btn"
                      aria-label={rf.inlineCode}
                      title={rf.inlineCode}
                      onClick={() => {
                        onRichCommand({ type: 'inline-code' });
                        hideMenu();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconInlineCode className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid="ctx-kbd-btn"
                      aria-label={rf.kbdCombo}
                      title={rf.kbdCombo}
                      onClick={() => {
                        hideMenu();
                        onOpenKbdComposer();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconKeyboardKey className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid="ctx-clear-format-btn"
                      aria-label={rf.clearFormat}
                      title={rf.clearFormat}
                      onClick={() => {
                        onRichCommand({ type: 'clear-format' });
                        hideMenu();
                      }}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-border-subtle hover:bg-surface-raised text-ink-primary cursor-pointer"
                    >
                      <IconEraser className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="px-2 pt-1.5 border-t border-border-subtle">
                    <ColorHighlightPalette
                      locale={locale}
                      activeFg={target.activeFormats?.fgColor}
                      activeBg={target.activeFormats?.bgColor}
                      activeHighlight={target.activeFormats?.highlight}
                      testIdPrefix="ctx"
                      onCommand={(cmd) => {
                        onRichCommand(cmd);
                        hideMenu();
                      }}
                    />
                  </div>
                </div>
              )}

              {(target.supportsAlign || target.supportsFontSize) && (
                <div className="ink-menu-compact px-2 py-1.5 space-y-1.5 border-b border-border-subtle mb-1 text-xs">
                  {target.supportsAlign && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted font-semibold">
                        {EXT_COPY[locale].studio.pixelSticker.alignLabel}
                      </span>
                      <div className="flex items-center gap-1">
                        {(['left', 'center', 'right'] as TextAlign[]).map((al) => {
                          const icon =
                            al === 'left' ? (
                              <IconAlignLeft className="w-3.5 h-3.5" />
                            ) : al === 'center' ? (
                              <IconAlignCenter className="w-3.5 h-3.5" />
                            ) : (
                              <IconAlignRight className="w-3.5 h-3.5" />
                            );
                          const label =
                            al === 'left'
                              ? rf.alignLeft
                              : al === 'center'
                                ? rf.alignCenter
                                : rf.alignRight;
                          return (
                            <button
                              key={al}
                              type="button"
                              data-testid={`ctx-align-${al}`}
                              aria-label={label}
                              title={label}
                              aria-pressed={(target.blockAlign ?? 'left') === al}
                              onClick={() => {
                                onChangeBlockAlign(target.blockId, al);
                                hideMenu();
                              }}
                              className={`w-7 h-7 inline-flex items-center justify-center rounded-md border cursor-pointer ${
                                (target.blockAlign ?? 'left') === al
                                  ? 'bg-action-subtle border-action-bg text-link-ink'
                                  : 'border-border-subtle text-ink-secondary hover:bg-surface-raised'
                              }`}
                            >
                              {icon}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {target.supportsFontSize && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink-muted font-semibold">
                        {rf.fontSize}
                      </span>
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {RICH_FONT_SIZES.map((sz) => {
                          const shortLabel =
                            sz === 'sm'
                              ? rf.sizeSm
                              : sz === 'base'
                                ? rf.sizeBase
                                : sz === 'lg'
                                  ? rf.sizeLg
                                  : sz === 'xl'
                                    ? rf.sizeXl
                                    : rf.size2xl;
                          const active = (target.blockSize ?? 'base') === sz;
                          return (
                            <button
                              key={sz}
                              type="button"
                              data-testid={`ctx-size-${sz}`}
                              aria-pressed={active}
                              onClick={() => {
                                if (target.hasTextSelection) {
                                  onRichCommand({
                                    type: 'font-size',
                                    value: sz === 'base' ? null : sz,
                                  });
                                } else {
                                  onChangeBlockSize(target.blockId, sz);
                                }
                                hideMenu();
                              }}
                              className={`min-h-6 px-1.5 py-0.5 rounded-md border text-xs font-semibold cursor-pointer ${
                                active
                                  ? 'bg-action-subtle border-action-bg text-link-ink'
                                  : 'border-border-subtle text-ink-secondary hover:bg-surface-raised'
                              }`}
                            >
                              {shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                data-testid="ctx-paste-sticker-here"
                onClick={() => {
                  onPasteStickerHere(target.blockId, {
                    x: target.relX,
                    y: target.relY,
                  });
                  hideMenu();
                }}
              >
                <IconPixelSticker className="w-3.5 h-3.5 text-accent-amber" />
                <span>{extCtx.pasteStickerHere}</span>
              </button>

              <hr />

              <div className="px-2.5 py-1 text-xs font-semibold text-ink-muted">
                {extCtx.insertBelowHeading}
              </div>
              <button
                type="button"
                onClick={() => {
                  onInsertBlockBelow(target.blockId, 'paragraph');
                  hideMenu();
                }}
              >
                <span>+ {v.types.paragraph}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsertBlockBelow(target.blockId, 'heading');
                  hideMenu();
                }}
              >
                <span>+ {v.types.heading}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsertBlockBelow(target.blockId, 'alert');
                  hideMenu();
                }}
              >
                <span>+ {v.types.alert}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsertBlockBelow(target.blockId, 'steps');
                  hideMenu();
                }}
              >
                <span>+ {v.types.steps}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsertBlockBelow(target.blockId, 'code_card');
                  hideMenu();
                }}
              >
                <span>+ {v.types.code_card}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsertBlockBelow(target.blockId, 'rough_diagram');
                  hideMenu();
                }}
              >
                <span>+ {v.types.rough_diagram}</span>
              </button>

              <hr />

              {target.supportsMarginToggle && (
                <button
                  type="button"
                  onClick={() => {
                    onBlockAction(target.blockId, 'toggle-margin');
                    hideMenu();
                  }}
                >
                  <span>
                    {target.hasMarginOpen
                      ? EXT_COPY[locale].studio.flowEditor.removeMarginBtn
                      : EXT_COPY[locale].studio.flowEditor.addMarginBtn}
                  </span>
                </button>
              )}
              <button
                type="button"
                disabled={target.blockIndex === 0}
                onClick={() => {
                  onBlockAction(target.blockId, 'move-up');
                  hideMenu();
                }}
              >
                <span>{v.moveUp}</span>
              </button>
              <button
                type="button"
                disabled={target.blockIndex >= target.totalBlocks - 1}
                onClick={() => {
                  onBlockAction(target.blockId, 'move-down');
                  hideMenu();
                }}
              >
                <span>{v.moveDown}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onBlockAction(target.blockId, 'duplicate');
                  hideMenu();
                }}
              >
                <span>{v.duplicate}</span>
              </button>
              <button
                type="button"
                data-tone="danger"
                onClick={() => {
                  onBlockAction(target.blockId, 'delete');
                  hideMenu();
                }}
              >
                <span>{v.deleteBlock}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
