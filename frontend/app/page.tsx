"use client";
import { useState, useCallback, useMemo } from "react";
import CodeEditorPanel from "@/components/CodeEditorPanel";
import SourceAssemblyMapper from "@/components/SourceAssemblyMapper";
import PlaybackControlBar from "@/components/PlaybackControlBar";
import PipelineVisualizer from "@/components/PipelineVisualizer";
import InstructionWindow from "@/components/InstructionWindow";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import ArchitectureCompareModal from "@/components/ArchitectureCompareModal";
import { Cpu, Zap, Activity, AlertTriangle } from "lucide-react";



export type SimInstruction = {
  inst_id: number;
  pc: string;
  opcode: string;
  fetch_cycle: number;
  issue_cycle: number;
  finish_cycle: number;
  retire_cycle: number;
  is_speculative_waste: boolean;
  is_mem_stalled: boolean;
  forwarded_data_from_inst_ids: number[];
  stalled_on_reg: string;
  stalled_on_inst_id: number;
  stalled_on_mem_addr: string;
  is_branch: boolean;
  predicted_next_pc: string;
  actual_next_pc: string;
};

export type SimResult = {
  global_stats: {
    total_cycles: number;
    actual_retired: number;
    total_executed: number;
    wasted_speculative: number;
    final_ilp: number;
    config: { pipelining: boolean; forwarding: boolean; reorder: boolean; branch_prediction: boolean };
  };
  dictionary: Record<string, { opcode: string; reads: string[]; writes: string[] }>;
  instructions: SimInstruction[];
};

export type ApiResponse = {
  source_code: string;
  source_map: Record<string, { file: string; line: number }>;
  simulation: SimResult;
};


export type CycleState = {
  fetched: SimInstruction[];
  issued: SimInstruction[];
  executing: SimInstruction[];
  retired: SimInstruction[];
  wasted: SimInstruction[];
  issuedIds: Set<number>;
  forwardedIds: Set<number>;
  robInsts: SimInstruction[];
};

const EMPTY_CYCLE: CycleState = {
  fetched: [], issued: [], executing: [], retired: [], wasted: [],
  issuedIds: new Set(), forwardedIds: new Set(), robInsts: [],
};

const DEFAULT_CODE = `#include <iostream>
using namespace std;

int main() {
    int sum = 0;
    for (int i = 0; i < 100; i++) {
        sum += i * i;
    }
    cout << sum << endl;
    return 0;
}`;

export default function Home() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [pipelining, setPipelining] = useState(true);
  const [forwarding, setForwarding] = useState(true);
  const [reorder, setReorder] = useState(true);
  const [bp, setBp] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareData, setCompareData] = useState<any[] | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [currentCycle, setCurrentCycle] = useState(0);
  const [hoveredAsmPc, setHoveredAsmPc] = useState<string | null>(null);

  const totalCycles = result?.simulation.global_stats.total_cycles ?? 0;

  const timeline = useMemo(() => {
    if (!result) return null;
    const insts = result.simulation.instructions;
    const tc = result.simulation.global_stats.total_cycles;
    const map = new Map<number, CycleState>();

    const getState = (c: number): CycleState => {
      let s = map.get(c);
      if (!s) {
        s = {
          fetched: [], issued: [], executing: [], retired: [], wasted: [],
          issuedIds: new Set(), forwardedIds: new Set(), robInsts: [],
        };
        map.set(c, s);
      }
      return s;
    };

    for (const inst of insts) {
      if (inst.fetch_cycle >= 1 && inst.fetch_cycle <= tc) {
        getState(inst.fetch_cycle).fetched.push(inst);
      }
      if (inst.issue_cycle >= 1 && inst.issue_cycle <= tc) {
        const s = getState(inst.issue_cycle);
        s.issued.push(inst);
        s.issuedIds.add(inst.inst_id);
        if (inst.forwarded_data_from_inst_ids.length > 0) {
          s.forwardedIds.add(inst.inst_id);
        }
      }
      if (inst.is_speculative_waste && inst.retire_cycle >= 1 && inst.retire_cycle <= tc) {
        getState(inst.retire_cycle).wasted.push(inst);
      } else if (!inst.is_speculative_waste && inst.retire_cycle >= 1 && inst.retire_cycle <= tc) {
        getState(inst.retire_cycle).retired.push(inst);
      }
      if (inst.issue_cycle >= 1 && inst.finish_cycle >= 1) {
        for (let c = inst.issue_cycle + 1; c <= Math.min(inst.finish_cycle, tc); c++) {
          getState(c).executing.push(inst);
        }
      }
    }

    const sorted = [...insts].sort((a, b) => a.fetch_cycle - b.fetch_cycle);
    const activeSet = new Set<number>();
    const activeMap = new Map<number, SimInstruction>();
    let addIdx = 0;

    const removals: { cycle: number; inst_id: number }[] = [];
    for (const inst of sorted) {
      if (!inst.is_speculative_waste && inst.retire_cycle >= 1) {
        removals.push({ cycle: inst.retire_cycle, inst_id: inst.inst_id });
      }
      if (inst.is_speculative_waste && inst.retire_cycle >= 1) {
        removals.push({ cycle: inst.retire_cycle, inst_id: inst.inst_id });
      }
    }
    removals.sort((a, b) => a.cycle - b.cycle);
    let remIdx = 0;

    for (let c = 1; c <= tc; c++) {
      while (addIdx < sorted.length && sorted[addIdx].fetch_cycle <= c) {
        const inst = sorted[addIdx];
        if (!inst.is_speculative_waste) {
          activeSet.add(inst.inst_id);
          activeMap.set(inst.inst_id, inst);
        }
        addIdx++;
      }
      while (remIdx < removals.length && removals[remIdx].cycle <= c) {
        const id = removals[remIdx].inst_id;
        activeSet.delete(id);
        activeMap.delete(id);
        remIdx++;
      }
      const s = getState(c);
      s.robInsts = Array.from(activeMap.values());
    }

    return map;
  }, [result]);

  const cycleState: CycleState = timeline?.get(currentCycle) ?? EMPTY_CYCLE;

  const runSimulation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setCurrentCycle(0);
    try {
      const res = await fetch("http://localhost:8000/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pipelining, forwarding, reorder, branch_prediction: bp }),
      });
      if (!res.ok) {
        const err = await res.json();
        const detail = err.detail;
        if (detail?.stage) {
          throw new Error(`[${detail.stage.toUpperCase()}] ${detail.error}`);
        }
        throw new Error(JSON.stringify(detail));
      }
      const data: ApiResponse = await res.json();
      setResult(data);
      setCurrentCycle(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [code, pipelining, forwarding, reorder, bp]);

  const runCompare = useCallback(async () => {
    setCompareModalOpen(true);
    setCompareLoading(true);
    setCompareError(null);
    setCompareData(null);
    try {
      const res = await fetch("http://localhost:8000/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(`[${err.detail?.stage?.toUpperCase() || 'ERROR'}] ${err.detail?.error || JSON.stringify(err.detail)}`);
      }
      const data = await res.json();
      setCompareData(data);
    } catch (e: unknown) {
      setCompareError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompareLoading(false);
    }
  }, [code]);

  return (
    <div className="min-h-screen flex flex-col gap-5 p-5" style={{ background: "#0a0a12" }}>

      { }
      <header className="flex items-center gap-4">
        <div className="header-icon-wrapper">
          <Cpu size={24} className="text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white leading-tight tracking-tight">ILP Visor</h1>
          <p className="text-xs text-slate-500">Cycle-Accurate x86-64 Out-of-Order Execution Visualizer</p>
        </div>
        {result && (
          <div className="ml-auto flex gap-5 items-center">
            <div className="stat-pill stat-pill-purple">
              <Zap size={12} />
              <span>ILP</span>
              <b>{result.simulation.global_stats.final_ilp.toFixed(4)}</b>
            </div>
            <div className="stat-pill stat-pill-blue">
              <Activity size={12} />
              <span>Cycles</span>
              <b>{totalCycles.toLocaleString()}</b>
            </div>
            <div className="stat-pill stat-pill-indigo">
              <span>Retired</span>
              <b>{result.simulation.global_stats.actual_retired.toLocaleString()}</b>
            </div>
            <div className="stat-pill stat-pill-red">
              <AlertTriangle size={12} />
              <span>Wasted</span>
              <b>{result.simulation.global_stats.wasted_speculative.toLocaleString()}</b>
            </div>
          </div>
        )}
      </header>

      { }
      <div className="grid grid-cols-2 gap-5" style={{ height: "380px" }}>
        <CodeEditorPanel
          code={code}
          setCode={setCode}
          pipelining={pipelining} setPipelining={setPipelining}
          forwarding={forwarding} setForwarding={setForwarding}
          reorder={reorder} setReorder={setReorder}
          bp={bp} setBp={setBp}
          onRun={runSimulation}
          onCompare={runCompare}
          loading={loading}
          highlightLine={hoveredAsmPc && result ? result.source_map[hoveredAsmPc]?.line ?? null : null}
        />
        <SourceAssemblyMapper
          result={result}
          currentCycle={currentCycle}
          hoveredAsmPc={hoveredAsmPc}
          setHoveredAsmPc={setHoveredAsmPc}
        />
      </div>

      {error && (
        <div className="glass p-4 text-red-400 text-sm font-mono whitespace-pre-wrap" style={{ borderColor: "#7f1d1d" }}>
          <b>Error:</b> {error}
        </div>
      )}

      {result && (
        <>
          { }
          <PlaybackControlBar
            currentCycle={currentCycle}
            setCurrentCycle={setCurrentCycle}
            totalCycles={totalCycles}
          />

          { }
          <div className="w-full">
            <PipelineVisualizer
              cycleState={cycleState}
              currentCycle={currentCycle}
            />
          </div>

          { }
          <AnalyticsDashboard
            instructions={result.simulation.instructions}
            globalStats={result.simulation.global_stats}
            currentCycle={currentCycle}
            totalCycles={totalCycles}
          />
        </>
      )}

      {!result && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Cpu size={48} className="text-slate-800 mx-auto mb-4" />
            <p className="text-slate-600 text-sm">
              Write your C++ code, configure the hardware toggles, and click <b className="text-purple-400 mx-1">Run Simulation</b>.
            </p>
          </div>
        </div>
      )}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="shimmer-container">
            <div className="shimmer-bar shimmer-bar-1" />
            <div className="shimmer-bar shimmer-bar-2" />
            <div className="shimmer-bar shimmer-bar-3" />
            <p className="text-purple-400 text-sm mt-4 font-medium">
              Compiling → Extracting Trace → Simulating…
            </p>
          </div>
        </div>
      )}

      { }
      <ArchitectureCompareModal
        isOpen={compareModalOpen}
        onClose={() => setCompareModalOpen(false)}
        data={compareData}
        loading={compareLoading}
        error={compareError}
      />
    </div>
  );
}