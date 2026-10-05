import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

vi.mock('../ImageUploader', () => ({ default: () => null }));
vi.mock('../RoleEditor', () => ({ default: () => null }));
vi.mock('../GeoJSONUploader', () => ({ default: () => null }));
vi.mock('./CellSignal', () => ({ EditableCellSignal: () => null }));

const { default: EditView } = await import('./EditView');

const monument = { id: 5849, name: 'John Brown Monument' };
const marina = { id: 5846, name: 'East 55th Street Marina' };
const draft = { brief_description: 'A memorial to the abolitionist John Brown.' };

let finishResearch;

function renderEditor(poi, setEditedData) {
  return (
    <EditView
      destination={poi}
      editedData={poi}
      setEditedData={setEditedData}
      onSave={vi.fn()}
      onCancel={vi.fn()}
      onDelete={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url === '/api/admin/ai/research-v2') {
      return new Promise((resolve) => {
        finishResearch = () => resolve({ ok: true, json: async () => ({ data: draft }) });
      });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EditView AI research', () => {
  it('names the researched POI in the draft and applies it on accept', async () => {
    const setEditedData = vi.fn();
    render(renderEditor(monument, setEditedData));

    fireEvent.click(screen.getByRole('button', { name: 'Research with AI' }));
    await act(async () => finishResearch());

    expect(await screen.findByText('Research Draft — John Brown Monument')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));

    const applyUpdate = setEditedData.mock.calls.at(-1)[0];
    expect(applyUpdate(monument)).toEqual({ ...monument, ...draft });
  });

  it('drops a research result that lands after the editor moved to another POI', async () => {
    const setEditedData = vi.fn();
    const { rerender } = render(renderEditor(monument, setEditedData));

    fireEvent.click(screen.getByRole('button', { name: 'Research with AI' }));
    rerender(renderEditor(marina, setEditedData));
    await act(async () => finishResearch());

    await waitFor(() => expect(screen.getByRole('button', { name: 'Research with AI' })).toBeTruthy());
    expect(screen.queryByText(/Research Draft/)).toBeNull();
    expect(setEditedData).not.toHaveBeenCalled();
  });
});
