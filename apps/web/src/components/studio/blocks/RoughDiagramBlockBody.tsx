/*
 * Rough.js Hand-Sketched Node & Edge Diagram Visual Block Editor (`rough_diagram`).
 */

import { UI_COPY } from '../../../lib/i18n';
import type { LocaleCode, SketchNode } from '../../../lib/types';
import type { VisualBlock } from '../../../lib/visualBlocks';
import { IconTrash } from '../../ui/Icons';

const SKETCH_TONES: readonly SketchNode['tone'][] = [
  'violet',
  'ice',
  'amber',
  'coral',
  'paper',
];

export function RoughDiagramBlockBody({
  block,
  locale,
  onUpdate,
}: {
  block: Extract<VisualBlock, { type: 'rough_diagram' }>;
  locale: LocaleCode;
  onUpdate: (next: Extract<VisualBlock, { type: 'rough_diagram' }>) => void;
}) {
  const v = UI_COPY[locale].studio.visual;

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={block.caption}
        onChange={(e) => onUpdate({ ...block, caption: e.target.value })}
        placeholder={v.diagramCaptionPlaceholder}
        className="w-full px-3 py-2 rounded-xl bg-surface-sheet text-ink-primary border border-border-subtle text-sm font-semibold ink-input-inset"
      />

      {/* Diagram Nodes Editor */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-secondary">
            {v.diagramNodesHeading}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const arranged = block.spec.nodes.map((node, nIdx) => {
                  const col = nIdx % 3;
                  const row = Math.floor(nIdx / 3);
                  return {
                    ...node,
                    x: 24 + col * 215,
                    y: 32 + row * 108,
                    width: node.width || 165,
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
            <button
              type="button"
              onClick={() => {
                const nNum = block.spec.nodes.length + 1;
                const col = (nNum - 1) % 3;
                const row = Math.floor((nNum - 1) / 3);
                const nextNode: SketchNode = {
                  id: `n${nNum}_${Date.now().toString(36).slice(-2)}`,
                  label: `Node ${nNum}`,
                  sublabel: '',
                  x: 24 + col * 215,
                  y: 32 + row * 108,
                  width: 165,
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
              }}
              className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink cursor-pointer"
            >
              {v.diagramAddNode}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {block.spec.nodes.map((node, nIdx) => {
            const updateNode = (patch: Partial<SketchNode>) => {
              const nextNodes = block.spec.nodes.map((item, i) =>
                i === nIdx ? { ...item, ...patch } : item,
              );
              onUpdate({
                ...block,
                spec: { ...block.spec, nodes: nextNodes },
              });
            };

            return (
              <div
                key={node.id}
                className="p-2.5 rounded-xl bg-surface-sheet border border-border-subtle space-y-2"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={node.label}
                    onChange={(e) => updateNode({ label: e.target.value })}
                    placeholder={v.diagramNodeLabelPlaceholder}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-semibold"
                  />
                  <input
                    type="text"
                    value={node.sublabel ?? ''}
                    onChange={(e) => updateNode({ sublabel: e.target.value })}
                    placeholder={v.diagramNodeSubPlaceholder}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-raised text-ink-secondary border border-border-subtle text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const removedId = node.id;
                      const nextNodes = block.spec.nodes.filter(
                        (_, i) => i !== nIdx,
                      );
                      const nextEdges = block.spec.edges.filter(
                        (ed) => ed.from !== removedId && ed.to !== removedId,
                      );
                      onUpdate({
                        ...block,
                        spec: { nodes: nextNodes, edges: nextEdges },
                      });
                    }}
                    aria-label={v.deleteBlock}
                    className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer shrink-0"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-dashed border-border-subtle/70">
                  <select
                    value={node.tone}
                    onChange={(e) =>
                      updateNode({
                        tone: e.target.value as SketchNode['tone'],
                      })
                    }
                    aria-label="Tone"
                    className="min-w-28 min-h-7 ps-2.5 pe-6 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono"
                  >
                    {SKETCH_TONES.map((tone) => (
                      <option key={tone} value={tone}>
                        {tone}
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex items-center gap-1 text-xs font-mono text-ink-muted">
                    <span>X</span>
                    <input
                      type="number"
                      value={node.x}
                      onChange={(e) =>
                        updateNode({ x: Number(e.target.value) || 0 })
                      }
                      className="w-20 min-h-7 px-2 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono tabular-nums"
                    />
                  </label>

                  <label className="inline-flex items-center gap-1 text-xs font-mono text-ink-muted">
                    <span>Y</span>
                    <input
                      type="number"
                      value={node.y}
                      onChange={(e) =>
                        updateNode({ y: Number(e.target.value) || 0 })
                      }
                      className="w-20 min-h-7 px-2 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs font-mono tabular-nums"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Diagram Edges Editor */}
      <div className="space-y-2 pt-1 border-t border-dashed border-border-subtle">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-secondary">
            {v.diagramEdgesHeading}
          </span>
          <button
            type="button"
            disabled={block.spec.nodes.length < 2}
            onClick={() => {
              const n0 = block.spec.nodes[0]?.id ?? '';
              const n1 = block.spec.nodes[1]?.id ?? n0;
              onUpdate({
                ...block,
                spec: {
                  ...block.spec,
                  edges: [
                    ...block.spec.edges,
                    { from: n0, to: n1, label: '' },
                  ],
                },
              });
            }}
            className="ui-press-tactile min-h-7 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-surface-sheet border border-border-subtle hover:border-border-ink text-link-ink disabled:opacity-40 cursor-pointer"
          >
            {v.diagramAddEdge}
          </button>
        </div>

        <div className="space-y-2">
          {block.spec.edges.map((edge, eIdx) => (
            <div
              key={eIdx}
              className="p-2.5 rounded-xl bg-surface-sheet border border-border-subtle space-y-2"
            >
              <div className="flex items-center gap-1.5">
                <select
                  value={edge.from}
                  onChange={(e) => {
                    const nextEdges = block.spec.edges.map((ed, i) =>
                      i === eIdx ? { ...ed, from: e.target.value } : ed,
                    );
                    onUpdate({
                      ...block,
                      spec: { ...block.spec, edges: nextEdges },
                    });
                  }}
                  className="flex-1 min-w-0 min-h-7 ps-2 pe-6 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                >
                  {block.spec.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label || n.id}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden="true"
                  className="text-xs font-mono text-ink-muted shrink-0"
                >
                  →
                </span>
                <select
                  value={edge.to}
                  onChange={(e) => {
                    const nextEdges = block.spec.edges.map((ed, i) =>
                      i === eIdx ? { ...ed, to: e.target.value } : ed,
                    );
                    onUpdate({
                      ...block,
                      spec: { ...block.spec, edges: nextEdges },
                    });
                  }}
                  className="flex-1 min-w-0 min-h-7 ps-2 pe-6 py-1 rounded-lg bg-surface-raised text-ink-primary border border-border-subtle text-xs"
                >
                  {block.spec.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label || n.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={edge.label ?? ''}
                  onChange={(e) => {
                    const nextEdges = block.spec.edges.map((ed, i) =>
                      i === eIdx ? { ...ed, label: e.target.value } : ed,
                    );
                    onUpdate({
                      ...block,
                      spec: { ...block.spec, edges: nextEdges },
                    });
                  }}
                  placeholder={v.diagramEdgeLabelPlaceholder}
                  className="flex-1 min-w-0 min-h-7 px-2.5 py-1 rounded-lg bg-surface-raised text-ink-secondary border border-border-subtle text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const nextEdges = block.spec.edges.filter(
                      (_, i) => i !== eIdx,
                    );
                    onUpdate({
                      ...block,
                      spec: { ...block.spec, edges: nextEdges },
                    });
                  }}
                  aria-label={v.deleteBlock}
                  className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-accent-danger hover:bg-surface-raised cursor-pointer shrink-0"
                >
                  <IconTrash className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
