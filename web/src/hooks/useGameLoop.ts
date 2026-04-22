import { useEffect, useRef } from 'react';

export type GameLoopCallback = (deltaMs: number) => void;

export const useGameLoop = (isRunning: boolean, onFrame: GameLoopCallback) => {
  const callbackRef = useRef(onFrame);
  const frameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!isRunning) {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      const lastTime = lastTimeRef.current ?? timestamp;
      const deltaMs = timestamp - lastTime;
      lastTimeRef.current = timestamp;
      callbackRef.current(deltaMs);
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      lastTimeRef.current = null;
    };
  }, [isRunning]);
};

export default useGameLoop;
