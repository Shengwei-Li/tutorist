import { useCallback, useEffect, useState } from 'react';
import type { HealthStatus } from '@tutordesk/providers/types';
import type { TexStatus } from '../../shared/ipc';

export function useHealth() {
  const [claude, setClaude] = useState<HealthStatus | null>(null);
  const [tex, setTex] = useState<TexStatus | null>(null);
  const refresh = useCallback((force = false) => {
    setClaude(null);
    setTex(null);
    void window.tutordesk.health.claude().then(setClaude, (e: Error) => setClaude({ ok: false, installed: false, authed: false, detail: e.message }));
    void window.tutordesk.health.tex(force).then(setTex, () => setTex({ found: false, missingFiles: [] }));
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { claude, tex, refresh };
}
