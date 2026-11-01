import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EMPTY_STATS, PHONE_BUDGET, addStats, formatBytes, formatCount, rateObject, sceneBudget, textureBytes } from '../src/core';
import { measureObject } from '../src/runtime/stats';

describe('performance ratings', () => {
  it('formats counts and bytes for humans', () => {
    expect(formatCount(950)).toBe('950');
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(48_000)).toBe('48k');
    expect(formatCount(2_400_000)).toBe('2.4M');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1048576)).toBe('5.0 MB');
    expect(formatBytes(64 * 1048576)).toBe('64 MB');
  });

  it('rates cheap, moderate and heavy objects and explains why', () => {
    expect(rateObject({ ...EMPTY_STATS, triangles: 800, drawCalls: 1 }).rating).toBe('light');
    const ok = rateObject({ ...EMPTY_STATS, triangles: 12_000, drawCalls: 2 });
    expect(ok.rating).toBe('ok');
    expect(ok.tips[0]).toMatch(/12k triangles/);
    const heavy = rateObject({ ...EMPTY_STATS, triangles: 90_000, drawCalls: 30, textureBytes: textureBytes(4096, 4096) });
    expect(heavy.rating).toBe('heavy');
    expect(heavy.tips.length).toBe(3);
    expect(heavy.tips.join(' ')).toMatch(/1024px/);
  });

  it('a big texture alone makes an object heavy; mip chain adds a third', () => {
    expect(textureBytes(1024, 1024)).toBe(Math.round(1024 * 1024 * 4 * (4 / 3)));
    expect(rateObject({ ...EMPTY_STATS, triangles: 10, drawCalls: 1, textureBytes: textureBytes(4096, 4096) }).rating).toBe('heavy');
  });

  it('scene budget is relative to a mid-range phone', () => {
    const half = sceneBudget({ ...EMPTY_STATS, triangles: PHONE_BUDGET.triangles / 2 });
    expect(half.rating).toBe('light');
    expect(sceneBudget({ ...EMPTY_STATS, triangles: PHONE_BUDGET.triangles * 0.7 }).rating).toBe('ok');
    const over = sceneBudget({ ...EMPTY_STATS, drawCalls: PHONE_BUDGET.drawCalls * 2 });
    expect(over.rating).toBe('heavy');
    expect(over.worst).toBeCloseTo(2);
  });

  it('adds stats', () => {
    expect(addStats({ ...EMPTY_STATS, triangles: 1, drawCalls: 2 }, { ...EMPTY_STATS, triangles: 3, drawCalls: 4 })).toMatchObject({ triangles: 4, drawCalls: 6 });
  });
});

describe('measureObject', () => {
  it('counts triangles, draw calls per material and shared textures once', () => {
    const group = new THREE.Group();
    const box = new THREE.BoxGeometry(1, 1, 1); // 12 triangles
    const tex = new THREE.Texture({ width: 256, height: 128 } as unknown as HTMLImageElement);
    const shared = new THREE.MeshStandardMaterial({ map: tex });
    group.add(new THREE.Mesh(box, shared), new THREE.Mesh(box, shared));
    group.add(new THREE.Mesh(new THREE.PlaneGeometry(), [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()])); // 2 triangles, 2 materials
    const s = measureObject(group);
    expect(s.triangles).toBe(12 + 12 + 2);
    expect(s.drawCalls).toBe(1 + 1 + 2);
    expect(s.textures).toBe(1);
    expect(s.textureBytes).toBe(textureBytes(256, 128));
  });

  it('multiplies instanced meshes and ignores empty groups', () => {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 10);
    expect(measureObject(inst).triangles).toBe(120);
    expect(measureObject(new THREE.Group())).toEqual(EMPTY_STATS);
  });
});
