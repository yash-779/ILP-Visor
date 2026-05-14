"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight } from "lucide-react";

type Props = {
  currentCycle:    number;
  setCurrentCycle: (c: number | ((prev: number) => number)) => void;
  totalCycles:     number;
};

export default function PlaybackControlBar({ currentCycle, setCurrentCycle, totalCycles }: Props) {
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentCycle((prev: number) => {
          if (prev >= totalCycles) { setPlaying(false); return prev; }
          return prev + 1;
        });
      }, 60);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, totalCycles, setCurrentCycle]);

  const pct = totalCycles > 0 ? ((currentCycle / totalCycles) * 100).toFixed(1) : "0";

  const btnClass = "p-2 rounded-lg transition-all duration-100 hover:bg-white/10 text-slate-400 hover:text-white active:scale-95";

  return (
    <div className="glass px-5 py-3 flex items-center gap-4">
      {}
      <div className="text-sm font-mono min-w-[140px]">
        <span className="text-slate-500">Cycle </span>
        <span className="text-white font-bold">{currentCycle.toLocaleString()}</span>
        <span className="text-slate-600"> / {totalCycles.toLocaleString()}</span>
      </div>

      {}
      <div className="flex items-center gap-1">
        <button id="ctrl-start"  className={btnClass} onClick={() => { stop(); setCurrentCycle(1); }}><ChevronsLeft  size={16}/></button>
        <button id="ctrl-prev"   className={btnClass} onClick={() => { stop(); setCurrentCycle(Math.max(1, currentCycle - 1)); }}><SkipBack  size={16}/></button>
        <button
          id="ctrl-play"
          onClick={() => setPlaying(!playing)}
          className="p-2 rounded-lg transition-all duration-150 text-white active:scale-95"
          style={{ background: playing ? "rgba(239,68,68,0.25)" : "rgba(124,58,237,0.35)", border: "1px solid " + (playing ? "#ef444460" : "#7c3aed60") }}
        >
          {playing ? <Pause size={16}/> : <Play size={16}/>}
        </button>
        <button id="ctrl-next"  className={btnClass} onClick={() => { stop(); setCurrentCycle(Math.min(totalCycles, currentCycle + 1)); }}><SkipForward  size={16}/></button>
        <button id="ctrl-end"   className={btnClass} onClick={() => { stop(); setCurrentCycle(totalCycles); }}><ChevronsRight size={16}/></button>
      </div>

      {}
      <div className="flex-1 flex items-center gap-3">
        <input
          id="scrubber"
          type="range"
          min={1}
          max={totalCycles}
          value={currentCycle}
          onChange={(e) => { stop(); setCurrentCycle(Number(e.target.value)); }}
          className="scrubber-input flex-1"
        />
        <span className="text-xs text-slate-500 w-14 text-right font-mono">{pct}%</span>
      </div>
    </div>
  );
}