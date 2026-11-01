import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@bazi/engine/core';
import { addComponent, addEntity, deleteEntities, duplicateEntities, findEntity, reparent, setComponentProp, setTransform, updateEntity } from '../src/store/commands';
import { editor, useEditor } from '../src/store/editor';

const scene = () => editor().project!.scenes.find((s) => s.id === editor().sceneId)!;

beforeEach(() => {
  const project = createProject('T', '3d');
  useEditor.getState().open('p1', project);
});

describe('editor history (command pattern)', () => {
  it('undoes and redoes an entity creation', () => {
    const before = scene().entities.length;
    const id = addEntity({ name: 'Box' });
    expect(scene().entities).toHaveLength(before + 1);
    editor().undo();
    expect(scene().entities).toHaveLength(before);
    expect(editor().future).toHaveLength(1);
    editor().redo();
    expect(scene().entities.some((e) => e.id === id)).toBe(true);
  });

  it('a new edit clears the redo stack', () => {
    addEntity({ name: 'A' });
    editor().undo();
    addEntity({ name: 'B' });
    expect(editor().future).toHaveLength(0);
  });

  it('coalesces rapid edits with the same key into one undo step', () => {
    const id = addEntity({ name: 'Slider' });
    const steps = editor().past.length;
    setTransform(id, 'position', [1, 0, 0], 'drag');
    setTransform(id, 'position', [2, 0, 0], 'drag');
    setTransform(id, 'position', [3, 0, 0], 'drag');
    expect(editor().past).toHaveLength(steps + 1);
    editor().undo();
    expect(findEntity(id)!.transform.position).toEqual([0, 0, 0]);
  });

  it('ignores no-op changes (no history entry, no revision bump)', () => {
    const id = addEntity({ name: 'Same' });
    const { past, revision } = editor();
    updateEntity(id, (e) => void (e.name = 'Same'));
    expect(editor().past).toHaveLength(past.length);
    expect(editor().revision).toBe(revision);
  });

  it('keeps the selection valid after undoing a creation', () => {
    const id = addEntity({ name: 'Picked' }, { select: true });
    expect(editor().selection).toContain(id);
    editor().undo();
    expect(editor().selection).not.toContain(id);
  });

  it('marks the project unsaved after every change', () => {
    expect(editor().saveState).toBe('saved');
    addEntity({ name: 'X' });
    expect(editor().saveState).toBe('unsaved');
  });
});

describe('editor commands', () => {
  it('duplicates, reparents and deletes subtrees together', () => {
    const parent = addEntity({ name: 'Parent' });
    const child = addEntity({ name: 'Child' });
    reparent(child, parent);
    const copies = duplicateEntities([parent]);
    expect(copies).toHaveLength(1); // returns the new roots; the child is copied along
    const names = scene().entities.map((e) => e.name);
    expect(names.filter((n) => n.startsWith('Child'))).toHaveLength(2);
    deleteEntities([parent]);
    expect(scene().entities.find((e) => e.id === child)).toBeUndefined();
  });

  it('adds components with defaults and edits a property undoably', () => {
    const id = addEntity({ name: 'Lamp' });
    addComponent(id, 'Light');
    const index = findEntity(id)!.components.findIndex((c) => c.type === 'Light');
    expect(index).toBeGreaterThanOrEqual(0);
    setComponentProp(id, index, 'intensity', 7);
    expect(findEntity(id)!.components[index].intensity).toBe(7);
    editor().undo();
    expect(findEntity(id)!.components[index].intensity).not.toBe(7);
  });
});
