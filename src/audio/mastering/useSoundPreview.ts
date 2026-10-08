import { useCallback, useEffect, useRef, useState } from "react";
import type { SynchronizedAudioEngine } from "../SynchronizedAudioEngine";
import type { MasteringSettings } from "./settings";
import { measureLoudness } from "./measure";
import { normalizationGain } from "./loudness";

type Session = { identity: string; source: number; controller: AbortController; buffer: AudioBuffer; lufs?: number; measuring?: Promise<number> };
export function useSoundPreview(engine: SynchronizedAudioEngine, ensureBuffer: (source: number, signal?: AbortSignal)=>Promise<AudioBuffer>, identity: string, settings: MasteringSettings, onError: (message: string)=>void) {
  const loudnessCache = useRef(new Map<string, number>());
  const session = useRef<Session | null>(null), request = useRef<AbortController | null>(null), latest = useRef(settings);
  const revision = useRef(0), appliedFrame = useRef(0);
  const [appliedRevision, setAppliedRevision] = useState(0);
  const [status, setStatus] = useState<"idle" | "preparing" | "applying" | "applied" | "bypassed">("idle");
  const [preview, setPreview] = useState<"processed" | "original" | null>(null), [loading,setLoading] = useState(false);
  useEffect(()=>{latest.current=settings;},[settings]);
  const end = useCallback(() => {
    revision.current++; cancelAnimationFrame(appliedFrame.current); appliedFrame.current = 0; setStatus("idle");
    request.current?.abort(); request.current=null; session.current?.controller.abort(); session.current=null;
    engine.endPreview(); setPreview(null); setLoading(false);
  },[engine]);
  const acknowledge = useCallback((version: number, bypassed = false) => {
    cancelAnimationFrame(appliedFrame.current);
    const check = () => {
      if (version !== revision.current || !session.current || engine.previewSource === null) return;
      if (engine.previewIsApplied) { appliedFrame.current = 0; setStatus(bypassed ? "bypassed" : "applied"); setAppliedRevision(version); }
      else appliedFrame.current = requestAnimationFrame(check);
    };
    appliedFrame.current = requestAnimationFrame(check);
  }, [engine]);
  const analyze = useCallback((current: Session) => {
    const key = `${current.identity}:${current.buffer.sampleRate}:${current.buffer.length}`;
    const cached = loudnessCache.current.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    current.measuring ??= measureLoudness(current.buffer,current.controller.signal).then(lufs => {
      current.controller.signal.throwIfAborted(); loudnessCache.current.set(key,lufs);
      if (loudnessCache.current.size > 32) loudnessCache.current.delete(loudnessCache.current.keys().next().value!);
      return lufs;
    });
    return current.measuring;
  }, []);
  const bypassed = useRef(false);
  const sync = useCallback(async (current: Session, s: MasteringSettings) => {
    const version = ++revision.current; cancelAnimationFrame(appliedFrame.current);
    setStatus("applying");
    if(s.mode==="mastering" && s.normalizeLoudness && current.lufs===undefined) {
      setLoading(true); setStatus("preparing");
      current.lufs=await analyze(current);
    }
    if(session.current!==current || current.controller.signal.aborted || version !== revision.current) return;
    // Read the newest settings after an asynchronous measurement.
    const now=latest.current;
    engine.updatePreview(now,normalizationGain(current.lufs ?? -Infinity,now.targetLufs)); setLoading(false); setStatus("applying"); acknowledge(version, bypassed.current);
  },[engine,analyze,acknowledge]);
  const begin = useCallback(async (source: number) => {
    end(); const controller=new AbortController(); request.current=controller; setLoading(true); setStatus("preparing");
    try {
      const buffer=await ensureBuffer(source,controller.signal); controller.signal.throwIfAborted();
      const current: Session={source,identity,controller,buffer}; session.current=current;
      const s=latest.current;
      // Normalization uses source LUFS in the upstream live graph. Export
      // separately measures the processed signal before the final limiter.
      if(s.mode==="mastering"&&s.normalizeLoudness) { current.lufs=await analyze(current); }
      controller.signal.throwIfAborted();
      if(!engine.beginPreview(source,latest.current,normalizationGain(current.lufs ?? -Infinity,latest.current.targetLufs))) throw new Error("This source is unavailable for preview.");
      bypassed.current = false; setPreview("processed"); setLoading(false); setStatus("applying"); acknowledge(++revision.current);
    } catch(error) { if(!controller.signal.aborted) { end(); onError(error instanceof Error?error.message:"Could not preview audio."); } }
  },[end,engine,ensureBuffer,identity,onError,analyze,acknowledge]);
  const bypass = useCallback(() => {
    if (!session.current) return;
    const next = preview === "original" ? "processed" : "original";
    bypassed.current = next === "original"; engine.bypassPreview(next === "original"); setPreview(next); setStatus("applying");
    acknowledge(++revision.current, next === "original");
  },[engine,preview,acknowledge]);
  useEffect(()=>{
    const current=session.current; if(!current) return;
    void sync(current,settings).catch(error=>{if(!current.controller.signal.aborted){end();onError(error instanceof Error?error.message:"Preview failed.");}});
  },[settings,sync,end,onError]);
  useEffect(()=>{ return end; },[identity,end]);
  return { preview, loading, status, appliedRevision, begin, bypass, end };
}
