import { describe, expect, it } from 'vitest';
import { DEFAULT_SHADER_GRAPH, compileShaderGraph, parseShaderGraph, type ShaderGraph } from '../src/core';
import { shaderFragment } from '../src/runtime/shaders';

describe('shader graph', () => {
  it('compiles the default graph into a shade() body', () => {
    const r = compileShaderGraph(DEFAULT_SHADER_GRAPH);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body).toContain('uTime');
    expect(r.body).toContain('mix(');
    expect(r.body.trim()).toMatch(/return n_\d+;$/);
    expect(shaderFragment(r.body)).toContain('vec4 shade(');
  });

  it('broadcasts floats and widens vectors', () => {
    const g: ShaderGraph = {
      output: 'out',
      nodes: [
        { id: 'c', type: 'Vec3', params: { value: [1, 0.5, 0] } },
        { id: 'k', type: 'Float', params: { value: 2 } },
        { id: 'm', type: 'Multiply', inputs: { a: 'c', b: 'k' } },
        { id: 'out', type: 'Output', inputs: { color: 'm' } },
      ],
    };
    const r = compileShaderGraph(g);
    expect(r.ok).toBe(true);
    expect(r.body).toContain('(vec3(1.0, 0.5, 0.0) * vec3(2.0))');
    expect(r.body).toMatch(/vec4\(n_\d+, 1\.0\)/);
  });

  it('turns a float output into grey', () => {
    const r = compileShaderGraph({ output: 'f', nodes: [{ id: 'f', type: 'Fresnel' }] });
    expect(r.ok).toBe(true);
    expect(r.body).toMatch(/return vec4\(vec3\(/);
  });

  it('reports cycles, missing inputs, unknown types and type mismatches', () => {
    const cycle = compileShaderGraph({ output: 'a', nodes: [{ id: 'a', type: 'Add', inputs: { a: 'b', b: 'b' } }, { id: 'b', type: 'Sin', inputs: { x: 'a' } }] });
    expect(cycle.errors.join()).toMatch(/Cycle/);
    expect(compileShaderGraph({ output: 'o', nodes: [{ id: 'o', type: 'Output', inputs: {} }] }).errors.join()).toMatch(/missing input "color"/);
    expect(compileShaderGraph({ output: 'o', nodes: [{ id: 'o', type: 'Nope' }] }).errors.join()).toMatch(/Unknown node type/);
    const mismatch = compileShaderGraph({
      output: 'o',
      nodes: [
        { id: 'uv', type: 'UV' },
        { id: 'n', type: 'Normal' },
        { id: 'd', type: 'Add', inputs: { a: 'uv', b: 'n' } },
        { id: 'o', type: 'Output', inputs: { color: 'd' } },
      ],
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.join()).toMatch(/mixes/);
  });

  it('cannot inject GLSL through params or ids', () => {
    const bad = compileShaderGraph({ output: 'x', nodes: [{ id: 'x;}', type: 'Float' }] });
    expect(bad.ok).toBe(false);
    const g: ShaderGraph = { output: 'f', nodes: [{ id: 'f', type: 'Float', params: { value: 'evil(); //' as unknown as number } }] };
    const r = compileShaderGraph(g);
    expect(r.body).not.toContain('evil');
  });

  it('parses stored JSON defensively', () => {
    expect(parseShaderGraph('not json')).toBeNull();
    expect(parseShaderGraph('{"nodes":1}')).toBeNull();
    expect(parseShaderGraph(JSON.stringify(DEFAULT_SHADER_GRAPH))?.output).toBe('out');
  });
});
