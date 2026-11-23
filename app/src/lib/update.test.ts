import { describe, expect, it, vi } from 'vitest';
import { _checkForTests, _setReloadForTests, setUpdateGate, updateReady } from './update';

describe('mise à jour de l’appli', () => {
  it('ne recharge jamais pendant un suivi, même appli cachée', () => {
    const reload = vi.fn();
    _setReloadForTests(reload);
    setUpdateGate({ busy: true, idle: false });
    updateReady();
    _checkForTests(true);
    expect(reload).not.toHaveBeenCalled();
    // Fin du suivi, écran d'accueil : on recharge.
    setUpdateGate({ busy: false, idle: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('attend que l’appli soit au repos ou qu’on la quitte', () => {
    const reload = vi.fn();
    _setReloadForTests(reload);
    setUpdateGate({ busy: false, idle: false });
    updateReady();
    expect(reload).not.toHaveBeenCalled();
    _checkForTests(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recharge tout de suite si rien n’est affiché', () => {
    const reload = vi.fn();
    _setReloadForTests(reload);
    setUpdateGate({ busy: false, idle: true });
    updateReady();
    expect(reload).toHaveBeenCalledTimes(1);
    // Une seule fois.
    setUpdateGate({ busy: false, idle: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
