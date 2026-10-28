import type { GraphEdge, GraphNode, GraphNodeType } from "@/lib/validators/graph";
import { NODE_COLORS } from "./components/graph-styles";
import { NODE_HEIGHT, NODE_WIDTH, type Positions } from "./layout/compute-layout";

// "Exportar a PNG o SVG" (PRD §8.12.4): the visible nodes and edges drawn as a standalone SVG from the layout
// positions (no DOM capture, no extra dependency); the PNG rasterizes that SVG on a canvas at 2x.

const PADDING = 40;

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);

const clip = (value: string, max = 26) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export function graphToSvg(input: {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  positions: Positions;
  typeLabel: (type: GraphNodeType) => string;
}): { svg: string; width: number; height: number } {
  const placed = input.nodes.filter((node) => input.positions[node.id]);
  const xs = placed.map((node) => input.positions[node.id]?.x ?? 0);
  const ys = placed.map((node) => input.positions[node.id]?.y ?? 0);
  const minX = Math.min(0, ...xs) - NODE_WIDTH / 2 - PADDING;
  const minY = Math.min(0, ...ys) - NODE_HEIGHT / 2 - PADDING;
  const width = Math.ceil(Math.max(0, ...xs) + NODE_WIDTH / 2 + PADDING - minX);
  const height = Math.ceil(Math.max(0, ...ys) + NODE_HEIGHT / 2 + PADDING - minY);
  const at = (id: string) => {
    const point = input.positions[id] ?? { x: 0, y: 0 };
    return { x: point.x - minX, y: point.y - minY };
  };

  const lines = input.edges
    .filter((edge) => input.positions[edge.source] && input.positions[edge.target])
    .map((edge) => {
      const a = at(edge.source);
      const b = at(edge.target);
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#94a3b8" stroke-width="1.5"/>`;
    });
  const boxes = placed.map((node) => {
    const { x, y } = at(node.id);
    const left = x - NODE_WIDTH / 2;
    const top = y - NODE_HEIGHT / 2;
    const color = NODE_COLORS[node.type];
    const subtitle = [input.typeLabel(node.type), node.code].filter(Boolean).join(" · ");
    return [
      `<g>`,
      `<rect x="${left}" y="${top}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="12" fill="#ffffff" stroke="${color}" stroke-width="1.5"/>`,
      `<rect x="${left + 10}" y="${top + 12}" width="32" height="32" rx="8" fill="${color}"/>`,
      `<text x="${left + 52}" y="${top + 25}" font-family="sans-serif" font-size="13" font-weight="600" fill="#0f172a">${escapeXml(clip(node.label))}</text>`,
      `<text x="${left + 52}" y="${top + 42}" font-family="sans-serif" font-size="11" fill="#64748b">${escapeXml(clip(subtitle, 30))}</text>`,
      `</g>`,
    ].join("");
  });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ...lines,
    ...boxes,
    `</svg>`,
  ].join("");
  return { svg, width, height };
}

function download(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function downloadSvg(svg: string, filename: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadPng(
  svg: string,
  width: number,
  height: number,
  filename: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("canvas unavailable"));
      context.scale(scale, scale);
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("png encoding failed"));
        const url = URL.createObjectURL(blob);
        download(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 0);
        resolve();
      }, "image/png");
    };
    image.onerror = () => reject(new Error("svg rendering failed"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
