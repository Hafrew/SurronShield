import { ZONE_STYLES } from "./config.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + height, safeRadius);
  ctx.arcTo(x + width, y + height, x, y + height, safeRadius);
  ctx.arcTo(x, y + height, x, y, safeRadius);
  ctx.arcTo(x, y, x + width, y, safeRadius);
  ctx.closePath();
}

export class OverlayRenderer {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    this.displayWidth = window.innerWidth;
    this.displayHeight = window.innerHeight;
    this.resize();
  }

  resize() {
    const nextWidth = window.innerWidth;
    const nextHeight = window.innerHeight;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

    this.displayWidth = nextWidth;
    this.displayHeight = nextHeight;

    const backingWidth = Math.round(nextWidth * dpr);
    const backingHeight = Math.round(nextHeight * dpr);

    if (
      this.canvas.width !== backingWidth ||
      this.canvas.height !== backingHeight
    ) {
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
  }

  render(snapshot) {
    this.resize();
    this.clear();
    this.drawFocusLane();

    snapshot.vehicles.forEach((vehicle) => {
      this.drawVehicle(vehicle, snapshot.primary?.id === vehicle.id);
    });
  }

  drawFocusLane() {
    const laneWidth = this.displayWidth * 0.22;
    const laneX = (this.displayWidth - laneWidth) / 2;
    const laneTop = this.displayHeight * 0.16;
    const laneHeight = this.displayHeight * 0.58;

    this.ctx.save();
    this.ctx.setLineDash([8, 10]);
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    this.ctx.lineWidth = 1.25;
    roundRectPath(this.ctx, laneX, laneTop, laneWidth, laneHeight, 28);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawVehicle(vehicle, isPrimary) {
    const style = ZONE_STYLES[vehicle.zone] ?? ZONE_STYLES.CLEAR;
    const [x, y, width, height] = this.videoBoxToViewport(vehicle.bbox);
    const clippedX = clamp(x, -40, this.displayWidth + 40);
    const clippedY = clamp(y, -40, this.displayHeight + 40);
    const corner = isPrimary ? 18 : 12;
    const lineWidth = isPrimary ? 3.4 : 2.4;

    this.ctx.save();
    this.ctx.strokeStyle = style.boxColor;
    this.ctx.lineWidth = lineWidth;
    this.ctx.shadowColor = style.boxColor;
    this.ctx.shadowBlur = isPrimary ? 16 : 10;
    roundRectPath(this.ctx, clippedX, clippedY, width, height, 16);
    this.ctx.stroke();
    this.ctx.shadowBlur = 0;

    this.drawCornerMarks(clippedX, clippedY, width, height, corner, style.boxColor);
    this.drawLabel(vehicle, clippedX, clippedY, width, height, style.boxColor, isPrimary);
    this.ctx.restore();
  }

  drawCornerMarks(x, y, width, height, size, color) {
    const points = [
      [x, y, 1, 1],
      [x + width, y, -1, 1],
      [x, y + height, 1, -1],
      [x + width, y + height, -1, -1],
    ];

    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;

    for (const [px, py, dx, dy] of points) {
      this.ctx.beginPath();
      this.ctx.moveTo(px + dx * size, py);
      this.ctx.lineTo(px, py);
      this.ctx.lineTo(px, py + dy * size);
      this.ctx.stroke();
    }
  }

  drawLabel(vehicle, x, y, width, height, color, isPrimary) {
    const label = `${vehicle.label.toUpperCase()} ${Math.round(vehicle.score * 100)}%`;
    this.ctx.font = isPrimary
      ? '700 12px "Share Tech Mono", monospace'
      : '600 11px "Share Tech Mono", monospace';

    const textWidth = this.ctx.measureText(label).width;
    const cardWidth = textWidth + 18;
    const cardHeight = 24;
    const labelY = y > 30 ? y - 30 : y + height + 8;
    const cardX = clamp(x, 8, this.displayWidth - cardWidth - 8);
    const cardY = clamp(labelY, 8, this.displayHeight - cardHeight - 8);

    this.ctx.fillStyle = `${color}CC`;
    roundRectPath(this.ctx, cardX, cardY, cardWidth, cardHeight, 12);
    this.ctx.fill();

    this.ctx.fillStyle = "#07141a";
    this.ctx.fillText(label, cardX + 9, cardY + 15.5);
  }

  videoBoxToViewport(bbox) {
    const videoWidth = this.video.videoWidth || this.displayWidth;
    const videoHeight = this.video.videoHeight || this.displayHeight;
    const scale = Math.max(
      this.displayWidth / videoWidth,
      this.displayHeight / videoHeight,
    );
    const offsetX = (this.displayWidth - videoWidth * scale) / 2;
    const offsetY = (this.displayHeight - videoHeight * scale) / 2;

    return [
      bbox[0] * scale + offsetX,
      bbox[1] * scale + offsetY,
      bbox[2] * scale,
      bbox[3] * scale,
    ];
  }
}
