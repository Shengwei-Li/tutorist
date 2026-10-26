/// <reference types="vite/client" />
import type { DesktopApi } from '../../shared/ipc';

declare global {
  interface Window {
    tutordesk: DesktopApi;
  }
}
