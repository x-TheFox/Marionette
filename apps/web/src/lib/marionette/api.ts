/** REST client for the marionette-engine service (via the gateway XTransformPort). */
import type { DirectiveInfo, GameRecord, StartResponse, SweepResponse } from './types';

const API_PORT = 3032;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`/api${path}${sep}XTransformPort=${API_PORT}`, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; runningGames: number; stockfishPresent: boolean; planStoreSize: number; sweepsLoaded: number }>('/health'),
  directives: () => request<{ directives: DirectiveInfo[] }>('/directives'),
  sweep: () => request<SweepResponse>('/sweep'),
  start: (payload: { directiveId: string; opponentElo: number; side: 'w' | 'b' | 'auto'; mode: 'puppeteer' | 'human'; seed?: number }) =>
    request<StartResponse>('/start', { method: 'POST', body: JSON.stringify(payload) }),
  game: (id: string) => request<GameRecord>(`/game/${id}`),
  humanMove: (id: string, from: string, to: string, promotion?: string) =>
    request<{ events: HumanPlyEventClient[]; record: HumanRecordClient }>(`/human/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ from, to, promotion }),
    }),
  humanResign: (id: string) => request<{ record: HumanRecordClient }>(`/human/${id}/resign`, { method: 'POST' }),
};

// Re-declared here to avoid a circular import with the GameRecord union.
import type { HumanPlyEvent, HumanRecord } from './types';
type HumanPlyEventClient = HumanPlyEvent;
type HumanRecordClient = HumanRecord;
