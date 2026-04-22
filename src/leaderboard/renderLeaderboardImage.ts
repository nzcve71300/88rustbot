import { createCanvas, loadImage, registerFont, type CanvasRenderingContext2D } from "canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ClanLeaderboardRow } from "../db/clanLeaderboard.js";
import { formatKdRatio } from "../stats/kdRatio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "..", "images", "leaderboardnew.png");
/** Bundled OFL font — Linux servers often lack Segoe/Helvetica; without a real font, canvas draws “tofu” blocks. */
const FONT_FILE = join(__dirname, "..", "fonts", "NotoSans-Regular.ttf");
/** Single-word family so node-canvas/Pango always resolves the registered TTF (multi-word names often fail on Linux). */
const FONT_FAMILY = "LucidLeaderboard";

let fontRegistered = false;
function ensureLeaderboardFont(): void {
  if (fontRegistered) return;
  registerFont(FONT_FILE, { family: FONT_FAMILY });
  fontRegistered = true;
}

/** Canva “pt” at 96 DPI → CSS pixels for canvas */
const PT = 96 / 72;
const FONT_NAME_TAG = `${Math.round(32 * PT)}px`;
const FONT_STATS = `${Math.round(20 * PT)}px`;

const TEXT = "#FFFFFF";

type Pos = { x: number; y: number };
type SlotLayout = {
  name: Pos;
  tag: Pos;
  kills: Pos;
  deaths: Pos;
  kd: Pos;
  members: Pos;
};

/** Positions from Canva (clan 1 = top of leaderboard). */
const SLOTS: SlotLayout[] = [
  {
    name: { x: 355, y: 279 },
    tag: { x: 583, y: 279 },
    kills: { x: 391, y: 325 },
    deaths: { x: 577, y: 325 },
    kd: { x: 683, y: 325 },
    members: { x: 943, y: 325 },
  },
  {
    name: { x: 361, y: 407 },
    tag: { x: 595, y: 407 },
    kills: { x: 388, y: 453 },
    deaths: { x: 578, y: 453 },
    kd: { x: 679, y: 453 },
    members: { x: 941, y: 453 },
  },
  {
    name: { x: 353, y: 535 },
    tag: { x: 588, y: 535 },
    kills: { x: 388, y: 577 },
    deaths: { x: 575, y: 577 },
    kd: { x: 679, y: 577 },
    members: { x: 944, y: 577 },
  },
  {
    name: { x: 395, y: 665 },
    tag: { x: 591, y: 665 },
    kills: { x: 395, y: 707 },
    deaths: { x: 575, y: 707 },
    kd: { x: 681, y: 707 },
    members: { x: 943, y: 707 },
  },
  {
    name: { x: 361, y: 791 },
    tag: { x: 588, y: 791 },
    kills: { x: 391, y: 835 },
    deaths: { x: 583, y: 835 },
    kd: { x: 683, y: 835 },
    members: { x: 943, y: 835 },
  },
  {
    name: { x: 365, y: 919 },
    tag: { x: 588, y: 919 },
    kills: { x: 388, y: 965 },
    deaths: { x: 578, y: 965 },
    kd: { x: 683, y: 965 },
    members: { x: 947, y: 965 },
  },
  {
    name: { x: 357, y: 1041 },
    tag: { x: 588, y: 1041 },
    kills: { x: 388, y: 1091 },
    deaths: { x: 578, y: 1091 },
    kd: { x: 683, y: 1091 },
    members: { x: 941, y: 1091 },
  },
  {
    name: { x: 358, y: 1167 },
    tag: { x: 595, y: 1167 },
    kills: { x: 395, y: 1213 },
    deaths: { x: 577, y: 1213 },
    kd: { x: 679, y: 1213 },
    members: { x: 941, y: 1213 },
  },
  {
    name: { x: 367, y: 1289 },
    tag: { x: 595, y: 1289 },
    kills: { x: 388, y: 1331 },
    deaths: { x: 578, y: 1331 },
    kd: { x: 681, y: 1331 },
    members: { x: 939, y: 1331 },
  },
  {
    name: { x: 373, y: 1411 },
    tag: { x: 593, y: 1411 },
    kills: { x: 391, y: 1455 },
    deaths: { x: 577, y: 1455 },
    kd: { x: 679, y: 1455 },
    members: { x: 941, y: 1455 },
  },
];

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t.slice(0, -1)}…`).width > maxW) t = t.slice(0, -1);
  return t.length ? `${t}…` : "…";
}

/** Always 10 rows; pad with null for empty placeholders. */
export async function renderClanLeaderboardPng(
  _serverName: string,
  rows: ClanLeaderboardRow[]
): Promise<Buffer> {
  const slots: (ClanLeaderboardRow | null)[] = rows.slice(0, 10);
  while (slots.length < 10) slots.push(null);

  let bg;
  try {
    bg = await loadImage(TEMPLATE_PATH);
  } catch (e) {
    throw new Error(
      `Missing or invalid leaderboard template at ${TEMPLATE_PATH}. Add leaderboardnew.png under src/images/. (${String(e)})`
    );
  }

  const w = bg.width;
  const h = bg.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  ensureLeaderboardFont();

  ctx.drawImage(bg, 0, 0);
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const nameFont = `${FONT_NAME_TAG} ${FONT_FAMILY}, sans-serif`;
  const tagFont = `${FONT_NAME_TAG} ${FONT_FAMILY}, sans-serif`;
  const statFont = `${FONT_STATS} ${FONT_FAMILY}, sans-serif`;

  for (let i = 0; i < 10; i++) {
    const slot = SLOTS[i]!;
    const row = slots[i]!;

    if (!row) {
      ctx.font = nameFont;
      ctx.fillText("—", slot.name.x, slot.name.y);
      ctx.font = tagFont;
      ctx.fillText("—", slot.tag.x, slot.tag.y);
      ctx.font = statFont;
      ctx.fillText("—", slot.kills.x, slot.kills.y);
      ctx.fillText("—", slot.deaths.x, slot.deaths.y);
      ctx.fillText("—", slot.kd.x, slot.kd.y);
      ctx.fillText("—", slot.members.x, slot.members.y);
      continue;
    }

    const tagRaw = row.clanTag?.trim() ?? "";
    const tagDisplay = tagRaw ? `[${tagRaw}]` : "—";

    const nameMax = Math.max(40, slot.tag.x - slot.name.x - 12);
    const tagMax = Math.max(80, Math.min(480, w - slot.tag.x - 24));

    ctx.font = nameFont;
    ctx.fillText(truncate(ctx, row.clanName || "—", nameMax), slot.name.x, slot.name.y);

    ctx.font = tagFont;
    ctx.fillText(truncate(ctx, tagDisplay, tagMax), slot.tag.x, slot.tag.y);

    ctx.font = statFont;
    ctx.fillText(String(row.kills), slot.kills.x, slot.kills.y);
    ctx.fillText(String(row.deaths), slot.deaths.x, slot.deaths.y);
    ctx.fillText(formatKdRatio(row.kills, row.deaths), slot.kd.x, slot.kd.y);
    ctx.fillText(String(row.memberCount), slot.members.x, slot.members.y);
  }

  return canvas.toBuffer("image/png");
}
