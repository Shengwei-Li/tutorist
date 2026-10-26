import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '@tutordesk/providers/types';
import type { AppSettings, TexStatus } from '../../shared/ipc';

export type AiHealth = HealthStatus & { backend: AppSettings['aiBackend'] };

export function useHealth() {
  const [ai, setAi] = useState<AiHealth | null>(null);
  const [tex, setTex] = useState<TexStatus | null>(null);
  const refresh = useCallback((force = false) => {
    setAi(null);
    setTex(null);
    void window.tutordesk.health.ai().then(setAi, (e: Error) => setAi({ ok: false, installed: false, authed: false, detail: e.message, backend: 'api' }));
    void window.tutordesk.health.tex(force).then(setTex, () => setTex({ found: false, missingFiles: [] }));
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { ai, tex, refresh };
}
