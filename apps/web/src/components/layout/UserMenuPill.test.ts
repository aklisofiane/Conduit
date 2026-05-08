import { describe, expect, it, vi } from 'vitest';
import {
  createAndSwitchOrganization,
  filterOtherOrgs,
  switchOrganization,
} from './UserMenuPill.js';

describe('filterOtherOrgs', () => {
  const orgs = [
    { id: 'a', name: 'Acme Inc' },
    { id: 'b', name: 'Beta Co' },
    { id: 'c', name: 'Acme Foundation' },
    { id: 'd', name: 'Hobby Projects' },
  ];

  it('drops the active org from the list', () => {
    expect(filterOtherOrgs(orgs, 'a', '').map((o) => o.id)).toEqual(['b', 'c', 'd']);
  });

  it('case-insensitively filters by name', () => {
    expect(filterOtherOrgs(orgs, 'a', 'acme').map((o) => o.id)).toEqual(['c']);
  });

  it('treats whitespace-only filter as no filter', () => {
    expect(filterOtherOrgs(orgs, undefined, '   ')).toHaveLength(4);
  });
});

describe('switchOrganization', () => {
  it('calls setActive, fires onAfterSwitch, and navigates to /', async () => {
    const setActive = vi.fn(async () => ({ id: 'b' }));
    const navigate = vi.fn();
    const onAfterSwitch = vi.fn();
    const setError = vi.fn();

    const ok = await switchOrganization('b', {
      setActive,
      navigate,
      onAfterSwitch,
      setError,
    });

    expect(ok).toBe(true);
    expect(setActive).toHaveBeenCalledWith({ organizationId: 'b' });
    expect(onAfterSwitch).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/');
    // Cache invalidation is the responsibility of useSetActiveOrganization's
    // onSuccess hook (covered by organization.test.ts) — switchOrganization
    // only needs to fire the mutation. Assert that we did not navigate
    // before awaiting the mutation:
    expect(setActive.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]!,
    );
  });

  it('on failure, returns false, does not navigate, surfaces the message', async () => {
    const setActive = vi.fn(async () => {
      throw new Error('Forbidden');
    });
    const navigate = vi.fn();
    const onAfterSwitch = vi.fn();
    const setError = vi.fn();

    const ok = await switchOrganization('b', {
      setActive,
      navigate,
      onAfterSwitch,
      setError,
    });

    expect(ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(onAfterSwitch).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Forbidden');
  });
});

describe('createAndSwitchOrganization', () => {
  it('happy path creates, switches, and navigates home', async () => {
    const createOrganization = vi.fn(async () => ({ id: 'new-1' }));
    const setActive = vi.fn(async () => ({ id: 'new-1' }));
    const navigate = vi.fn();
    const onAfterSwitch = vi.fn();
    const setError = vi.fn();

    const ok = await createAndSwitchOrganization('  Open Source Co  ', {
      createOrganization,
      setActive,
      navigate,
      onAfterSwitch,
      setError,
    });

    expect(ok).toBe(true);
    expect(createOrganization).toHaveBeenCalledWith({ name: 'Open Source Co' });
    expect(setActive).toHaveBeenCalledWith({ organizationId: 'new-1' });
    expect(onAfterSwitch).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('empty name is a no-op (does not call any API)', async () => {
    const createOrganization = vi.fn();
    const setActive = vi.fn();
    const navigate = vi.fn();

    const ok = await createAndSwitchOrganization('   ', {
      createOrganization: createOrganization as never,
      setActive: setActive as never,
      navigate,
      onAfterSwitch: () => {},
      setError: () => {},
    });

    expect(ok).toBe(false);
    expect(createOrganization).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('on createOrganization failure, surfaces error and does not switch', async () => {
    const createOrganization = vi.fn(async () => {
      throw new Error('Slug taken');
    });
    const setActive = vi.fn();
    const navigate = vi.fn();
    const setError = vi.fn();

    const ok = await createAndSwitchOrganization('Acme', {
      createOrganization,
      setActive: setActive as never,
      navigate,
      onAfterSwitch: () => {},
      setError,
    });

    expect(ok).toBe(false);
    expect(setActive).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Slug taken');
  });

  it('on setActive failure (after successful create), still surfaces error', async () => {
    const createOrganization = vi.fn(async () => ({ id: 'new-1' }));
    const setActive = vi.fn(async () => {
      throw new Error('Network blip');
    });
    const navigate = vi.fn();
    const setError = vi.fn();

    const ok = await createAndSwitchOrganization('Acme', {
      createOrganization,
      setActive,
      navigate,
      onAfterSwitch: () => {},
      setError,
    });

    expect(ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('Network blip');
  });
});
