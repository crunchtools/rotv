import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useDragReorder from './useDragReorder';

const ITEMS = ['a', 'b', 'c', 'd'];

function dragEvent(overrides = {}) {
  return {
    target: document.createElement('li'),
    currentTarget: document.createElement('ul'),
    relatedTarget: null,
    preventDefault: vi.fn(),
    dataTransfer: { setData: vi.fn(), effectAllowed: null, dropEffect: null },
    ...overrides
  };
}

// dragProps closes over the render's state, so re-read result.current between steps.
function drag(result, fromIndex, toIndex) {
  act(() => { result.current.dragProps(fromIndex, true).onDragStart(dragEvent()); });
  act(() => { result.current.dragProps(toIndex, true).onDragOver(dragEvent()); });
  act(() => { result.current.dragProps(toIndex, true).onDrop(dragEvent()); });
}

describe('useDragReorder', () => {
  it('moves an item forward', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(ITEMS, onReorder));

    drag(result, 0, 2);

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a', 'd']);
    expect(ITEMS).toEqual(['a', 'b', 'c', 'd']); // input untouched
  });

  it('moves an item backward', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(ITEMS, onReorder));

    drag(result, 3, 1);

    expect(onReorder).toHaveBeenCalledWith(['a', 'd', 'b', 'c']);
  });

  it('ignores a drop on the dragged row and clears drag state', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(ITEMS, onReorder));

    act(() => { result.current.dragProps(1, true).onDragStart(dragEvent()); });
    expect(result.current.dragClassName(1)).toContain('dragging');

    act(() => { result.current.dragProps(1, true).onDrop(dragEvent()); });

    expect(onReorder).not.toHaveBeenCalled();
    expect(result.current.dragClassName(1).trim()).toBe('');
  });

  it('ignores a drop when nothing is being dragged', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() => useDragReorder(ITEMS, onReorder));
    const drop = dragEvent();

    act(() => { result.current.dragProps(2, true).onDrop(drop); });

    expect(drop.preventDefault).toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('tracks dragging and drag-over classes until the drag ends', () => {
    const { result } = renderHook(() => useDragReorder(ITEMS, vi.fn()));
    const start = dragEvent();
    const over = dragEvent();

    act(() => { result.current.dragProps(0, true).onDragStart(start); });
    act(() => { result.current.dragProps(2, true).onDragOver(over); });

    expect(start.dataTransfer.effectAllowed).toBe('move');
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('move');
    expect(result.current.dragClassName(0)).toContain('dragging');
    expect(result.current.dragClassName(2)).toContain('drag-over');

    act(() => { result.current.dragProps(0, true).onDragEnd(start); });

    expect(result.current.dragClassName(0).trim()).toBe('');
    expect(result.current.dragClassName(2).trim()).toBe('');
  });

  it('keeps drag-over while the pointer moves within the row and clears it on leaving', () => {
    const { result } = renderHook(() => useDragReorder(ITEMS, vi.fn()));
    const row = document.createElement('li');
    const child = document.createElement('span');
    row.appendChild(child);

    act(() => { result.current.dragProps(0, true).onDragStart(dragEvent()); });
    act(() => { result.current.dragProps(1, true).onDragOver(dragEvent()); });

    act(() => { result.current.dragProps(1, true).onDragLeave(dragEvent({ currentTarget: row, relatedTarget: child })); });
    expect(result.current.dragClassName(1)).toContain('drag-over');

    act(() => { result.current.dragProps(1, true).onDragLeave(dragEvent({ currentTarget: row, relatedTarget: null })); });
    expect(result.current.dragClassName(1)).not.toContain('drag-over');
  });
});
