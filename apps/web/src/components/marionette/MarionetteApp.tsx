'use client';

/**
 * Project Marionette — puppeteer view. All views are client-side states
 * driven by URL query params on `/`:
 *   /                          lobby
 *   /?view=game&id=<id>        live game (puppeteer or human)
 *   /?replay=<id>              deterministic replay of a finished game
 *   /?replaySeed=<dir>&elo=<n>&seed=<n>   server-side re-run (share link)
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Volume2, VolumeX, Activity } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { sound } from '@/lib/marionette/sound';
import { api } from '@/lib/marionette/api';
import Lobby from './Lobby';
import GameView from './GameView';
import ReplayView from './ReplayView';

function Shell() {
  const router = useRouter();
  const params = useSearchParams();
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [serviceOk, setServiceOk] = useState<boolean | null>(null);
  const rerunBusy = useRef(false);

  useEffect(() => {
    sound.setEnabled(!muted);
  }, [muted]);

  useEffect(() => {
    sound.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    let alive = true;
    api
      .health()
      .then(() => alive && setServiceOk(true))
      .catch(() => alive && setServiceOk(false));
    return () => {
      alive = false;
    };
  }, []);

  // ?replaySeed=<directiveId>&elo=<n>&seed=<n> -> re-run the offline game
  // server-side (deterministic) and open its live view.
  const replaySeed = params.get('replaySeed');
  const replaySeedElo = params.get('elo');
  const replaySeedNum = params.get('seed');
  useEffect(() => {
    if (!replaySeed || rerunBusy.current) return;
    rerunBusy.current = true;
    api
      .start({
        directiveId: replaySeed,
        opponentElo: Number(replaySeedElo ?? 800) || 800,
        side: 'auto',
        mode: 'puppeteer',
        seed: replaySeedNum != null ? Number(replaySeedNum) : undefined,
      })
      .then((res) => {
        router.replace(`/?view=game&id=${res.gameId}`);
      })
      .catch((e: Error) => {
        console.error('replaySeed re-run failed:', e.message);
        rerunBusy.current = false;
      });
  }, [replaySeed, replaySeedElo, replaySeedNum, router]);

  const replayId = params.get('replay');
  const view = params.get('view');
  const gameId = params.get('id');

  const navigate = useCallback(
    (to: string) => {
      router.push(to);
    },
    [router],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background stage-vignette">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 px-2 font-semibold text-primary"
            onClick={() => navigate('/')}
            aria-label="Back to lobby"
          >
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Project Marionette</span>
            <span className="sm:hidden">Marionette</span>
          </Button>
          <span className="hidden text-xs text-muted-foreground md:inline">the puppeteer view</span>
          <div className="ml-auto flex items-center gap-3">
            <span
              className={`h-2 w-2 rounded-full ${serviceOk === true ? 'bg-emerald-400' : serviceOk === false ? 'bg-rose-400' : 'bg-muted-foreground'}`}
              title={serviceOk === true ? 'Engine service online' : serviceOk === false ? 'Engine service unreachable' : 'Checking engine service...'}
            />
            <div className="hidden items-center gap-2 sm:flex">
              <VolumeX className={`h-4 w-4 ${muted ? 'text-primary' : 'text-muted-foreground'}`} />
              <Slider
                value={[muted ? 0 : volume]}
                min={0}
                max={1}
                step={0.05}
                className="w-24"
                onValueChange={(v) => {
                  const vol = v[0] ?? 0.7;
                  setVolume(vol);
                  if (vol > 0 && muted) setMuted(false);
                }}
                aria-label="Sound volume"
              />
              <Volume2 className="h-4 w-4 text-muted-foreground" />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-9"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span className="ml-1 text-xs">{muted ? 'Muted' : 'Sound'}</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {replayId ? (
          <ReplayView gameId={replayId} onNavigate={navigate} />
        ) : view === 'game' && gameId ? (
          <GameView gameId={gameId} onNavigate={navigate} />
        ) : view === 'game' || view === 'human' ? (
          <div className="py-20 text-center text-muted-foreground">No game id given. Head back to the lobby.</div>
        ) : replaySeed ? (
          <div className="py-20 text-center text-muted-foreground">Re-running the deterministic game server-side...</div>
        ) : (
          <Lobby onNavigate={navigate} serviceOk={serviceOk} />
        )}
      </main>

      <footer className="mt-auto border-t border-border/60 bg-background/80 px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Pieces: cburnett set, BSD-3-Clause &middot; Sounds: Kenney (CC0)</span>
          <span>Engine: Stockfish 19 steered by Marionette &middot; Bars frozen, failures shown as they are</span>
        </div>
      </footer>
    </div>
  );
}

export default function MarionetteApp() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <Shell />
    </Suspense>
  );
}
