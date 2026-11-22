import type { CSSProperties, ReactNode } from 'react';
import type { AlertKind } from '../../lib/types';

export interface PixelStickerProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Optional subtle accessible title; decorative by default */
  label?: string;
}

interface PixelGridSpriteProps extends PixelStickerProps {
  grid: readonly string[];
  palette: Readonly<Record<string, string>>;
  /** Optional extra vector pixel layers (e.g. rising steam wisps) */
  overlay?: ReactNode;
  /** Enable die-cut warm cream vinyl halo around pixels */
  vinylDieCut?: boolean;
}

interface RunRect {
  x: number;
  y: number;
  w: number;
  fill: string;
}

function compilePixelRuns(
  grid: readonly string[],
  palette: Readonly<Record<string, string>>,
  pad: number,
): {
  fills: RunRect[];
  halos: Array<{ x: number; y: number }>;
  width: number;
  height: number;
} {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const fills: RunRect[] = [];
  const haloSet = new Set<string>();
  const halos: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < rows; y += 1) {
    const row = grid[y] ?? '';
    let x = 0;
    while (x < cols) {
      const ch = row[x];
      if (!ch || ch === '.' || !palette[ch]) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < cols && row[end] === ch) {
        end += 1;
      }
      fills.push({
        x: x + pad,
        y: y + pad,
        w: end - x,
        fill: palette[ch],
      });
      for (let px = x; px < end; px += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = px + dx + pad;
            const ny = y + dy + pad;
            const key = `${nx},${ny}`;
            if (!haloSet.has(key)) {
              haloSet.add(key);
              halos.push({ x: nx, y: ny });
            }
          }
        }
      }
      x = end;
    }
  }

  return {
    fills,
    halos,
    width: cols + pad * 2,
    height: rows + pad * 2,
  };
}

/** Crisp SVG pixel-grid sprite renderer with optional vinyl die-cut outline */
function PixelGridSprite({
  grid,
  palette,
  size = 44,
  className = '',
  style,
  label,
  overlay,
  vinylDieCut = true,
}: PixelGridSpriteProps) {
  const pad = vinylDieCut ? 1 : 0;
  const { fills, halos, width, height } = compilePixelRuns(grid, palette, pad);
  const viewH = Math.round((size * height) / width);

  return (
    <svg
      width={size}
      height={viewH}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      fill="none"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      className={`pixel-sticker shrink-0 select-none ${className}`}
      style={style}
    >
      {label && <title>{label}</title>}
      {vinylDieCut && (
        <g>
          {halos.map((h) => (
            <rect
              key={`rim-${h.x}-${h.y}`}
              x={h.x}
              y={h.y}
              width={1}
              height={1}
              fill="var(--pixel-vinyl-halo, #fffdf7)"
            />
          ))}
        </g>
      )}
      <g>
        {fills.map((r, idx) => (
          <rect
            key={`${idx}-${r.x}-${r.y}`}
            x={r.x}
            y={r.y}
            width={r.w}
            height={1}
            fill={r.fill}
          />
        ))}
      </g>
      {overlay}
    </svg>
  );
}

/* 1. Peeking Ginger & Cream Cat Bookmark */
const CAT_GRID = [
  '..oo......oo....',
  '.oGgo....ogGo...',
  '.oPGo....ogPo...',
  '.oGGOooooOGGo...',
  '.oGGGggggGGGo...',
  'oGGgGGGGGGgGGo..',
  'oGGkGwwwwGkGGo..',
  'oGbGGwppwGGbGo..',
  'oGGGGwwwwGGGGo..',
  '.owwwwwwwwwwo...',
  '.owGGwwwwGGwo...',
  '.oooowwwwoooo...',
  '.oWWo....oWWo...',
  '.oooo....oooo...',
] as const;

const CAT_PALETTE: Record<string, string> = {
  o: '#3d281c',
  G: '#e58e49',
  g: '#c76c2b',
  O: '#f4b072',
  P: '#f49ca8',
  k: '#241a18',
  w: '#fff9ef',
  W: '#f3e5cf',
  b: '#f48ea0',
  p: '#e87990',
};

export function PixelCatBookmarkSticker({
  size = 46,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={CAT_GRID}
      palette={CAT_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 2. Faceted Cobalt Inkwell + Feather Quill */
const INK_QUILL_GRID = [
  '..........ooo...',
  '.........oQQqo..',
  '........oQqqqo..',
  '.......oQqqQo...',
  '......oQqqQo....',
  '.....oQQqQo.....',
  '.....oqQqo......',
  '....obbbbo......',
  '...oGGGGGGoo....',
  '..oGccCCCcGGoo..',
  '..oGcLLCCccccGo.',
  '..oGccCCCCCCcGo.',
  '..oGCCCCCCCCcGo.',
  '..oGccDDDDDCcGo.',
  '...oGGGGGGGGGo..',
  '....ooooooooo...',
] as const;

const INK_QUILL_PALETTE: Record<string, string> = {
  o: '#222b3e',
  Q: '#fff6de',
  q: '#d7c395',
  b: '#b8864b',
  G: '#375888',
  C: '#2957a4',
  c: '#487cd0',
  L: '#a6d2ff',
  D: '#193568',
};

export function PixelInkQuillSticker({
  size = 44,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={INK_QUILL_GRID}
      palette={INK_QUILL_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 3. Ceramic Coffee Mug with Heart Foam + Animated Steam */
const COFFEE_MUG_GRID = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..oooooooooo....',
  '.oCCCCCCCCCCo...',
  '.oCEEEppEEECooo.',
  '.oCEEEEEEEECoCCo',
  '.oCccCCCCccCo.Co',
  '.oCCCCCCCCCCoCCo',
  '.oCCddddddCCooo.',
  '.oCCddddddCCo...',
  '..oCCCCCCCCo....',
  '...oooooooo.....',
  '................',
] as const;

const COFFEE_MUG_PALETTE: Record<string, string> = {
  o: '#3d2c22',
  C: '#f6ede0',
  c: '#e2cfb8',
  d: '#d48d59',
  E: '#693f27',
  p: '#f5b8a8',
};

export function PixelCoffeeMugSticker({
  size = 44,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={COFFEE_MUG_GRID}
      palette={COFFEE_MUG_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
      overlay={
        <g className="pixel-steam">
          <rect x={5} y={3} width={1} height={2} fill="#8ea4bf" fillOpacity={0.75} />
          <rect x={6} y={2} width={1} height={1} fill="#b8cce0" fillOpacity={0.7} />
          <rect x={9} y={2} width={1} height={2} fill="#8ea4bf" fillOpacity={0.75} />
          <rect x={10} y={1} width={1} height={1} fill="#b8cce0" fillOpacity={0.7} />
        </g>
      }
    />
  );
}

/* 4. Signature 6-Point IceHandnote Frost Crystal */
const ICE_CRYSTAL_GRID = [
  '.......o.......',
  '..s...oCo...s..',
  '.....oCLCo.....',
  '..oo..oCo..oo..',
  '..oCo.oCo.oCo..',
  '...oCooCooCo...',
  '.oo.oCCWCCo.oo.',
  'oCLCoCWwWCoCLCo',
  '.oo.oCCWCCo.oo.',
  '...oCooCooCo...',
  '..oCo.oCo.oCo..',
  '..oo..oCo..oo..',
  '.....oCLCo.....',
  '..s...oCo...s..',
  '.......o.......',
] as const;

const ICE_CRYSTAL_PALETTE: Record<string, string> = {
  o: '#224c7d',
  C: '#5ca9e6',
  L: '#a6dcff',
  W: '#e8f7ff',
  w: '#ffffff',
  s: '#7cc6f8',
};

export function PixelIceCrystalSticker({
  size = 42,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={ICE_CRYSTAL_GRID}
      palette={ICE_CRYSTAL_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 5. Terracotta Potted Pixel Sprout (Beginner) */
const SPROUT_POT_GRID = [
  '.......oo......',
  '..ooo.oLlo.....',
  '.oLLloLLlGo.oo.',
  '.oLllGGlllGoGLo',
  '..oooGGooGGLLLo',
  '......oGo.oooo.',
  '......oGo......',
  '...ooooooooo...',
  '..oTTTTTTTTTo..',
  '..oTtttttttTo..',
  '...oRRRRRRRo...',
  '...oTRRRRTTo...',
  '...oTRRRRddo...',
  '....oRRRRRo....',
  '....ooooooo....',
  '...............',
] as const;

const SPROUT_POT_PALETTE: Record<string, string> = {
  o: '#293524',
  L: '#7cd066',
  l: '#52aa46',
  G: '#357b34',
  T: '#e0895e',
  t: '#c66840',
  R: '#b85a35',
  d: '#8c3f23',
};

export function PixelSproutPotSticker({
  size = 42,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={SPROUT_POT_GRID}
      palette={SPROUT_POT_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 6. Antique Brass Pocket Compass (Intermediate) */
const COMPASS_GRID = [
  '......oooo.....',
  '.....oBBBBoo...',
  '....ooBBBBoo...',
  '...oBGGGGGBBo..',
  '..oBGppppppGBo.',
  '.oBGpppkppppGBo',
  '.oBGppprrpppGBo',
  '.oBGpprrrpppGBo',
  '.oBGpppkssppGBo',
  '.oBGpppppssPGBo',
  '.oBGppppppppGBo',
  '..oBGppppppGBo.',
  '...oBGGGGGBBo..',
  '....oBBBBBBoo..',
  '.....oooooo....',
  '...............',
] as const;

const COMPASS_PALETTE: Record<string, string> = {
  o: '#2c2319',
  B: '#e8b949',
  G: '#b88329',
  p: '#fcf5e6',
  P: '#e6d8be',
  k: '#6b5e4c',
  r: '#d34646',
  s: '#4f78a8',
};

export function PixelCompassSticker({
  size = 42,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={COMPASS_GRID}
      palette={COMPASS_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 7. Retro 3.5" Pixel Floppy Disk (Advanced) */
const FLOPPY_GRID = [
  '.oooooooooooo..',
  '.oBBmmmmmmBBo..',
  '.oBBmSSssSBBoO.',
  '.oBBmSSssSBBoBO',
  '.oBBmSSssSBBoBo',
  '.oBBBBBBBBBBBBo',
  '.oBBBBBBBBBBBBo',
  '.oBBwwwwwwwwBBo',
  '.oBBrrrrrrrrBBo',
  '.oBBwwwwwwwwBBo',
  '.oBBwggggggwBBo',
  '.oBBwwwwwwwwBBo',
  '.oBBwggggggwBBo',
  '.oBBBBBBBBBBBBo',
  '.oooooooooooooo',
  '...............',
] as const;

const FLOPPY_PALETTE: Record<string, string> = {
  o: '#1f2842',
  B: '#3b67b5',
  O: '#2d5091',
  m: '#9cb0cc',
  S: '#dce5f2',
  s: '#627391',
  w: '#fcfaf2',
  r: '#e0584a',
  g: '#b4bcc9',
};

export function PixelFloppyDiskSticker({
  size = 42,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={FLOPPY_GRID}
      palette={FLOPPY_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 8. Brass & Mahogany Hourglass (Stale Content Notice) */
const HOURGLASS_GRID = [
  '..ooooooooooo..',
  '.oWWWWWWWWWWWo.',
  '.obrrrrrrrrrbo.',
  '..oGGgggggGGo..',
  '..oGgggggggGo..',
  '...oGgAAAgGo...',
  '....oGAAAgGo...',
  '.....oGAao.....',
  '.....oGggo.....',
  '....oGgAggo....',
  '...oGgAAAgGo...',
  '..oGgAAAAAggo..',
  '..oGAAAAAAAGo..',
  '.obrrrrrrrrrbo.',
  '.oWWWWWWWWWWWo.',
  '..ooooooooooo..',
] as const;

const HOURGLASS_PALETTE: Record<string, string> = {
  o: '#332014',
  W: '#b56e3d',
  r: '#7f4421',
  b: '#5c2e13',
  G: '#bfe0f2',
  g: '#e5f5fc',
  A: '#eeb344',
  a: '#d18725',
};

export function PixelHourglassSticker({
  size = 40,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={HOURGLASS_GRID}
      palette={HOURGLASS_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 9. Golden Star Wax Achievement Seal */
const STAR_STAMP_GRID = [
  '..s....o....s..',
  '......oHo......',
  '.....oHYHo.....',
  '..ooooHYHoooo..',
  '.oHHHYYYYYYGGo.',
  '..oHYYYYYYGGo..',
  '...oYYYYYGGo...',
  '....oYYYYGo....',
  '...oYYYoYYGo...',
  '..oYYGo.oYGGo..',
  '.oYGGo...oGGAo.',
  '.oooo.....oooo.',
  '......s.....s..',
] as const;

const STAR_STAMP_PALETTE: Record<string, string> = {
  o: '#593b12',
  H: '#fff3a8',
  Y: '#f7c544',
  G: '#dc9326',
  A: '#b46f18',
  s: '#ffd76b',
};

export function PixelStarStampSticker({
  size = 38,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={STAR_STAMP_GRID}
      palette={STAR_STAMP_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 10. Origami Cream Paper Plane */
const PAPER_PLANE_GRID = [
  '...........oooo.',
  '.........ooWWWo.',
  '.......ooWWwwWo.',
  '.....ooWWWWwWWo.',
  '...ooWWWWwSSWWo.',
  '.ooWWWWwwSSSWWo.',
  'oWWWWwwSSSSWWo..',
  '.ooooSSDDDDWWo..',
  '....ooSDDDWWo...',
  '..t...oSSSWWo...',
  '......oSDWWo....',
  '.t.....oooo.....',
] as const;

const PAPER_PLANE_PALETTE: Record<string, string> = {
  o: '#35445c',
  W: '#fffdf7',
  w: '#efe9da',
  S: '#cad6e6',
  D: '#92a7c4',
  t: '#5ca9e6',
};

export function PixelPaperPlaneSticker({
  size = 42,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={PAPER_PLANE_GRID}
      palette={PAPER_PLANE_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 11. Warm Glowing Lightbulb Idea Sticker */
const LIGHTBULB_GRID = [
  '.....oooooo.....',
  '...ooHHHYYHoo...',
  '..oHHYYYYYYYHo..',
  '.oHYYYWwwWYYYHo.',
  '.oHYYWYooYWYYHo.',
  '.oHYYWYooYWYYHo.',
  '..oYYYWWWWYYYo..',
  '...ooYYwwYYoo...',
  '.....oGGGGoo....',
  '.....oBBBBoo....',
  '.....oDDDDoo....',
  '.....oBBBBoo....',
  '......oooo......',
] as const;

const LIGHTBULB_PALETTE: Record<string, string> = {
  o: '#3c2e1c',
  H: '#fff9c4',
  Y: '#ffd54f',
  W: '#fffdf7',
  w: '#ffe082',
  G: '#f4b400',
  B: '#b0bec5',
  D: '#78909c',
};

export function PixelLightbulbSticker({
  size = 44,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={LIGHTBULB_GRID}
      palette={LIGHTBULB_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

/* 12. Glossy Coral & Blush Heart Memo Sticker */
const HEART_MEMO_GRID = [
  '..oooo....oooo..',
  '.oPPPoo..ooRRRo.',
  'oPWWPPooooRRRRRo',
  'oPWWPPPPPRRRRDRo',
  'oPPPPPPPRRRRRDRo',
  'oPPPPPRRRRRRDDRo',
  '.oPPPRRRRRRDDRo.',
  '..oPPRRRRRDDRo..',
  '...oPRRRRRDRo...',
  '....oRRRRDRo....',
  '.....oRRDRo.....',
  '......oRRo......',
  '.......oo.......',
] as const;

const HEART_MEMO_PALETTE: Record<string, string> = {
  o: '#592330',
  W: '#fff4f6',
  P: '#f9a8b8',
  R: '#e85d75',
  D: '#c43b55',
};

export function PixelHeartMemoSticker({
  size = 42,
  className = '',
  style,
  label,
}: PixelStickerProps) {
  return (
    <PixelGridSprite
      grid={HEART_MEMO_GRID}
      palette={HEART_MEMO_PALETTE}
      size={size}
      className={className}
      style={style}
      label={label}
    />
  );
}

export type PixelSpriteId =
  | 'cat'
  | 'quill'
  | 'coffee'
  | 'crystal'
  | 'sprout'
  | 'compass'
  | 'floppy'
  | 'hourglass'
  | 'star'
  | 'plane'
  | 'lightbulb'
  | 'heart';

export const ALL_PIXEL_SPRITE_IDS: readonly PixelSpriteId[] = [
  'cat',
  'quill',
  'coffee',
  'crystal',
  'sprout',
  'compass',
  'floppy',
  'hourglass',
  'star',
  'plane',
  'lightbulb',
  'heart',
] as const;

export function normalizePixelSpriteId(raw?: string | null): PixelSpriteId {
  switch ((raw || '').trim().toLowerCase()) {
    case 'cat':
    case 'cat-bookmark':
      return 'cat';
    case 'quill':
    case 'ink-quill':
      return 'quill';
    case 'coffee':
    case 'coffee-mug':
      return 'coffee';
    case 'crystal':
    case 'ice-crystal':
    case 'ice':
      return 'crystal';
    case 'sprout':
    case 'sprout-pot':
      return 'sprout';
    case 'compass':
      return 'compass';
    case 'floppy':
    case 'floppy-disk':
      return 'floppy';
    case 'hourglass':
      return 'hourglass';
    case 'star':
    case 'star-stamp':
      return 'star';
    case 'plane':
    case 'paper-plane':
      return 'plane';
    case 'lightbulb':
    case 'bulb':
    case 'idea':
      return 'lightbulb';
    case 'heart':
    case 'heart-memo':
    case 'love':
      return 'heart';
    default:
      return 'cat';
  }
}

export function pixelSizeToPx(size?: string | null): number {
  switch ((size || '').trim().toLowerCase()) {
    case 'sm':
    case 'small':
      return 42;
    case 'lg':
    case 'large':
      return 80;
    default:
      return 58;
  }
}

export function PixelStickerById({
  sprite,
  size = 58,
  className = '',
  style,
  label,
}: PixelStickerProps & { sprite: string }) {
  const id = normalizePixelSpriteId(sprite);
  switch (id) {
    case 'quill':
      return <PixelInkQuillSticker size={size} className={className} style={style} label={label} />;
    case 'coffee':
      return <PixelCoffeeMugSticker size={size} className={className} style={style} label={label} />;
    case 'crystal':
      return <PixelIceCrystalSticker size={size} className={className} style={style} label={label} />;
    case 'sprout':
      return <PixelSproutPotSticker size={size} className={className} style={style} label={label} />;
    case 'compass':
      return <PixelCompassSticker size={size} className={className} style={style} label={label} />;
    case 'floppy':
      return <PixelFloppyDiskSticker size={size} className={className} style={style} label={label} />;
    case 'hourglass':
      return <PixelHourglassSticker size={size} className={className} style={style} label={label} />;
    case 'star':
      return <PixelStarStampSticker size={size} className={className} style={style} label={label} />;
    case 'plane':
      return <PixelPaperPlaneSticker size={size} className={className} style={style} label={label} />;
    case 'lightbulb':
      return <PixelLightbulbSticker size={size} className={className} style={style} label={label} />;
    case 'heart':
      return <PixelHeartMemoSticker size={size} className={className} style={style} label={label} />;
    case 'cat':
    default:
      return <PixelCatBookmarkSticker size={size} className={className} style={style} label={label} />;
  }
}

/** Semantic pixel sticker matched to series difficulty level */
export function getDifficultyPixelSticker(difficulty: string, size = 32) {
  switch (difficulty.toLowerCase()) {
    case 'beginner':
    case 'intro':
      return <PixelSproutPotSticker size={size} />;
    case 'intermediate':
      return <PixelCompassSticker size={size} />;
    case 'advanced':
      return <PixelFloppyDiskSticker size={size} />;
    default:
      return <PixelIceCrystalSticker size={size} />;
  }
}

/** Subtle semantic corner mini-sticker for stationeries & alerts */
export function getAlertCornerPixelSticker(kind: AlertKind, size = 28) {
  switch (kind) {
    case 'tip':
      return <PixelSproutPotSticker size={size} />;
    case 'note':
      return <PixelInkQuillSticker size={size} />;
    case 'info':
      return <PixelIceCrystalSticker size={size} />;
    case 'warning':
      return <PixelHourglassSticker size={size} />;
    case 'danger':
      return <PixelCompassSticker size={size} />;
    default:
      return <PixelStarStampSticker size={size} />;
  }
}
