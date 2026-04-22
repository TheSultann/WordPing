import { useEffect, useRef, type MutableRefObject } from 'react';
import type { GameStatus, Particle, RocketVisual, WordCard } from '../../types/game';

type GameScene = {
  status: GameStatus;
  currentCard: WordCard | null;
  particles: Particle[];
  timeLeftProgress: number;
  cardFadeProgress: number;
  rocket: RocketVisual;
  launchStartedAt: number | null;
};

export type GameCanvasLayoutInput = {
  width: number;
  height: number;
  topReserveHeight: number;
  bottomReserveHeight: number;
};

export type GameCanvasLayout = {
  width: number;
  height: number;
  shortSide: number;
  longSide: number;
  cardStartY: number;
  cardWidth: number;
  cardHeight: number;
  cardRadius: number;
  cardFontSize: number;
  cardTextY: number;
  cardStrokeWidth: number;
  progressInset: number;
  progressHeight: number;
  progressRadius: number;
  rocketHeight: number;
  rocketTopY: number;
  rocketBottomY: number;
  rocketBodyWidth: number;
  rocketBodyHeight: number;
  rocketBodyRadius: number;
  rocketWingOuterX: number;
  rocketWingTopY: number;
  rocketWingInnerY: number;
  rocketNoseHalfWidth: number;
  rocketWindowRadius: number;
  rocketStartCenterY: number;
  rocketCollisionCenterY: number;
  rocketExitCenterY: number;
  rocketNoseOffset: number;
  collisionContactY: number;
  particleRadius: number;
  impactFlashRadius: number;
  impactRingWidth: number;
};

type GameCanvasProps = {
  sceneRef: MutableRefObject<GameScene>;
  layout: GameCanvasLayout;
};

type StarSeed = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  speed: number;
  drift: number;
  phase: number;
  layer: number;
  tone: number;
};

const FRAME_MS = 1000 / 60;
const LAUNCH_RAMP_MS = 1000;
const LAUNCH_SHAKE_MS = 300;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const easeInQuad = (value: number) => value * value;

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

const getLaunchTravelMs = (elapsedMs: number) => {
  const safeElapsedMs = Math.max(0, elapsedMs);
  if (safeElapsedMs <= 0) return 0;

  if (safeElapsedMs <= LAUNCH_RAMP_MS) {
    const rampProgress = safeElapsedMs / LAUNCH_RAMP_MS;
    return LAUNCH_RAMP_MS * (Math.pow(rampProgress, 3) / 3);
  }

  return safeElapsedMs - ((LAUNCH_RAMP_MS * 2) / 3);
};

export const getGameCanvasLayout = ({
  width,
  height,
  topReserveHeight,
  bottomReserveHeight,
}: GameCanvasLayoutInput): GameCanvasLayout => {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const shortSide = Math.min(safeWidth, safeHeight);
  const longSide = Math.max(safeWidth, safeHeight);
  const cardHeight = clamp(shortSide * 0.112, 42, 56);
  const cardStartY = topReserveHeight + clamp(shortSide * 0.02, 10, 18);
  const rocketHeight = safeHeight * 0.182;
  const rocketLift = clamp(shortSide * 0.055, 16, 28);
  const rocketTopY = safeHeight - bottomReserveHeight - rocketHeight - rocketLift;
  const rocketStartCenterY = rocketTopY + (rocketHeight / 2);
  const rocketNoseOffset = rocketHeight * 0.485;
  const rocketStartNoseY = rocketStartCenterY - rocketNoseOffset;
  const collisionContactY = rocketStartNoseY;

  return {
    width: safeWidth,
    height: safeHeight,
    shortSide,
    longSide,
    cardStartY,
    cardWidth: clamp(safeWidth * 0.56, 180, 280),
    cardHeight,
    cardRadius: cardHeight * 0.38,
    cardFontSize: clamp(shortSide * 0.047, 18, 24),
    cardTextY: cardHeight * 0.46,
    cardStrokeWidth: shortSide * 0.0028,
    progressInset: Math.max(shortSide * 0.04, 14),
    progressHeight: Math.max(cardHeight * 0.06, 6),
    progressRadius: Math.max(cardHeight * 0.03, 3),
    rocketHeight,
    rocketTopY,
    rocketBottomY: rocketTopY + rocketHeight,
    rocketBodyWidth: rocketHeight * 0.245,
    rocketBodyHeight: rocketHeight * 0.56,
    rocketBodyRadius: rocketHeight * 0.16,
    rocketWingOuterX: rocketHeight * 0.23,
    rocketWingTopY: rocketHeight * 0.64,
    rocketWingInnerY: rocketHeight * 0.83,
    rocketNoseHalfWidth: rocketHeight * 0.12,
    rocketWindowRadius: rocketHeight * 0.078,
    rocketStartCenterY,
    rocketCollisionCenterY: rocketStartCenterY,
    rocketExitCenterY: -(rocketHeight * 0.75),
    rocketNoseOffset,
    collisionContactY,
    particleRadius: shortSide * 0.0066666667,
    impactFlashRadius: shortSide * 0.2,
    impactRingWidth: Math.max(shortSide * 0.01, 5),
  };
};

const createStarSeeds = () =>
  Array.from({ length: 86 }, () => {
    const layer = Math.random();
    return {
      x: 0.04 + (Math.random() * 0.92),
      y: Math.random() * 1.08,
      size: 0.45 + (Math.random() * 1.35) + (layer * 0.45),
      opacity: 0.12 + (Math.random() * 0.34) + (layer * 0.08),
      speed: 0.035 + (layer * 0.12),
      drift: 1.2 + (Math.random() * 4.6),
      phase: Math.random() * Math.PI * 2,
      layer,
      tone: Math.random(),
    };
  });

const drawSpaceBackdrop = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  const skyGradient = context.createLinearGradient(0, 0, 0, height);
  skyGradient.addColorStop(0, '#02040c');
  skyGradient.addColorStop(0.36, '#06101f');
  skyGradient.addColorStop(0.72, '#11172a');
  skyGradient.addColorStop(1, '#17111f');
  context.fillStyle = skyGradient;
  context.fillRect(0, 0, width, height);

  const distantHaze = context.createLinearGradient(0, height * 0.42, 0, height);
  distantHaze.addColorStop(0, 'rgba(98, 129, 178, 0)');
  distantHaze.addColorStop(0.58, 'rgba(79, 105, 151, 0.08)');
  distantHaze.addColorStop(1, 'rgba(219, 145, 86, 0.08)');
  context.fillStyle = distantHaze;
  context.fillRect(0, height * 0.42, width, height * 0.58);

  context.save();
  context.globalCompositeOperation = 'screen';
  context.translate(width * 0.5, height * 0.43);
  context.rotate(-0.14);
  const dustLane = context.createLinearGradient(0, -height * 0.2, 0, height * 0.2);
  dustLane.addColorStop(0, 'rgba(141, 170, 215, 0)');
  dustLane.addColorStop(0.35, 'rgba(141, 170, 215, 0.035)');
  dustLane.addColorStop(0.52, 'rgba(235, 184, 127, 0.045)');
  dustLane.addColorStop(0.72, 'rgba(80, 105, 155, 0.025)');
  dustLane.addColorStop(1, 'rgba(141, 170, 215, 0)');
  context.fillStyle = dustLane;
  context.fillRect(-width, -height * 0.22, width * 2, height * 0.44);
  context.restore();
};

const buildRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
};

const getFittedCardFontSize = (
  context: CanvasRenderingContext2D,
  text: string,
  baseFontSize: number,
  maxWidth: number
) => {
  let fontSize = baseFontSize;

  while (fontSize > baseFontSize * 0.72) {
    context.font = `800 ${fontSize}px "Sora", sans-serif`;
    if (context.measureText(text).width <= maxWidth) {
      return fontSize;
    }
    fontSize -= 1;
  }

  return fontSize;
};

const drawWordCard = (
  context: CanvasRenderingContext2D,
  layout: GameCanvasLayout,
  canvasWidth: number,
  cardY: number,
  text: string,
  comboMultiplier: number,
  progress: number,
  impactProgress: number,
  disappearProgress: number,
) => {
  const cardX = (canvasWidth - layout.cardWidth) / 2;
  const cardCenterX = cardX + (layout.cardWidth / 2);
  const cardCenterY = cardY + (layout.cardHeight / 2);
  const pulse = Math.sin(clamp(impactProgress, 0, 1) * Math.PI);
  const impactScale = 1 + (pulse * 0.045);
  const disappear = clamp(disappearProgress, 0, 1);
  const disappearEase = easeOutCubic(disappear);
  const disappearScaleX = 1 - (disappearEase * 0.06);
  const disappearScaleY = 1 - (disappearEase * 0.2);
  const disappearLift = layout.cardHeight * (0.12 + (0.56 * disappearEase));
  const disappearRotation = -0.035 * disappearEase;
  const cardOpacity = 1 - disappearEase;
  const showComboBadge = comboMultiplier >= 2;
  const comboBadgeText = `x${comboMultiplier}`;
  const comboBadgeFontSize = Math.max(layout.shortSide * 0.03, 12);
  const comboBadgePaddingX = Math.max(layout.shortSide * 0.022, 9);
  const comboBadgeHeight = Math.max(layout.cardHeight * 0.26, comboBadgeFontSize * 1.9);
  let comboBadgeWidth = 0;

  if (showComboBadge) {
    context.save();
    context.font = `800 ${comboBadgeFontSize}px "Sora", sans-serif`;
    comboBadgeWidth = Math.max(
      comboBadgeHeight,
      context.measureText(comboBadgeText).width + (comboBadgePaddingX * 2),
    );
    context.restore();
  }

  context.save();
  context.globalAlpha = cardOpacity;
  context.translate(cardCenterX, cardCenterY - disappearLift);
  context.rotate(disappearRotation);
  context.scale(impactScale * disappearScaleX, impactScale * disappearScaleY);
  context.translate(-cardCenterX, -cardCenterY);

  const cardGradient = context.createLinearGradient(cardX, cardY, cardX, cardY + layout.cardHeight);
  cardGradient.addColorStop(0, 'rgba(33, 38, 77, 0.97)');
  cardGradient.addColorStop(0.55, 'rgba(20, 23, 53, 0.97)');
  cardGradient.addColorStop(1, 'rgba(10, 12, 28, 0.98)');

  buildRoundedRect(context, cardX, cardY, layout.cardWidth, layout.cardHeight, layout.cardRadius);
  context.fillStyle = cardGradient;
  context.shadowColor = 'rgba(2, 8, 23, 0.34)';
  context.shadowBlur = layout.shortSide * 0.05;
  context.shadowOffsetY = layout.shortSide * 0.012;
  context.fill();
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.lineWidth = layout.cardStrokeWidth;
  context.strokeStyle = pulse > 0
    ? `rgba(255, ${Math.round(197 + (pulse * 24))}, ${Math.round(138 + (pulse * 36))}, 0.68)`
    : 'rgba(103, 232, 249, 0.2)';
  context.stroke();

  context.save();
  buildRoundedRect(context, cardX, cardY, layout.cardWidth, layout.cardHeight, layout.cardRadius);
  context.clip();

  const topSheen = context.createLinearGradient(cardX, cardY, cardX, cardY + (layout.cardHeight * 0.65));
  topSheen.addColorStop(0, 'rgba(255, 243, 226, 0.18)');
  topSheen.addColorStop(0.24, 'rgba(255, 179, 122, 0.12)');
  topSheen.addColorStop(1, 'rgba(255, 179, 122, 0)');
  context.fillStyle = topSheen;
  context.fillRect(cardX, cardY, layout.cardWidth, layout.cardHeight * 0.7);

  if (pulse > 0) {
    const flash = context.createLinearGradient(cardX, cardY, cardX, cardY + layout.cardHeight);
    flash.addColorStop(0, `rgba(255, 226, 154, ${0.22 + (pulse * 0.22)})`);
    flash.addColorStop(1, 'rgba(255, 163, 74, 0)');
    context.fillStyle = flash;
    context.fillRect(cardX, cardY, layout.cardWidth, layout.cardHeight);
  }

  context.restore();

  const textMaxWidth = layout.cardWidth
    - (layout.progressInset * 2.4)
    - (showComboBadge ? comboBadgeWidth + layout.progressInset : 0);
  const fittedFontSize = getFittedCardFontSize(context, text, layout.cardFontSize, textMaxWidth);
  context.font = `800 ${fittedFontSize}px "Sora", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.globalAlpha = Math.max(0, cardOpacity - (disappearEase * 0.08));
  context.shadowColor = pulse > 0 ? `rgba(255, 184, 84, ${0.32 + (pulse * 0.18)})` : 'rgba(4, 12, 28, 0.32)';
  context.shadowBlur = layout.shortSide * (pulse > 0 ? 0.03 : 0.02);
  context.fillText(
    text,
    canvasWidth / 2,
    cardY + layout.cardTextY - (layout.cardHeight * 0.06 * disappearEase),
  );
  context.shadowBlur = 0;
  context.globalAlpha = cardOpacity;

  if (showComboBadge) {
    const comboBadgeX = cardX + layout.cardWidth - layout.progressInset - comboBadgeWidth;
    const comboBadgeY = cardY + (layout.cardHeight * 0.16);
    const comboBadgeGradient = context.createLinearGradient(
      comboBadgeX,
      comboBadgeY,
      comboBadgeX,
      comboBadgeY + comboBadgeHeight,
    );

    comboBadgeGradient.addColorStop(0, 'rgba(255, 225, 133, 0.98)');
    comboBadgeGradient.addColorStop(1, 'rgba(255, 166, 70, 0.96)');

    buildRoundedRect(
      context,
      comboBadgeX,
      comboBadgeY,
      comboBadgeWidth,
      comboBadgeHeight,
      comboBadgeHeight / 2,
    );
    context.fillStyle = comboBadgeGradient;
    context.shadowColor = 'rgba(255, 166, 70, 0.34)';
    context.shadowBlur = layout.shortSide * 0.02;
    context.fill();
    context.shadowBlur = 0;
    context.lineWidth = Math.max(1, layout.cardStrokeWidth * 0.9);
    context.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    context.stroke();

    context.font = `800 ${comboBadgeFontSize}px "Sora", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#4a2800';
    context.fillText(
      comboBadgeText,
      comboBadgeX + (comboBadgeWidth / 2),
      comboBadgeY + (comboBadgeHeight / 2) + 0.5,
    );
  }

  context.restore();
};

const drawStarParticle = (
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  opacity: number,
  tone: number,
) => {
  context.save();
  context.globalAlpha = opacity;

  const glowColor = tone > 0.72
    ? '255, 221, 174'
    : tone < 0.24
      ? '185, 223, 255'
      : '240, 247, 255';
  const coreColor = tone > 0.72
    ? '#ffe8bf'
    : tone < 0.24
      ? '#d7efff'
      : '#f8fbff';
  const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, size * 3.4);
  glow.addColorStop(0, `rgba(${glowColor}, 0.48)`);
  glow.addColorStop(0.56, `rgba(${glowColor}, 0.13)`);
  glow.addColorStop(1, `rgba(${glowColor}, 0)`);
  context.fillStyle = glow;
  context.beginPath();
  context.arc(centerX, centerY, size * 3.2, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = coreColor;
  context.beginPath();
  context.arc(centerX, centerY, Math.max(0.55, size * 0.72), 0, Math.PI * 2);
  context.fill();
  context.restore();
};

const drawRocket = (
  context: CanvasRenderingContext2D,
  layout: GameCanvasLayout,
  rocket: RocketVisual,
  canvasWidth: number,
  timestamp: number,
  status: GameStatus,
  launchElapsedMs: number,
) => {
  if (rocket.phase === 'hidden') return;

  const pulse = Math.sin(clamp(rocket.impactProgress, 0, 1) * Math.PI);
  const launchProgress = clamp(launchElapsedMs / LAUNCH_RAMP_MS, 0, 1);
  const ignitionBoost = 1 - easeOutCubic(clamp(launchElapsedMs / 180, 0, 1));
  const shakeFade = launchElapsedMs < LAUNCH_SHAKE_MS
    ? 1 - easeOutCubic(clamp(launchElapsedMs / LAUNCH_SHAKE_MS, 0, 1))
    : 0;
  const rocketJitterX = rocket.phase !== 'impact'
    && status !== 'countdown'
    && shakeFade > 0
    ? Math.sin(timestamp * 0.05) * 2 * shakeFade
    : 0;
  const tilt = rocket.phase === 'impact'
    ? Math.sin(rocket.impactProgress * 30) * 0.08 * (1 - rocket.impactProgress)
    : 0;
  const centerX = (canvasWidth / 2) + rocketJitterX;
  const rocketCenterY = rocket.y;
  const rocketTop = rocketCenterY - (layout.rocketHeight / 2);
  const bodyX = centerX - (layout.rocketBodyWidth / 2);
  const bodyY = rocketTop + (layout.rocketHeight * 0.24);
  const bodyBottomY = bodyY + layout.rocketBodyHeight;
  const finRootY = rocketTop + (layout.rocketHeight * 0.63);
  const finTipY = rocketTop + (layout.rocketHeight * 0.84);
  const leftFinOuterX = centerX - layout.rocketWingOuterX;
  const rightFinOuterX = centerX + layout.rocketWingOuterX;
  const nozzleY = rocketTop + (layout.rocketHeight * 0.77);
  const nozzleWidth = layout.rocketBodyWidth * 0.28;
  const nozzleHeight = layout.rocketHeight * 0.135;
  const flameScaleY = rocket.phase === 'impact'
    ? 0.45 + ((1 - clamp(rocket.impactProgress, 0, 1)) * 0.18)
    : status === 'countdown'
      ? 0.34 + (Math.sin((timestamp * Math.PI * 2) / 320) * 0.035)
      : 0.94
        + (launchProgress * 0.06)
        + (ignitionBoost * 0.9)
        + (Math.sin((timestamp * Math.PI * 2) / 120) * (0.08 + (ignitionBoost * 0.05)));
  const flameScaleX = rocket.phase === 'impact'
    ? 1
    : status === 'countdown'
      ? 0.58 + (Math.sin((timestamp * Math.PI * 2) / 280) * 0.03)
      : 1 + (ignitionBoost * 0.18);
  const flameAlpha = rocket.phase === 'impact'
    ? 0.8
    : status === 'countdown'
      ? rocket.opacity * 0.58
      : rocket.opacity * (0.92 + (ignitionBoost * 0.08));
  const finGradient = context.createLinearGradient(0, rocketTop, 0, bodyBottomY);
  finGradient.addColorStop(0, '#d98a5f');
  finGradient.addColorStop(0.65, '#c76535');
  finGradient.addColorStop(1, '#99431f');
  const bodyGradient = context.createLinearGradient(bodyX, bodyY, bodyX, bodyBottomY);
  bodyGradient.addColorStop(0, '#fff7ed');
  bodyGradient.addColorStop(0.58, '#f7ebda');
  bodyGradient.addColorStop(1, pulse > 0 ? '#f1c99a' : '#e4d0ba');
  const noseGradient = context.createLinearGradient(centerX, rocketTop, centerX, bodyY);
  noseGradient.addColorStop(0, pulse > 0 ? '#ffbf8a' : '#eaa17b');
  noseGradient.addColorStop(1, '#b5552b');

  context.save();
  context.translate(centerX, rocketCenterY);
  context.rotate(tilt);
  context.translate(-centerX, -rocketCenterY);
  context.globalAlpha = rocket.opacity;

  context.save();
  context.translate(centerX, rocketTop + (layout.rocketHeight * 0.98));
  context.scale(flameScaleX, flameScaleY);
  context.globalAlpha = flameAlpha;

  const flameGlow = context.createRadialGradient(
    0,
    layout.rocketHeight * 0.05,
    layout.rocketHeight * 0.06,
    0,
    layout.rocketHeight * 0.09,
    layout.rocketHeight * 0.34
  );
  flameGlow.addColorStop(0, 'rgba(255, 205, 96, 0.5)');
  flameGlow.addColorStop(1, 'rgba(255, 205, 96, 0)');
  context.fillStyle = flameGlow;
  context.beginPath();
  context.ellipse(
    0,
    layout.rocketHeight * 0.02,
    layout.rocketHeight * 0.2,
    layout.rocketHeight * 0.26,
    0,
    0,
    Math.PI * 2
  );
  context.fill();

  const outerFlame = context.createLinearGradient(0, -layout.rocketHeight * 0.3, 0, layout.rocketHeight * 0.35);
  outerFlame.addColorStop(0, '#ffd665');
  outerFlame.addColorStop(0.38, '#ff9727');
  outerFlame.addColorStop(1, '#ea4f17');
  context.fillStyle = outerFlame;
  context.beginPath();
  context.moveTo(0, -layout.rocketHeight * 0.3);
  context.bezierCurveTo(
    layout.rocketHeight * 0.14,
    -layout.rocketHeight * 0.24,
    layout.rocketHeight * 0.16,
    layout.rocketHeight * 0.14,
    0,
    layout.rocketHeight * 0.38
  );
  context.bezierCurveTo(
    -layout.rocketHeight * 0.16,
    layout.rocketHeight * 0.14,
    -layout.rocketHeight * 0.14,
    -layout.rocketHeight * 0.24,
    0,
    -layout.rocketHeight * 0.3
  );
  context.closePath();
  context.fill();
  context.restore();

  context.fillStyle = finGradient;
  context.beginPath();
  context.moveTo(bodyX + (layout.rocketBodyWidth * 0.1), finRootY);
  context.bezierCurveTo(
    bodyX - (layout.rocketBodyWidth * 0.16),
    finRootY + (layout.rocketHeight * 0.012),
    leftFinOuterX,
    finTipY - (layout.rocketHeight * 0.03),
    leftFinOuterX,
    finTipY
  );
  context.quadraticCurveTo(
    bodyX + (layout.rocketBodyWidth * 0.01),
    finTipY + (layout.rocketHeight * 0.03),
    bodyX + (layout.rocketBodyWidth * 0.18),
    bodyBottomY - (layout.rocketHeight * 0.01)
  );
  context.closePath();
  context.fill();

  context.beginPath();
  context.moveTo(bodyX + (layout.rocketBodyWidth * 0.9), finRootY);
  context.bezierCurveTo(
    bodyX + (layout.rocketBodyWidth * 1.16),
    finRootY + (layout.rocketHeight * 0.012),
    rightFinOuterX,
    finTipY - (layout.rocketHeight * 0.03),
    rightFinOuterX,
    finTipY
  );
  context.quadraticCurveTo(
    bodyX + (layout.rocketBodyWidth * 0.99),
    finTipY + (layout.rocketHeight * 0.03),
    bodyX + (layout.rocketBodyWidth * 0.82),
    bodyBottomY - (layout.rocketHeight * 0.01)
  );
  context.closePath();
  context.fill();

  context.lineWidth = layout.rocketHeight * 0.01;
  context.strokeStyle = 'rgba(115, 49, 18, 0.35)';
  context.stroke();

  context.fillStyle = '#6d412b';
  buildRoundedRect(
    context,
    centerX - (layout.rocketBodyWidth * 0.46),
    nozzleY - (layout.rocketHeight * 0.012),
    layout.rocketBodyWidth * 0.92,
    layout.rocketHeight * 0.092,
    layout.rocketHeight * 0.04
  );
  context.fill();

  context.fillStyle = '#40494f';
  buildRoundedRect(
    context,
    centerX - nozzleWidth - (layout.rocketBodyWidth * 0.028),
    nozzleY + (layout.rocketHeight * 0.038),
    nozzleWidth,
    nozzleHeight,
    layout.rocketHeight * 0.03
  );
  context.fill();

  buildRoundedRect(
    context,
    centerX + (layout.rocketBodyWidth * 0.028),
    nozzleY + (layout.rocketHeight * 0.038),
    nozzleWidth,
    nozzleHeight,
    layout.rocketHeight * 0.03
  );
  context.fill();

  buildRoundedRect(
    context,
    bodyX,
    bodyY,
    layout.rocketBodyWidth,
    layout.rocketBodyHeight,
    layout.rocketBodyRadius
  );
  context.fillStyle = bodyGradient;
  context.shadowColor = 'rgba(15, 23, 42, 0.18)';
  context.shadowBlur = layout.rocketHeight * 0.09;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = layout.rocketHeight * 0.008;
  context.strokeStyle = 'rgba(126, 102, 79, 0.34)';
  context.stroke();

  context.fillStyle = noseGradient;
  context.beginPath();
  context.moveTo(centerX, rocketTop + (layout.rocketHeight * 0.01));
  context.lineTo(centerX - layout.rocketNoseHalfWidth, bodyY);
  context.lineTo(centerX + layout.rocketNoseHalfWidth, bodyY);
  context.closePath();
  context.fill();
  context.strokeStyle = 'rgba(125, 58, 26, 0.38)';
  context.stroke();

  context.fillStyle = '#687e88';
  context.beginPath();
  context.arc(
    centerX,
    rocketTop + (layout.rocketHeight * 0.35),
    layout.rocketWindowRadius * 1.16,
    0,
    Math.PI * 2
  );
  context.fill();

  const windowGradient = context.createRadialGradient(
    centerX - (layout.rocketWindowRadius * 0.15),
    rocketTop + (layout.rocketHeight * 0.31),
    layout.rocketWindowRadius * 0.2,
    centerX,
    rocketTop + (layout.rocketHeight * 0.35),
    layout.rocketWindowRadius
  );
  windowGradient.addColorStop(0, '#9ee1ff');
  windowGradient.addColorStop(0.55, '#448ab0');
  windowGradient.addColorStop(1, '#1f4d63');
  context.fillStyle = windowGradient;
  context.beginPath();
  context.arc(
    centerX,
    rocketTop + (layout.rocketHeight * 0.35),
    layout.rocketWindowRadius * 0.84,
    0,
    Math.PI * 2
  );
  context.fill();

  context.restore();
};

const drawImpactBurst = (
  context: CanvasRenderingContext2D,
  layout: GameCanvasLayout,
  canvasWidth: number,
  cardY: number,
  progress: number,
) => {
  const clamped = clamp(progress, 0, 1);
  const pulse = Math.sin(clamped * Math.PI);
  const x = canvasWidth / 2;
  const y = Math.max(layout.collisionContactY, cardY + (layout.cardHeight * 0.72));
  const flashRadius = layout.impactFlashRadius * (0.55 + (pulse * 0.7));
  const ringRadius = layout.impactFlashRadius * (0.35 + (clamped * 0.9));

  context.save();

  const flash = context.createRadialGradient(x, y, 0, x, y, flashRadius);
  flash.addColorStop(0, `rgba(255, 231, 168, ${0.52 * (1 - (clamped * 0.35))})`);
  flash.addColorStop(0.45, `rgba(255, 170, 82, ${0.32 * pulse})`);
  flash.addColorStop(1, 'rgba(255, 170, 82, 0)');
  context.fillStyle = flash;
  context.beginPath();
  context.arc(x, y, flashRadius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = `rgba(255, 214, 128, ${0.72 * (1 - clamped)})`;
  context.lineWidth = layout.impactRingWidth * (1 - (clamped * 0.35));
  context.beginPath();
  context.arc(x, y, ringRadius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = `rgba(103, 232, 249, ${0.44 * pulse})`;
  context.lineWidth = layout.impactRingWidth * 0.6;
  context.beginPath();
  context.arc(x, y, ringRadius * 1.22, 0, Math.PI * 2);
  context.stroke();

  context.restore();
};

const GameCanvas = ({ sceneRef, layout }: GameCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const starSeedsRef = useRef<StarSeed[] | null>(null);
  const size = {
    width: layout.width,
    height: layout.height,
  };

  if (starSeedsRef.current == null) {
    starSeedsRef.current = createStarSeeds();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    let frameId = 0;

    const draw = (timestamp: number) => {
      context.clearRect(0, 0, size.width, size.height);

      drawSpaceBackdrop(context, size.width, size.height);

      const scene = sceneRef.current;
      const isFlightActive = scene.status === 'playing' || scene.status === 'exiting' || scene.status === 'impact';
      const launchElapsedMs = isFlightActive && scene.launchStartedAt !== null
        ? Math.max(0, timestamp - scene.launchStartedAt)
        : 0;
      const launchProgress = isFlightActive
        ? (scene.launchStartedAt === null ? 1 : clamp(launchElapsedMs / LAUNCH_RAMP_MS, 0, 1))
        : 0;
      const backgroundMotion = isFlightActive ? easeInQuad(launchProgress) : 0;
      const launchTravelFrames = isFlightActive
        ? (scene.launchStartedAt === null ? timestamp / FRAME_MS : getLaunchTravelMs(launchElapsedMs) / FRAME_MS)
        : 0;
      const shakeAmplitude = scene.rocket.phase === 'impact'
        ? (1 - scene.rocket.impactProgress) * (layout.shortSide * 0.018)
        : 0;

      context.save();
      context.translate(
        Math.sin(scene.rocket.impactProgress * 36) * shakeAmplitude,
        Math.cos(scene.rocket.impactProgress * 28) * shakeAmplitude * 0.7,
      );

      starSeedsRef.current?.forEach((star) => {
        const travelHeight = size.height + (star.size * 18);
        const parallaxSpeed = star.speed * (0.16 + (backgroundMotion * 0.38));
        const centerY = (((star.y * travelHeight) + (launchTravelFrames * parallaxSpeed)) % travelHeight) - (star.size * 8);
        const centerX = (size.width * star.x)
          + (Math.sin((timestamp / (5200 + (star.layer * 1800))) + star.phase) * star.drift * (0.24 + (backgroundMotion * 0.28)));
        const twinkle = 0.9 + (Math.sin((timestamp / (2400 + (star.layer * 1400))) + star.phase) * 0.1);
        const starOpacity = star.opacity * twinkle * (0.84 + (backgroundMotion * 0.16));
        drawStarParticle(
          context,
          centerX,
          centerY,
          star.size,
          starOpacity,
          star.tone,
        );
      });

      if (scene.currentCard) {
        drawWordCard(
          context,
          layout,
          size.width,
          scene.currentCard.y,
          scene.currentCard.word.promptText,
          scene.currentCard.comboMultiplier,
          clamp(scene.timeLeftProgress, 0, 1),
          scene.rocket.phase === 'impact' ? scene.rocket.impactProgress : 0,
          scene.cardFadeProgress,
        );
      }

      drawRocket(context, layout, scene.rocket, size.width, timestamp, scene.status, launchElapsedMs);

      if (scene.rocket.phase === 'impact' && scene.currentCard) {
        drawImpactBurst(
          context,
          layout,
          size.width,
          scene.currentCard.y,
          scene.rocket.impactProgress,
        );
      }

      scene.particles.forEach((particle) => {
        context.globalAlpha = particle.alpha;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, layout.particleRadius, 0, Math.PI * 2);
        context.fill();
      });
      context.globalAlpha = 1;
      context.restore();

      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [layout, sceneRef, size.height, size.width]);

  return (
    <div
      className="rocket-canvas-shell"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: 'transparent',
        boxShadow: 'none',
      }}
    >
      <canvas ref={canvasRef} className="rocket-canvas" aria-hidden="true" />
    </div>
  );
};

export default GameCanvas;
