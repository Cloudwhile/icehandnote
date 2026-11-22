/*
 * Refactoring UI Constraint Brief (Workflow B & C Refined):
 * - Content Ranking: Primary = Node labels (`--ink-primary`, `font-hand`);
 *   Secondary = Edge labels & sublabels (`--ink-secondary`); Tertiary = Figure caption (`--ink-muted`).
 * - Hand-Drawn Engine: Uses `roughjs` on `<svg>` reading semantic CSS custom properties (`--sketch-*`),
 *   scoped via `useRef<SVGGElement>` (zero duplicate DOM IDs), with direction-aware edge arrows.
 */

import { useEffect, useRef } from 'react';
import rough from 'roughjs';
import type { ResolvedTheme } from '../../lib/theme';
import type { SketchNode, SketchSpec } from '../../lib/types';

interface RoughDiagramProps {
  spec: SketchSpec;
  caption?: string | null;
  theme: ResolvedTheme;
}

function readToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

export function computeEdgeEndpoints(src: SketchNode, dst: SketchNode) {
  const sw = src.width ?? 150;
  const sh = src.height ?? 64;
  const dw = dst.width ?? 150;
  const dh = dst.height ?? 64;

  const scx = src.x + sw / 2;
  const scy = src.y + sh / 2;
  const dcx = dst.x + dw / 2;
  const dcy = dst.y + dh / 2;

  const dx = dcx - scx;
  const dy = dcy - scy;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) {
      return { x1: src.x + sw + 4, y1: scy, x2: dst.x - 6, y2: dcy };
    }
    return { x1: src.x - 4, y1: scy, x2: dst.x + dw + 6, y2: dcy };
  }
  if (dy >= 0) {
    return { x1: scx, y1: src.y + sh + 4, x2: dcx, y2: dst.y - 6 };
  }
  return { x1: scx, y1: src.y - 4, x2: dcx, y2: dst.y + dh + 6 };
}

export function RoughDiagram({ spec, caption, theme }: RoughDiagramProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const roughLayerRef = useRef<SVGGElement | null>(null);

  const maxX = Math.max(
    640,
    ...spec.nodes.map((n) => n.x + (n.width ?? 150) + 28),
  );
  const maxY = Math.max(
    148,
    ...spec.nodes.map((n) => n.y + (n.height ?? 64) + 32),
  );

  useEffect(() => {
    const svg = svgRef.current;
    const roughLayer = roughLayerRef.current;
    if (!svg || !roughLayer) return;

    roughLayer.replaceChildren();

    const styles = getComputedStyle(document.documentElement);
    const inkColor = readToken(styles, '--sketch-ink', theme === 'dark' ? '#d3dee4' : '#352722');

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
    const nodeMap = new Map(spec.nodes.map((n) => [n.id, n]));

    // Draw direction-aware edges first
    for (const edge of spec.edges) {
      const src = nodeMap.get(edge.from);
      const dst = nodeMap.get(edge.to);
      if (!src || !dst) continue;

      const { x1, y1, x2, y2 } = computeEdgeEndpoints(src, dst);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 10;
      const spread = Math.PI / 6;

      const lineNode = rc.line(x1, y1, x2, y2, {
        stroke: inkColor,
        strokeWidth: 2,
        roughness: 1.3,
        seed: 42,
      });
      roughLayer.appendChild(lineNode);

      const arrowHead = rc.linearPath(
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
        { stroke: inkColor, strokeWidth: 2, roughness: 1.1, seed: 77 },
      );
      roughLayer.appendChild(arrowHead);
    }

    // Draw sketched boxes
    spec.nodes.forEach((node, idx) => {
      const w = node.width ?? 150;
      const h = node.height ?? 64;
      const colors = palette[node.tone] ?? palette.violet;
      const rect = rc.rectangle(node.x, node.y, w, h, {
        stroke: colors.stroke,
        strokeWidth: 2,
        fill: colors.fill,
        fillStyle: 'hachure',
        hachureGap: 7,
        roughness: 1.25,
        bowing: 1.4,
        seed: 100 + idx * 17,
      });
      roughLayer.appendChild(rect);
    });
  }, [spec, theme]);

  return (
    <figure className="my-7 mx-0 rounded-xl border border-border-subtle bg-surface-raised/60 p-4 overflow-x-auto overscroll-x-contain ink-thin-scrollbar">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${maxX} ${maxY}`}
        className={`w-full h-auto block ${maxX > 720 ? 'min-w-[420px] sm:min-w-0' : 'min-w-0'}`}
        role="img"
        aria-label={caption ?? 'Hand-drawn architecture diagram'}
      >
        <g ref={roughLayerRef} />
        {/* Crisp text labels layered above Rough.js hachure boxes using semantic tokens */}
        {spec.edges.map((edge, idx) => {
          const src = spec.nodes.find((n) => n.id === edge.from);
          const dst = spec.nodes.find((n) => n.id === edge.to);
          if (!src || !dst || !edge.label) return null;
          const { x1, y1, x2, y2 } = computeEdgeEndpoints(src, dst);
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - 10;
          const units = Array.from(edge.label).reduce(
            (sum, ch) => sum + (ch.charCodeAt(0) > 0x2e7f ? 1.85 : 1.05),
            0,
          );
          const pillW = Math.max(28, Math.ceil(units * 7 + 12));
          const pillH = 18;
          return (
            <g key={idx}>
              <rect
                x={mx - pillW / 2}
                y={my - 13}
                width={pillW}
                height={pillH}
                rx={5}
                fill="var(--surface-sheet)"
                stroke="var(--border-subtle)"
                strokeWidth="1"
              />
              <text
                x={mx}
                y={my}
                textAnchor="middle"
                fill="var(--ink-secondary)"
                fontSize="12"
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                {edge.label}
              </text>
            </g>
          );
        })}

        {spec.nodes.map((node) => {
          const w = node.width ?? 150;
          const h = node.height ?? 64;
          const cx = node.x + w / 2;
          const cy = node.y + h / 2;
          return (
            <g key={node.id}>
              <text
                x={cx}
                y={node.sublabel ? cy - 5 : cy + 5}
                textAnchor="middle"
                fill="var(--ink-primary)"
                fontSize="14"
                fontFamily="var(--font-hand)"
                fontWeight="600"
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
                >
                  {node.sublabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {caption && (
        <figcaption
          className="mt-2 text-center text-xs text-ink-muted"
          style={{ fontFamily: 'var(--font-hand)' }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
