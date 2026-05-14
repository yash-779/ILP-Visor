"use client";
import { useMemo } from "react";
import type { ApiResponse } from "@/app/page";

type Props = {
  result: ApiResponse | null;
  currentCycle: number;
  hoveredAsmPc: string | null;
  setHoveredAsmPc: (pc: string | null) => void;
};

export default function SourceAssemblyMapper({ result, currentCycle, hoveredAsmPc, setHoveredAsmPc }: Props) {
  const activeInCycle = useMemo(() => {
    if (!result) return new Set<string>();
    const s = new Set<string>();
    for (const inst of result.simulation.instructions) {
      if (
        inst.fetch_cycle  === currentCycle ||
        inst.issue_cycle  === currentCycle ||
        (inst.issue_cycle !== -1 && inst.issue_cycle < currentCycle && currentCycle <= inst.finish_cycle) ||
        inst.retire_cycle === currentCycle
      ) {
        s.add(inst.pc);
      }
    }
    return s;
  }, [result, currentCycle]);

  const asmEntries = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.simulation.dictionary);
  }, [result]);

  const hoveredLine = hoveredAsmPc ? result?.source_map[hoveredAsmPc]?.line ?? null : null;
  const sourceLines = result?.source_code.split("\n") ?? [];

  if (!result) {
    return (
      <div className="glass flex items-center justify-center text-slate-600 text-sm" style={{ height: "100%" }}>
        Assembly view will appear after simulation.
      </div>
    );
  }

  return (
    <div className="glass flex overflow-hidden" style={{ height: "100%" }}>
      {}
      <div className="flex-1 overflow-auto border-r border-border">
        <div className="px-3 py-2 border-b border-border text-xs font-semibold text-slate-400">C++ Source</div>
        <div className="font-mono text-xs leading-5 py-1">
          {sourceLines.map((line, idx) => {
            const lineNo = idx + 1;
            const isHighlighted = lineNo === hoveredLine;
            return (
              <div
                key={idx}
                className="flex gap-2 px-3 transition-colors"
                style={{
                  background: isHighlighted ? "rgba(124,58,237,0.25)" : "transparent",
                  borderLeft: isHighlighted ? "2px solid #7c3aed" : "2px solid transparent",
                }}
              >
                <span className="text-slate-600 select-none w-5 text-right shrink-0">{lineNo}</span>
                <span className="text-slate-300 whitespace-pre">{line}</span>
              </div>
            );
          })}
        </div>
      </div>

      {}
      <div className="flex-1 overflow-auto">
        <div className="px-3 py-2 border-b border-border text-xs font-semibold text-slate-400">x86-64 Assembly (dictionary.txt)</div>
        <div className="font-mono text-xs leading-5 py-1">
          {asmEntries.map(([pc, meta]) => {
            const isActive  = activeInCycle.has(pc);
            const isHovered = hoveredAsmPc === pc;
            return (
              <div
                key={pc}
                id={`asm-${pc}`}
                onMouseEnter={() => setHoveredAsmPc(pc)}
                onMouseLeave={() => setHoveredAsmPc(null)}
                className="flex gap-3 px-3 py-0.5 cursor-pointer transition-all"
                style={{
                  background: isHovered
                    ? "rgba(124,58,237,0.2)"
                    : isActive
                    ? "rgba(14,165,233,0.1)"
                    : "transparent",
                  borderLeft: isActive ? "2px solid #0ea5e9" : isHovered ? "2px solid #7c3aed" : "2px solid transparent",
                }}
              >
                <span className="text-slate-600 shrink-0">{pc}</span>
                <span style={{ color: isActive ? "#0ea5e9" : "#f59e0b" }}>{meta.opcode}</span>
                <span className="text-slate-500">{meta.reads.join(", ")}</span>
                {meta.writes.length > 0 && <span className="text-slate-600">→ {meta.writes.join(", ")}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}