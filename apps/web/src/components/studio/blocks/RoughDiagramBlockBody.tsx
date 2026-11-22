/*
 * Direct Interactive Rough.js Whiteboard Flowchart Editor (`rough_diagram`):
 * - Zero coordinate <input type="number"> boxes: users drag nodes directly on canvas, drag bottom-right
 *   corner handles to resize, drag from any node's 4 ports to draw an arrow to another node, double-click
 *   nodes or edge labels to edit text inline, double-click empty canvas to spawn nodes, or pick tones/auto-layout.
 */

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import rough from 'roughjs';
import { EXT_COPY, UI_COPY } from '../../../lib/i18n';
import type { ResolvedTheme } from '../../../lib/theme';
import type { LocaleCode, SketchNode } from '../../../lib/types';
import type { VisualBlock } from '../../../lib/visualBlocks';
import { computeEdgeEndpoints } from '../../notebook/RoughDiagram';
import { IconArrowLeftRight, IconDiagram, IconPen, IconTrash } from '../../ui/Icons';

const SKETCH_TONES: readonly SketchNode['tone'][] = [
  'violet',
  'ice',
  'amber',
  'coral',
  'paper',
];

const TONE_SWATCH_VAR: Record<string, string> = {
  violet: 'var(--sketch-violet-stroke)',
  ice: 'var(--sketch-ice-stroke)',
  amber: 'var(--sketch-amber-stroke)',
  coral: 'var(--sketch-coral-stroke)',
  paper: 'var(--sketch-paper-stroke)',
};

function readToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function snap4(v: number): number {
  return Math.round(v / 4) * 4;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function RoughDiagramBlockBody({
  block,
  locale,
  theme = 'light',
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'rough_diagram' }>;
  locale: LocaleCode;
  theme?: ResolvedTheme;
  initiallyExpanded?: boolean;
  onUpdate: (next: Extract<VisualBlock, { type: 'rough_diagram' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;
  const diagCopy = EXT_COPY[locale].studio.diagramCanvas;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const roughLayerRef = useRef<SVGGElement | null>(null);

  const [selected, setSelected] = useState<
    | { kind: 'node'; id: string }
    | { kind: 'edge'; idx: number }
    | null
  >(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingEdgeIdx, setEditingEdgeIdx] = useState<number | null>(null);
  const [portDrag, setPortDrag] = useState<{
    fromId: string;
    x1: number;
    y1: number;
    curX: number;
    curY: number;
  } | null>(null);

  const nodeDragRef = useRef<{
    id: string;
    startSvgX: number;
    startSvgY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const resizeDragRef = useRef<{
    id: string;
    startSvgX: number;
    startSvgY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const maxX = Math.max(
    640,
    ...block.spec.nodes.map((n) => n.x + (n.width ?? 150) + 36),
  );
  const maxY = Math.max(
    220,
    ...block.spec.nodes.map((n) => n.y + (n.height ?? 64) + 36),
  );

  const toSvgCoords = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * maxX,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * maxY,
    };
  };

  useEffect(() => {
    const svg = svgRef.current;
    const roughLayer = roughLayerRef.current;
    if (!svg || !roughLayer) return;

    roughLayer.replaceChildren();
    const styles = getComputedStyle(document.documentElement);
    const inkColor = readToken(
      styles,
      '--sketch-ink',
      theme === 'dark' ? '#d3dee4' : '#352722',
    );
    const linkColor = readToken(styles, '--link-ink', '#4f46e5');

    const palette: Record<string, { stroke: string; fill: string }> = {
      violet: {
        stroke: readToken(styles, '--sketch-violet-stroke', '#6018f0'),
        fill: readToken(styles, '--sketch-violet-fill', 'rgba(139, 61, 255, 0.16)'),
      },
      ice: {
        stroke: readToken(styles, '--sketch-ice-stroke', '#006bb4'),
        fill: readToken(styles, '--sketch-ice-fill', 'rgba(13, 202, 240, 0.18)'),
      },
      amber: {
        stroke: readToken(styles, '--sketch-amber-stroke', '#b65100'),
        fill: readToken(styles, '--sketch-amber-fill', 'rgba(245, 158, 11, 0.22)'),
      },
      coral: {
        stroke: readToken(styles, '--sketch-coral-stroke', '#c40a25'),
        fill: readToken(styles, '--sketch-coral-fill', 'rgba(219, 20, 54, 0.16)'),
      },
      paper: {
        stroke: readToken(styles, '--sketch-paper-stroke', '#352722'),
        fill: readToken(styles, '--sketch-paper-fill', 'rgba(143, 130, 112, 0.16)'),
      },
    };

    const rc = rough.svg(svg);
    const nodeMap = new Map(block.spec.nodes.map((n) => [n.id, n]));

    block.spec.edges.forEach((edge, idx) => {
      const src = nodeMap.get(edge.from);
      const dst = nodeMap.get(edge.to);
      if (!src || !dst) return;
      const { x1, y1, x2, y2 } = computeEdgeEndpoints(src, dst);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10;
      const spread = Math.PI / 6;
      const isEdgeSel = selected?.kind === 'edge' && selected.idx === idx;
      const stroke = isEdgeSel ? linkColor : inkColor;

      roughLayer.appendChild(
        rc.line(x1, y1, x2, y2, {
          stroke,
          strokeWidth: isEdgeSel ? 2.8 : 2,
          roughness: 1.25,
          seed: 42 + idx * 13,
        }),
      );
      roughLayer.appendChild(
        rc.linearPath(
          [
            [
              x2 - headLen * Math.cos(angle - spread),
              y2 - headLen * Math.sin(angle - spread),
            ],
            [x2, y2],
            [
              x2 - headLen * Math.cos(angle + spread),
              y2 - headLen * Math.sin(angle + spread),
            ],
          ],
          {
            stroke,
            strokeWidth: isEdgeSel ? 2.8 : 2,
            roughness: 1.0,
            seed: 77 + idx * 11,
          },
        ),
      );
    });

    block.spec.nodes.forEach((node, idx) => {
      const w = node.width ?? 150;
      const h = node.height ?? 64;
      const colors = palette[node.tone] ?? palette.violet;
      const isNodeSel = selected?.kind === 'node' && selected.id === node.id;
      roughLayer.appendChild(
        rc.rectangle(node.x, node.y, w, h, {
          stroke: isNodeSel ? linkColor : colors.stroke,
          strokeWidth: isNodeSel ? 2.8 : 2,
          fill: colors.fill,
          fillStyle: 'hachure',
          hachureGap: 7,
          roughness: 1.2,
          bowing: 1.35,
          seed: 100 + idx * 17,
        }),
      );
    });
  }, [block.spec, selected, theme]);

  const updateNode = (id: string, patch: Partial<SketchNode>) => {
    onUpdate({
      ...block,
      spec: {
        ...block.spec,
        nodes: block.spec.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      },
    });
  };

  const addNodeAt = (x: number, y: number, openInline = false) => {
    const nNum = block.spec.nodes.length + 1;
    const nextNode: SketchNode = {
      id: `n${nNum}_${Date.now().toString(36).slice(-3)}`,
      label: `Node ${nNum}`,
      sublabel: '',
      x: snap4(Math.max(12, x)),
      y: snap4(Math.max(12, y)),
      width: 160,
      height: 62,
      tone: SKETCH_TONES[(nNum - 1) % SKETCH_TONES.length],
    };
    onUpdate({
      ...block,
      spec: {
        ...block.spec,
        nodes: [...block.spec.nodes, nextNode],
      },
    });
    setSelected({ kind: 'node', id: nextNode.id });
    if (openInline) {
      setEditingNodeId(nextNode.id);
    }
  };

  const addEdgeBetween = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    const exists = block.spec.edges.some(
      (ed) => ed.from === fromId && ed.to === toId,
    );
    if (exists) return;
    const nextEdges = [...block.spec.edges, { from: fromId, to: toId, label: '' }];
    onUpdate({
      ...block,
      spec: { ...block.spec, edges: nextEdges },
    });
    setSelected({ kind: 'edge', idx: nextEdges.length - 1 });
  };

  const deleteSelection = () => {
    if (!selected) return;
    if (selected.kind === 'node') {
      const removedId = selected.id;
      onUpdate({
        ...block,
        spec: {
          nodes: block.spec.nodes.filter((n) => n.id !== removedId),
          edges: block.spec.edges.filter(
            (ed) => ed.from !== removedId && ed.to !== removedId,
          ),
        },
      });
      setSelected(null);
      setEditingNodeId(null);
    } else {
      onUpdate({
        ...block,
        spec: {
          ...block.spec,
          edges: block.spec.edges.filter((_, idx) => idx !== selected.idx),
        },
      });
      setSelected(null);
      setEditingEdgeIdx(null);
    }
  };

  const selectedNode =
    selected?.kind === 'node'
      ? block.spec.nodes.find((n) => n.id === selected.id) ?? null
      : null;
  const selectedEdge =
    selected?.kind === 'edge' ? block.spec.edges[selected.idx] ?? null : null;

  const editingNode = editingNodeId
    ? block.spec.nodes.find((n) => n.id === editingNodeId) ?? null
    : null;
  const editingEdge =
    editingEdgeIdx !== null ? block.spec.edges[editingEdgeIdx] ?? null : null;

  return (
    <div
      className="space-y-2.5"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (editingNodeId || editingEdgeIdx !== null) return;
        const targetEl = e.target as HTMLElement | null;
        if (targetEl?.tagName === 'INPUT' || targetEl?.tagName === 'TEXTAREA') {
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
          e.preventDefault();
          deleteSelection();
        } else if (
          selectedNode &&
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
        ) {
          e.preventDefault();
          const step = e.shiftKey ? 24 : 12;
          const dx =
            e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
          const dy =
            e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
          updateNode(selectedNode.id, {
            x: Math.max(8, selectedNode.x + dx),
            y: Math.max(8, selectedNode.y + dy),
          });
        }
      }}
    >
      {/* Direct Canvas Toolbar (zero coordinate number inputs) */}
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <button
          type="button"
          data-testid="diagram-add-node-btn"
          onClick={() => {
            const count = block.spec.nodes.length;
            const col = count % 3;
            const row = Math.floor(count / 3);
            addNodeAt(24 + col * 205, 28 + row * 104, false);
          }}
          className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink cursor-pointer"
        >
          {v.diagramAddNode}
        </button>

        <button
          type="button"
          data-testid="diagram-connect-mode-btn"
          aria-pressed={connectMode}
          onClick={() => {
            setConnectMode((prev) => !prev);
            setConnectSourceId(null);
          }}
          className={`min-h-7 px-2.5 py-0.5 rounded-lg text-xs border cursor-pointer transition-colors ${
            connectMode
              ? 'bg-action-subtle border-link-ink text-link-ink font-semibold'
              : 'bg-surface-sheet border-border-subtle text-ink-secondary hover:border-border-ink'
          }`}
        >
          <span className="inline-flex items-center gap-1">
            <IconDiagram className="w-3.5 h-3.5" />
            <span>{diagCopy.connectModeBtn}</span>
          </span>
        </button>

        <button
          type="button"
          data-testid="diagram-auto-layout-btn"
          onClick={() => {
            const arranged = block.spec.nodes.map((node, nIdx) => {
              const col = nIdx % 3;
              const row = Math.floor(nIdx / 3);
              return {
                ...node,
                x: 24 + col * 210,
                y: 28 + row * 106,
                width: node.width || 160,
                height: node.height || 62,
              };
            });
            onUpdate({
              ...block,
              spec: { ...block.spec, nodes: arranged },
            });
          }}
          className="min-h-7 px-2.5 py-0.5 rounded-lg text-xs bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary cursor-pointer"
        >
          {v.diagramAutoLayout}
        </button>

        {selectedNode && (
          <div className="flex items-center gap-1 ps-1 border-s border-border-subtle">
            {SKETCH_TONES.map((tone) => {
              const active = selectedNode.tone === tone;
              return (
                <button
                  key={tone}
                  type="button"
                  data-testid={`diagram-tone-${tone}`}
                  aria-label={tone}
                  aria-pressed={active}
                  onClick={() => updateNode(selectedNode.id, { tone })}
                  className={`w-5 h-5 rounded-full border-2 cursor-pointer transition-transform ${
                    active ? 'scale-110 border-border-ink' : 'border-surface-sheet'
                  }`}
                  style={{ backgroundColor: TONE_SWATCH_VAR[tone] }}
                />
              );
            })}
            <button
              type="button"
              data-testid="diagram-delete-btn"
              aria-label={diagCopy.deleteNodeBtn}
              title={diagCopy.deleteNodeBtn}
              onClick={deleteSelection}
              className="ms-1 min-h-7 px-2 py-0.5 rounded-lg text-xs text-accent-danger hover:bg-surface-sheet border border-transparent hover:border-border-subtle inline-flex items-center gap-1 cursor-pointer"
            >
              <IconTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {selectedEdge && selected?.kind === 'edge' && (
          <div className="flex items-center gap-1.5 ps-1 border-s border-border-subtle">
            <button
              type="button"
              onClick={() => {
                const nextEdges = block.spec.edges.map((ed, i) =>
                  i === selected.idx
                    ? { ...ed, from: ed.to, to: ed.from }
                    : ed,
                );
                onUpdate({
                  ...block,
                  spec: { ...block.spec, edges: nextEdges },
                });
              }}
              className="min-h-7 px-2 py-0.5 rounded-lg text-xs bg-surface-sheet border border-border-subtle hover:border-border-ink text-ink-secondary inline-flex items-center gap-1 cursor-pointer"
            >
              <IconArrowLeftRight className="w-3.5 h-3.5" />
              <span>{diagCopy.reverseEdgeBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => setEditingEdgeIdx(selected.idx)}
              className="min-h-7 px-2 py-0.5 rounded-lg text-xs bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink font-semibold inline-flex items-center cursor-pointer"
            >
              <IconPen className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="diagram-delete-btn"
              aria-label={diagCopy.deleteEdgeBtn}
              title={diagCopy.deleteEdgeBtn}
              onClick={deleteSelection}
              className="min-h-7 px-2 py-0.5 rounded-lg text-xs text-accent-danger hover:bg-surface-sheet border border-transparent hover:border-border-subtle inline-flex items-center cursor-pointer"
            >
              <IconTrash className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Interactive Hand-Drawn Whiteboard */}
      <div
        tabIndex={0}
        className="relative rounded-xl border border-border-subtle bg-surface-raised/65 p-2 sm:p-3 overflow-x-auto overscroll-x-contain ink-thin-scrollbar focus:outline-none focus-visible:border-link-ink"
      >
        <div className="relative min-w-[480px] sm:min-w-0">
          <svg
            ref={svgRef}
            data-testid="interactive-rough-diagram"
            viewBox={`0 0 ${maxX} ${maxY}`}
            className="w-full h-auto block select-none"
            onClick={(e) => {
              if (e.target === svgRef.current) {
                setSelected(null);
                setConnectSourceId(null);
                setEditingNodeId(null);
                setEditingEdgeIdx(null);
              }
            }}
            onDoubleClick={(e) => {
              if (e.target === svgRef.current) {
                const pt = toSvgCoords(e.clientX, e.clientY);
                addNodeAt(pt.x - 80, pt.y - 31, true);
              }
            }}
          >
            <g ref={roughLayerRef} />

            {/* Interactive Edges (wide hit target + inline label pill) */}
            {block.spec.edges.map((edge, idx) => {
              const src = block.spec.nodes.find((n) => n.id === edge.from);
              const dst = block.spec.nodes.find((n) => n.id === edge.to);
              if (!src || !dst) return null;
              const { x1, y1, x2, y2 } = computeEdgeEndpoints(src, dst);
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2 - 10;
              return (
                <g key={`edge_${idx}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="transparent"
                    strokeWidth={16}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected({ kind: 'edge', idx });
                      setEditingNodeId(null);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSelected({ kind: 'edge', idx });
                      setEditingEdgeIdx(idx);
                    }}
                  />
                  {edge.label && (
                    <text
                      x={mx}
                      y={my}
                      textAnchor="middle"
                      fill="var(--ink-secondary)"
                      fontSize="12"
                      fontFamily="var(--font-mono)"
                      fontWeight="600"
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected({ kind: 'edge', idx });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelected({ kind: 'edge', idx });
                        setEditingEdgeIdx(idx);
                      }}
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Live Draft Connection Wire while Dragging from Port */}
            {portDrag && (
              <line
                x1={portDrag.x1}
                y1={portDrag.y1}
                x2={portDrag.curX}
                y2={portDrag.curY}
                stroke="var(--link-ink)"
                strokeWidth={2.2}
                strokeDasharray="6 4"
                pointerEvents="none"
              />
            )}

            {/* Interactive Nodes, Ports & Resize Corner Handles */}
            {block.spec.nodes.map((node) => {
              const w = node.width ?? 150;
              const h = node.height ?? 64;
              const cx = node.x + w / 2;
              const cy = node.y + h / 2;
              const isNodeSel =
                selected?.kind === 'node' && selected.id === node.id;
              const showPorts =
                isNodeSel ||
                hoveredNodeId === node.id ||
                Boolean(portDrag) ||
                connectMode;

              const ports = [
                { key: 'top', px: cx, py: node.y },
                { key: 'right', px: node.x + w, py: cy },
                { key: 'bottom', px: cx, py: node.y + h },
                { key: 'left', px: node.x, py: cy },
              ] as const;

              const handleNodePointerDown = (
                e: ReactPointerEvent<SVGRectElement>,
              ) => {
                if (e.button !== 0) return;
                e.stopPropagation();

                if (connectMode) {
                  if (!connectSourceId) {
                    setConnectSourceId(node.id);
                    setSelected({ kind: 'node', id: node.id });
                  } else if (connectSourceId !== node.id) {
                    addEdgeBetween(connectSourceId, node.id);
                    setConnectSourceId(null);
                  }
                  return;
                }

                setSelected({ kind: 'node', id: node.id });
                setEditingEdgeIdx(null);
                const pt = toSvgCoords(e.clientX, e.clientY);
                nodeDragRef.current = {
                  id: node.id,
                  startSvgX: pt.x,
                  startSvgY: pt.y,
                  origX: node.x,
                  origY: node.y,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              };

              const handleNodePointerMove = (
                e: ReactPointerEvent<SVGRectElement>,
              ) => {
                const d = nodeDragRef.current;
                if (!d || d.id !== node.id) return;
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const pt = toSvgCoords(e.clientX, e.clientY);
                const nextX = snap4(Math.max(8, d.origX + (pt.x - d.startSvgX)));
                const nextY = snap4(Math.max(8, d.origY + (pt.y - d.startSvgY)));
                updateNode(node.id, { x: nextX, y: nextY });
              };

              const finishNodeDrag = (e: ReactPointerEvent<SVGRectElement>) => {
                if (nodeDragRef.current?.id === node.id) {
                  nodeDragRef.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }
              };

              const handleResizeDown = (
                e: ReactPointerEvent<SVGCircleElement>,
              ) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                setSelected({ kind: 'node', id: node.id });
                const pt = toSvgCoords(e.clientX, e.clientY);
                resizeDragRef.current = {
                  id: node.id,
                  startSvgX: pt.x,
                  startSvgY: pt.y,
                  origW: w,
                  origH: h,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              };

              const handleResizeMove = (
                e: ReactPointerEvent<SVGCircleElement>,
              ) => {
                const r = resizeDragRef.current;
                if (!r || r.id !== node.id) return;
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const pt = toSvgCoords(e.clientX, e.clientY);
                updateNode(node.id, {
                  width: snap4(clamp(r.origW + (pt.x - r.startSvgX), 96, 360)),
                  height: snap4(clamp(r.origH + (pt.y - r.startSvgY), 44, 200)),
                });
              };

              const finishResize = (e: ReactPointerEvent<SVGCircleElement>) => {
                if (resizeDragRef.current?.id === node.id) {
                  resizeDragRef.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                }
              };

              return (
                <g
                  key={node.id}
                  data-testid={`diagram-node-${node.id}`}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() =>
                    setHoveredNodeId((cur) => (cur === node.id ? null : cur))
                  }
                >
                  {/* Transparent interactive hit/drag surface */}
                  <rect
                    x={node.x}
                    y={node.y}
                    width={w}
                    height={h}
                    rx={6}
                    fill="transparent"
                    className="ink-sticker-gizmo-handle"
                    onPointerDown={handleNodePointerDown}
                    onPointerMove={handleNodePointerMove}
                    onPointerUp={finishNodeDrag}
                    onLostPointerCapture={finishNodeDrag}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setSelected({ kind: 'node', id: node.id });
                      setEditingNodeId(node.id);
                    }}
                  />

                  <text
                    x={cx}
                    y={node.sublabel ? cy - 5 : cy + 5}
                    textAnchor="middle"
                    fill="var(--ink-primary)"
                    fontSize="14"
                    fontFamily="var(--font-hand)"
                    fontWeight="600"
                    pointerEvents="none"
                  >
                    {node.label}
                  </text>
                  {node.sublabel && (
                    <text
                      x={cx}
                      y={cy + 15}
                      textAnchor="middle"
                      fill="var(--ink-secondary)"
                      fontSize="12"
                      fontFamily="var(--font-mono)"
                      pointerEvents="none"
                    >
                      {node.sublabel}
                    </text>
                  )}

                  {/* 4 Connection Ports (drag from port to any target node to connect) */}
                  {showPorts &&
                    ports.map((p) => (
                      <circle
                        key={p.key}
                        data-testid={`diagram-port-${node.id}-${p.key}`}
                        cx={p.px}
                        cy={p.py}
                        r={6}
                        fill="var(--surface-sheet)"
                        stroke={
                          connectSourceId === node.id
                            ? 'var(--accent-amber-ink)'
                            : 'var(--link-ink)'
                        }
                        strokeWidth={2}
                        className="cursor-crosshair"
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          setPortDrag({
                            fromId: node.id,
                            x1: p.px,
                            y1: p.py,
                            curX: p.px,
                            curY: p.py,
                          });
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!portDrag || portDrag.fromId !== node.id) return;
                          if (!e.currentTarget.hasPointerCapture(e.pointerId))
                            return;
                          const pt = toSvgCoords(e.clientX, e.clientY);
                          setPortDrag((prev) =>
                            prev ? { ...prev, curX: pt.x, curY: pt.y } : null,
                          );
                        }}
                        onPointerUp={(e) => {
                          if (!portDrag || portDrag.fromId !== node.id) return;
                          const pt = toSvgCoords(e.clientX, e.clientY);
                          const hitNode = block.spec.nodes.find((cand) => {
                            if (cand.id === node.id) return false;
                            const cw = cand.width ?? 150;
                            const ch = cand.height ?? 64;
                            return (
                              pt.x >= cand.x - 10 &&
                              pt.x <= cand.x + cw + 10 &&
                              pt.y >= cand.y - 10 &&
                              pt.y <= cand.y + ch + 10
                            );
                          });
                          if (hitNode) {
                            addEdgeBetween(node.id, hitNode.id);
                          }
                          setPortDrag(null);
                          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          }
                        }}
                        onLostPointerCapture={() => setPortDrag(null)}
                      />
                    ))}

                  {/* Bottom-right node resize handle when selected */}
                  {isNodeSel && (
                    <circle
                      data-testid={`diagram-node-resize-${node.id}`}
                      cx={node.x + w}
                      cy={node.y + h}
                      r={5.5}
                      fill="var(--link-ink)"
                      stroke="var(--surface-sheet)"
                      strokeWidth={2}
                      className="cursor-nwse-resize"
                      onPointerDown={handleResizeDown}
                      onPointerMove={handleResizeMove}
                      onPointerUp={finishResize}
                      onLostPointerCapture={() => {
                        resizeDragRef.current = null;
                      }}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Inline Node Label / Sublabel HTML Overlay when Double-Clicked */}
          {editingNode && (
            <div
              className="absolute z-30 p-2 rounded-xl border-2 border-link-ink bg-surface-sheet shadow-md flex flex-col gap-1"
              style={{
                left: `${(editingNode.x / maxX) * 100}%`,
                top: `${(editingNode.y / maxY) * 100}%`,
                width: `${Math.max(24, ((editingNode.width ?? 150) / maxX) * 100)}%`,
                minWidth: '150px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                autoFocus
                data-testid="diagram-inline-node-label"
                value={editingNode.label}
                onChange={(e) =>
                  updateNode(editingNode.id, { label: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    setEditingNodeId(null);
                  } else if (e.key === 'Escape') {
                    setEditingNodeId(null);
                  }
                }}
                placeholder={v.diagramNodeLabelPlaceholder}
                className="w-full px-2 py-0.5 rounded-md bg-surface-raised border border-border-subtle text-xs font-semibold text-ink-primary focus:outline-none focus:border-link-ink"
              />
              <input
                type="text"
                value={editingNode.sublabel ?? ''}
                onChange={(e) =>
                  updateNode(editingNode.id, { sublabel: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    setEditingNodeId(null);
                  } else if (e.key === 'Escape') {
                    setEditingNodeId(null);
                  }
                }}
                placeholder={v.diagramNodeSubPlaceholder}
                className="w-full px-2 py-0.5 rounded-md bg-surface-raised border border-border-subtle text-xs font-mono text-ink-secondary focus:outline-none focus:border-link-ink"
              />
            </div>
          )}

          {/* Inline Edge Label Overlay when Double-Clicked */}
          {editingEdge &&
            editingEdgeIdx !== null &&
            (() => {
              const src = block.spec.nodes.find(
                (n) => n.id === editingEdge.from,
              );
              const dst = block.spec.nodes.find(
                (n) => n.id === editingEdge.to,
              );
              if (!src || !dst) return null;
              const { x1, y1, x2, y2 } = computeEdgeEndpoints(src, dst);
              const leftPct = (((x1 + x2) / 2) / maxX) * 100;
              const topPct = (((y1 + y2) / 2) / maxY) * 100;
              return (
                <div
                  className="absolute z-30 -translate-x-1/2 -translate-y-1/2 p-1 rounded-lg border-2 border-link-ink bg-surface-sheet shadow-md"
                  style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    autoFocus
                    data-testid="diagram-inline-edge-label"
                    value={editingEdge.label ?? ''}
                    onChange={(e) => {
                      const nextEdges = block.spec.edges.map((ed, i) =>
                        i === editingEdgeIdx
                          ? { ...ed, label: e.target.value }
                          : ed,
                      );
                      onUpdate({
                        ...block,
                        spec: { ...block.spec, edges: nextEdges },
                      });
                    }}
                    onBlur={() => setEditingEdgeIdx(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (e.nativeEvent.isComposing || e.keyCode === 229)
                          return;
                        e.preventDefault();
                        setEditingEdgeIdx(null);
                      } else if (e.key === 'Escape') {
                        setEditingEdgeIdx(null);
                      }
                    }}
                    placeholder={diagCopy.edgeLabelPlaceholder}
                    className="w-32 px-2 py-0.5 rounded bg-surface-raised border border-border-subtle text-xs font-mono text-ink-primary focus:outline-none"
                  />
                </div>
              );
            })()}
        </div>

        <p className="mt-1.5 text-center text-xs text-ink-muted m-0">
          {connectMode ? diagCopy.connectModeActiveHint : diagCopy.hint}
        </p>
      </div>

      {/* Inline Caption Input */}
      <input
        type="text"
        size={1}
        data-flow-input="primary"
        value={block.caption}
        onChange={(e) => onUpdate({ ...block, caption: e.target.value })}
        placeholder={v.diagramCaptionPlaceholder}
        className="w-full px-2 bg-transparent border-0 text-xs text-ink-secondary font-hand placeholder:text-ink-muted/65 focus:outline-none"
      />
    </div>
  );
}
