import { gazeOffset } from './avatar';

const avatar = { left: 100, top: 100, width: 240 }; // 1 SVG unit = 1 px; eyes' centre at (220, 216)

describe('gazeOffset', () => {
  it('looks towards the point, never further than the eyes can turn', () => {
    const left = gazeOffset({ x: -1000, y: 216 }, avatar);
    expect(left.x).toBeCloseTo(-5.5);
    expect(left.y).toBeCloseTo(0);
    const below = gazeOffset({ x: 220, y: 2000 }, avatar);
    expect(below.y).toBeCloseTo(4);
    expect(Math.abs(below.x)).toBeLessThan(1e-9);
  });

  it('turns only a little for points close to the face', () => {
    const near = gazeOffset({ x: 256, y: 216 }, avatar); // 36 px to the right
    expect(near.x).toBeGreaterThan(0);
    expect(near.x).toBeLessThan(1);
  });

  it('looks straight ahead when the point is between the eyes', () => {
    expect(gazeOffset({ x: 220, y: 216 }, avatar)).toEqual({ x: 0, y: 0 });
  });

  it('scales with the size the avatar is drawn at', () => {
    const small = { left: 0, top: 0, width: 60 }; // 1 SVG unit = 0.25 px; eyes at (30, 29)
    const up = gazeOffset({ x: 30, y: -500 }, small);
    expect(up.y).toBeCloseTo(-4);
  });
});
