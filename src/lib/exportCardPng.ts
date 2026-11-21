import type { CreatureRecord } from '../db/creatures';
import type { ThemeMode } from '../store/useThemeStore';
import {
  computeScallopSegments,
  formatCreatureDate,
  formatTypeLabel,
  RARITY_THEME,
  STAT_SPECS,
  SUBSTANCE_THEME,
} from '../ui/theme';
import { loadImageElement } from './image';

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function truncateLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}${ellipsis}`).width > maxWidth) {
    end -= 1;
  }
  return `${text.slice(0, end)}${ellipsis}`;
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (ctx.measureText(text).width <= maxWidth || maxLines <= 1) {
    return [truncateLine(ctx, text, maxWidth)];
  }

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0 && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      lines.push(truncateLine(ctx, remaining, maxWidth));
      break;
    }

    if (ctx.measureText(remaining).width <= maxWidth) {
      lines.push(remaining);
      break;
    }

    // Find the longest prefix fitting within maxWidth, preferring a break after `・` or whitespace.
    let fit = 1;
    while (fit < remaining.length && ctx.measureText(remaining.slice(0, fit + 1)).width <= maxWidth) {
      fit += 1;
    }

    let splitAt = fit;
    for (let i = fit; i >= Math.max(2, fit - 6); i -= 1) {
      const ch = remaining[i - 1];
      if (ch === '・' || ch === ' ' || ch === '-' || ch === '/') {
        splitAt = i;
        break;
      }
    }

    lines.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return lines;
}

function drawScallopBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  initial: string,
  bg: string,
  dark: string,
  showDash: boolean,
  isDark: boolean,
): void {
  const trace = (ox: number, oy: number, ro: number, ri: number) => {
    const segments = computeScallopSegments(ox, oy, ro, ri, 14);
    ctx.beginPath();
    segments.forEach((seg, i) => {
      if (i === 0) ctx.moveTo(seg.startX, seg.startY);
      ctx.quadraticCurveTo(seg.cpX, seg.cpY, seg.endX, seg.endY);
    });
    ctx.closePath();
  };

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-7 * Math.PI) / 180);

  trace(0, 3.2, rOuter, rInner);
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1;

  trace(0, 0, rOuter, rInner);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  trace(0, 0, rOuter * 0.85, rInner * 0.85);
  ctx.fillStyle = bg;
  ctx.fill();

  if (showDash) {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.arc(0, 0, rInner * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.58)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 ${Math.round(rOuter * 0.78)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, 0, 2);
  ctx.restore();
}

/**
 * Generates a single shareable PNG containing both Front and Back S1 cards side-by-side.
 */
export async function exportCreatureCardPng(
  creature: CreatureRecord,
  imageUrl: string,
  mode: ThemeMode,
): Promise<Blob> {
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready;
  }

  const isDark = mode === 'dark';
  const sub = SUBSTANCE_THEME[creature.primaryType];
  const rar = RARITY_THEME[creature.rarityTier];

  const W = 1040;
  const H = 680;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const bg = isDark ? sub.darkBg : sub.pastel;
  const surface = isDark ? '#20222a' : '#ffffff';
  const surfaceSub = isDark ? '#181a21' : sub.pastel;
  const stroke = isDark ? sub.darkStroke : sub.stroke;
  const lip = isDark ? sub.darkLip : sub.lip;
  const fg = isDark ? '#f4f4f6' : '#1f2026';
  const fgMuted = isDark ? '#9397a6' : '#8c8c96';
  const track = isDark ? '#2c2f3a' : '#eff0f3';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cardW = 420;
  const cardH = 572;
  const topY = 50;
  const leftX = 72;
  const rightX = W - 72 - cardW;

  const drawShell = (x: number) => {
    ctx.fillStyle = lip;
    drawRoundedRect(ctx, x, topY + 8, cardW, cardH, 32);
    ctx.fill();
    ctx.fillStyle = stroke;
    drawRoundedRect(ctx, x - 3, topY - 3, cardW + 6, cardH + 6, 35);
    ctx.fill();
    ctx.fillStyle = surface;
    drawRoundedRect(ctx, x, topY, cardW, cardH, 32);
    ctx.fill();
  };

  drawShell(leftX);
  drawShell(rightX);

  const img = await loadImageElement(imageUrl);
  const px = leftX + 14;
  const py = topY + 14;
  const pw = cardW - 28;
  const ph = Math.round(cardH * 0.56) - 14;

  ctx.save();
  drawRoundedRect(ctx, px, py, pw, ph, 22);
  ctx.clip();
  const coverScale = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
  const dw = img.naturalWidth * coverScale;
  const dh = img.naturalHeight * coverScale;
  ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  ctx.restore();

  // Front scalloped sticker
  drawScallopBadge(
    ctx,
    leftX + cardW - 52,
    topY + Math.round(cardH * 0.56),
    44,
    38,
    rar.initial,
    rar.bg,
    rar.dark,
    true,
    isDark,
  );

  // Front Name (up to 2 wrapped lines, no horizontal squishing)
  ctx.fillStyle = fg;
  ctx.font = '800 30px "LINE Seed JP", "Hiragino Maru Gothic ProN", "Rounded Mplus 1c", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const frontLines = wrapTextLines(ctx, creature.name, cardW - 122, 2);
  const nameStartY = topY + Math.round(cardH * 0.56) + 28;
  frontLines.forEach((line, idx) => {
    ctx.fillText(line, leftX + 24, nameStartY + idx * 38);
  });

  // Front Type Pill + Date
  const typeText = formatTypeLabel(creature.primaryType, creature.secondaryType);
  const dateText = formatCreatureDate(creature.createdAt);
  const badgeY = topY + cardH - 54;
  ctx.font = '800 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  const tw = ctx.measureText(typeText).width + 30;
  ctx.fillStyle = sub.popDark;
  drawRoundedRect(ctx, leftX + 24, badgeY + 3, tw, 32, 16);
  ctx.fill();
  ctx.fillStyle = sub.pop;
  drawRoundedRect(ctx, leftX + 24, badgeY, tw, 32, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(typeText, leftX + 39, badgeY + 16);

  ctx.fillStyle = fgMuted;
  ctx.font = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(dateText, leftX + cardW - 24, badgeY + 16);

  // Back Header (truncated cleanly with ellipsis, never squished)
  ctx.fillStyle = fg;
  ctx.font = '800 24px "LINE Seed JP", "Hiragino Maru Gothic ProN", "Rounded Mplus 1c", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(truncateLine(ctx, creature.name, cardW - 104), rightX + 26, topY + 46);
  drawScallopBadge(
    ctx,
    rightX + cardW - 44,
    topY + 46,
    24,
    21,
    rar.initial,
    rar.bg,
    rar.dark,
    false,
    isDark,
  );

  ctx.fillStyle = surfaceSub;
  ctx.fillRect(rightX + 24, topY + 78, cardW - 48, 3);

  // Back 5 Flat Stat Bars (dynamic gap after EN label to match DOM)
  STAT_SPECS.forEach((spec, idx) => {
    const y = topY + 116 + idx * 78;
    const val = creature.stats[spec.key];

    ctx.textAlign = 'left';
    ctx.fillStyle = fg;
    ctx.font = '900 17px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(spec.en, rightX + 26, y);
    const enWidth = ctx.measureText(spec.en).width;

    ctx.fillStyle = fgMuted;
    ctx.font = '700 15px "LINE Seed JP", "Hiragino Maru Gothic ProN", sans-serif';
    ctx.fillText(spec.ja, rightX + 26 + enWidth + 10, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = fg;
    ctx.font = '900 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(String(val), rightX + cardW - 26, y);

    const barW = cardW - 52;
    ctx.fillStyle = track;
    drawRoundedRect(ctx, rightX + 26, y + 18, barW, 14, 7);
    ctx.fill();

    ctx.fillStyle = spec.color;
    drawRoundedRect(ctx, rightX + 26, y + 18, Math.max(14, barW * (val / 100)), 14, 7);
    ctx.fill();
  });

  // Back Footer (matches DOM CreatureCard)
  ctx.fillStyle = surfaceSub;
  ctx.fillRect(rightX + 24, topY + cardH - 60, cardW - 48, 3);
  ctx.fillStyle = fgMuted;
  ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(typeText, rightX + 26, topY + cardH - 34);
  ctx.textAlign = 'right';
  ctx.fillText(dateText, rightX + cardW - 26, topY + cardH - 34);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG の書き出しに失敗しました'));
    }, 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownloadPng(
  blob: Blob,
  filename: string,
  title: string,
): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ title, files: [file] });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'shared';
      }
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
