import { describe, expect, it } from 'vitest';
import { dragCrop, FULL_CROP, MIN_CROP, planCrop, retryDelayMs, type CropRect } from './crop.js';

const close = (rect: CropRect, expected: CropRect) => {
  expect(rect.x).toBeCloseTo(expected.x);
  expect(rect.y).toBeCloseTo(expected.y);
  expect(rect.w).toBeCloseTo(expected.w);
  expect(rect.h).toBeCloseTo(expected.h);
};

describe('dragCrop', () => {
  it('moves the dragged corner and keeps the opposite one fixed', () => {
    close(dragCrop(FULL_CROP, 'nw', 0.1, 0.2), { x: 0.1, y: 0.2, w: 0.9, h: 0.8 });
    close(dragCrop(FULL_CROP, 'se', -0.1, -0.2), { x: 0, y: 0, w: 0.9, h: 0.8 });
    close(dragCrop(FULL_CROP, 'ne', -0.3, 0.1), { x: 0, y: 0.1, w: 0.7, h: 0.9 });
    close(dragCrop(FULL_CROP, 'sw', 0.3, -0.1), { x: 0.3, y: 0, w: 0.7, h: 0.9 });
  });

  it('stops corners at the image border', () => {
    const inner = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
    close(dragCrop(inner, 'nw', -1, -1), { x: 0, y: 0, w: 0.7, h: 0.7 });
    close(dragCrop(inner, 'se', 1, 1), { x: 0.2, y: 0.2, w: 0.8, h: 0.8 });
  });

  it('never collapses the box below the minimum size, even past the opposite edge', () => {
    const rect = dragCrop(FULL_CROP, 'nw', 2, 2);
    expect(rect.w).toBeCloseTo(MIN_CROP);
    expect(rect.h).toBeCloseTo(MIN_CROP);
    close(rect, { x: 1 - MIN_CROP, y: 1 - MIN_CROP, w: MIN_CROP, h: MIN_CROP });
  });

  it('translates on move without resizing, and stops at the border', () => {
    const inner = { x: 0.2, y: 0.3, w: 0.5, h: 0.4 };
    close(dragCrop(inner, 'move', 0.1, -0.1), { x: 0.3, y: 0.2, w: 0.5, h: 0.4 });
    close(dragCrop(inner, 'move', 5, 5), { x: 0.5, y: 0.6, w: 0.5, h: 0.4 });
    close(dragCrop(inner, 'move', -5, -5), { x: 0, y: 0, w: 0.5, h: 0.4 });
  });
});

describe('planCrop', () => {
  it('scales a large photo so the long edge is 1280', () => {
    expect(planCrop(4000, 3000, FULL_CROP)).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000, width: 1280, height: 960 });
  });

  it('scales by the long edge of the crop, not of the photo', () => {
    // A tall strip out of a landscape photo.
    const plan = planCrop(4000, 3000, { x: 0.25, y: 0, w: 0.25, h: 1 });
    expect(plan).toMatchObject({ sx: 1000, sy: 0, sw: 1000, sh: 3000 });
    expect(plan.height).toBe(1280);
    expect(plan.width).toBe(427);
  });

  it('never upscales a small image', () => {
    expect(planCrop(800, 600, FULL_CROP)).toMatchObject({ width: 800, height: 600 });
  });

  it('keeps the source rectangle inside the image after rounding', () => {
    const plan = planCrop(1001, 1001, { x: 0.9995, y: 0.9995, w: 0.08, h: 0.08 });
    expect(plan.sx + plan.sw).toBeLessThanOrEqual(1001);
    expect(plan.sy + plan.sh).toBeLessThanOrEqual(1001);
    expect(plan.sw).toBeGreaterThanOrEqual(1);
  });
});

describe('retryDelayMs', () => {
  it('starts immediately, backs off, and caps', () => {
    expect([0, 1, 2, 3, 4].map(retryDelayMs)).toEqual([0, 2_000, 8_000, 30_000, 30_000]);
  });
});
