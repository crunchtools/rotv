import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen, fireEvent, cleanup } from '@testing-library/react';
import RemoteLoginModal, { toViewportPoint, classifyKey } from './RemoteLoginModal';
import { fetchResponse } from '../test/fetchResponse';

const VIEWPORT = { width: 800, height: 900 };

describe('toViewportPoint', () => {
  it('scales a click on the displayed image to remote pixels', () => {
    const rect = { left: 10, top: 20, width: 400, height: 450 };
    expect(toViewportPoint({ clientX: 210, clientY: 245 }, rect, VIEWPORT)).toEqual({ x: 400, y: 450 });
  });
  it('clamps to the viewport', () => {
    const rect = { left: 0, top: 0, width: 400, height: 450 };
    expect(toViewportPoint({ clientX: -5, clientY: 999 }, rect, VIEWPORT)).toEqual({ x: 0, y: 900 });
  });
});

describe('classifyKey', () => {
  it('batches printable characters, presses special keys, ignores shortcuts', () => {
    expect(classifyKey({ key: 'a' })).toBe('text');
    expect(classifyKey({ key: '@' })).toBe('text');
    expect(classifyKey({ key: 'Enter' })).toBe('key');
    expect(classifyKey({ key: 'Backspace' })).toBe('key');
    expect(classifyKey({ key: 'v', ctrlKey: true })).toBeNull();
    expect(classifyKey({ key: 'F5' })).toBeNull();
  });
});

describe('RemoteLoginModal', () => {
  let fetchMock;
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const calls = (fragment) => fetchMock.mock.calls.filter(([url]) => url.includes(fragment));

  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => 'blob:frame');
    URL.revokeObjectURL = vi.fn();
    fetchMock = vi.fn((url) => {
      if (url.endsWith('/start')) return Promise.resolve(fetchResponse({ success: true, viewport: VIEWPORT }));
      if (url.endsWith('/frame')) {
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(new Blob(['jpeg'])),
          headers: { get: (h) => (h === 'X-Logged-In' ? 'false' : null) }
        });
      }
      return Promise.resolve(fetchResponse({ success: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts a session, shows frames, and keeps Save disabled until logged in', async () => {
    render(<RemoteLoginModal provider="facebook" label="Facebook" onClose={() => {}} onSaved={() => {}} />);
    await flush();
    await flush();
    expect(calls('/api/admin/remote-login/facebook/start')).toHaveLength(1);
    expect(screen.getByAltText('Facebook login screen')).toBeTruthy();
    expect(screen.getByText('Save session').closest('button').disabled).toBe(true);
  });

  it('batches typed characters into one type event', async () => {
    render(<RemoteLoginModal provider="facebook" label="Facebook" onClose={() => {}} onSaved={() => {}} />);
    await flush();
    const surface = screen.getByRole('application');
    for (const key of 'abc') fireEvent.keyDown(surface, { key });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const inputs = calls('/input').map(([, init]) => JSON.parse(init.body));
    expect(inputs).toEqual([{ type: 'type', text: 'abc' }]);
  });

  it('cancels the remote session on unmount when not saved', async () => {
    const { unmount } = render(<RemoteLoginModal provider="facebook" label="Facebook" onClose={() => {}} onSaved={() => {}} />);
    await flush();
    unmount();
    expect(calls('/cancel')).toHaveLength(1);
  });

  it('saves once logged in, calls onSaved, and does not cancel the saved session', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.endsWith('/start')) return Promise.resolve(fetchResponse({ success: true, viewport: VIEWPORT }));
      if (url.endsWith('/frame')) {
        return Promise.resolve({
          ok: true, blob: () => Promise.resolve(new Blob(['jpeg'])),
          headers: { get: (h) => (h === 'X-Logged-In' ? 'true' : null) }
        });
      }
      if (url.endsWith('/save')) return Promise.resolve(fetchResponse({ success: true, cookiesCount: 2, expires: null }));
      return Promise.resolve(fetchResponse({ success: true }));
    });
    const onSaved = vi.fn();
    const { unmount } = render(<RemoteLoginModal provider="facebook" label="Facebook" onClose={() => {}} onSaved={onSaved} />);
    await flush();
    await flush();
    const save = screen.getByText('Save session').closest('button');
    expect(save.disabled).toBe(false);
    await act(async () => { fireEvent.click(save); await vi.advanceTimersByTimeAsync(0); });
    expect(onSaved).toHaveBeenCalledWith({ success: true, cookiesCount: 2, expires: null });
    unmount();
    expect(calls('/cancel')).toHaveLength(0);
  });

  it('shows the server error when save fails', async () => {
    fetchMock.mockImplementation((url) => {
      if (url.endsWith('/start')) return Promise.resolve(fetchResponse({ success: true, viewport: VIEWPORT }));
      if (url.endsWith('/frame')) {
        return Promise.resolve({
          ok: true, blob: () => Promise.resolve(new Blob(['jpeg'])),
          headers: { get: (h) => (h === 'X-Logged-In' ? 'true' : null) }
        });
      }
      if (url.endsWith('/save')) return Promise.resolve(fetchResponse({ success: false, error: 'Not logged in yet' }, { status: 400 }));
      return Promise.resolve(fetchResponse({ success: true }));
    });
    const onSaved = vi.fn();
    render(<RemoteLoginModal provider="facebook" label="Facebook" onClose={() => {}} onSaved={onSaved} />);
    await flush();
    await flush();
    await act(async () => { fireEvent.click(screen.getByText('Save session')); await vi.advanceTimersByTimeAsync(0); });
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText('Not logged in yet')).toBeTruthy();
  });

  it('keeps polling after a transient frame error', async () => {
    let frameCalls = 0;
    fetchMock.mockImplementation((url) => {
      if (url.endsWith('/start')) return Promise.resolve(fetchResponse({ success: true, viewport: VIEWPORT }));
      if (url.endsWith('/frame')) {
        frameCalls += 1;
        if (frameCalls === 1) return Promise.resolve(fetchResponse({ error: 'screenshot failed' }, { status: 500 }));
        return Promise.resolve({
          ok: true, blob: () => Promise.resolve(new Blob(['jpeg'])),
          headers: { get: () => 'false' }
        });
      }
      return Promise.resolve(fetchResponse({ success: true }));
    });
    render(<RemoteLoginModal provider="facebook" label="Facebook" onClose={() => {}} onSaved={() => {}} />);
    await flush();
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(frameCalls).toBeGreaterThanOrEqual(2);
    expect(screen.getByAltText('Facebook login screen')).toBeTruthy();
  });
});
