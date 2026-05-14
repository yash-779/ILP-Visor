"use client";
import { useRef, useCallback } from "react";
import { Virtuoso } from "react-virtuoso";
import { motion } from "framer-motion";
import type { SimInstruction, CycleState } from "@/app/page";

type DictEntry = { opcode: string; reads: string[]; writes: string[] };

type Props = {
  cycleState:   CycleState;
  dictionary:   Record<string, DictEntry>;
  currentCycle: number;
};

function getStage(inst: SimInstruction, cycle: number): string {
  if (inst.is_speculative_waste && inst.retire_cycle <= cycle) return "waste";
  if (inst.retire_cycle !== -1 && inst.retire_cycle <= cycle)  return "retired";
  if (inst.fetch_cycle > cycle) return "not-fetched";
  if (inst.issue_cycle === -1 || inst.issue_cycle > cycle)     return "fetch";
  if (cycle <= inst.finish_cycle)                               return "execute";
  return "execute-done";
}

const STAGE_COLOR: Record<string, string> = {
  "fetch":        "#0ea5e9",
  "execute":      "#10b981",
  "execute-done": "#6366f1",
  "waste":        "#ef4444",
  "retired":      "#334155",
};


function InstructionRow({
  inst, stage, color, isOoOE, isFwd, dict,
}: {
  inst: SimInstruction;
  stage: string;
  color: string;
  isOoOE: boolean;
  isFwd: boolean;
  dict: DictEntry | undefined;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono mb-1 ${isOoOE ? "pulse-superscalar" : ""} ${isFwd ? "pulse-forward" : ""}`}
      style={{
        background: `${color}0a`,
        border: `1px solid ${isFwd ? "#ec4899" : isOoOE ? "#7c3aed" : color}30`,
        transition: "background 0.1s, border-color 0.1s",
      }}
    >
      {}
      <span className="text-slate-600 w-8 text-right shrink-0">#{inst.inst_id}</span>

      {}
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />

      {}
      <span className="text-slate-500 w-20 shrink-0">{inst.pc}</span>

      {}
      <span className="font-semibold w-16 shrink-0" style={{ color }}>
        {inst.opcode || "???"}
      </span>

      {}
      {dict && (
        <span className="text-slate-500 shrink-0 text-[10px]">
          {dict.reads.join(", ")}
          {dict.writes.length > 0 ? ` → ${dict.writes.join(", ")}` : ""}
        </span>
      )}

      {}
      <div className="ml-auto flex gap-1">
        {inst.is_mem_stalled && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(249,115,22,0.15)", color: "#fb923c", border: "1px solid #f9731630" }}
            title={inst.stalled_on_mem_addr ? `Memory: 0x${inst.stalled_on_mem_addr} blocked by #${inst.stalled_on_inst_id}` : ""}
          >
            ⚠️ LSQ{inst.stalled_on_mem_addr ? ` (${inst.stalled_on_mem_addr.slice(-4)})` : ""}
          </span>
        )}
        {!inst.is_mem_stalled && inst.stalled_on_reg && inst.issue_cycle === -1 && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid #ef444430" }}
            title={`RAW on [${inst.stalled_on_reg}] from #${inst.stalled_on_inst_id}`}
          >
            ⛔ RAW [{inst.stalled_on_reg}]
          </span>
        )}
        {isFwd && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "rgba(236,72,153,0.15)", color: "#ec4899", border: "1px solid #ec489930" }}>
            FWD ←{inst.forwarded_data_from_inst_ids.map(id => `#${id}`).join(",")}
          </span>
        )}
        {inst.is_branch && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(234,179,8,0.15)", color: "#facc15", border: "1px solid #eab30830" }}
          >
            {inst.predicted_next_pc && inst.actual_next_pc && inst.predicted_next_pc !== inst.actual_next_pc ? "⚠ BRANCH MISS" : "🌿 BRANCH"}
          </span>
        )}
        {isOoOE && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "rgba(124,58,237,0.15)", color: "#a78bfa", border: "1px solid #7c3aed30" }}>
            OoOE
          </span>
        )}
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full"
          style={{ background: `${color}15`, color, border: `1px solid ${color}25` }}
        >
          {stage.toUpperCase().replace("-", " ")}
        </span>
      </div>

      {}
      <div className="flex gap-1 text-[9px] text-slate-600 shrink-0">
        <span>F:{inst.fetch_cycle}</span>
        {inst.issue_cycle !== -1 && <span>I:{inst.issue_cycle}</span>}
        {inst.finish_cycle !== -1 && <span>X:{inst.finish_cycle}</span>}
      </div>
    </div>
  );
}

export default function InstructionWindow({ cycleState, dictionary, currentCycle }: Props) {
  const { robInsts, issuedIds, forwardedIds, wasted } = cycleState;

  const itemContent = useCallback(
    (index: number) => {
      const inst = robInsts[index];
      if (!inst) return null;
      const stage = getStage(inst, currentCycle);
      const color = STAGE_COLOR[stage] ?? "#475569";
      const isOoOE = issuedIds.has(inst.inst_id) && issuedIds.size > 1;
      const isFwd = forwardedIds.has(inst.inst_id);
      const dict = dictionary[inst.pc];

      return (
        <InstructionRow
          inst={inst}
          stage={stage}
          color={color}
          isOoOE={isOoOE}
          isFwd={isFwd}
          dict={dict}
        />
      );
    },
    [robInsts, currentCycle, issuedIds, forwardedIds, dictionary]
  );

  return (
    <div className="glass h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0" style={{ backdropFilter: "blur(8px)" }}>
        <span className="text-xs font-semibold text-slate-400">
          Reorder Buffer <span className="text-slate-600 ml-1">({robInsts.length} entries)</span>
        </span>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span><span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />Fetch</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />Execute</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-indigo-500 mr-1" />Done</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-pink-500 mr-1" />Fwd</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-purple-500 mr-1" />OoOE</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Waste</span>
        </div>
      </div>

      {}
      <div className="px-3 pt-2 flex flex-col gap-1 shrink-0">
        {issuedIds.size > 1 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="text-[10px] px-3 py-1.5 rounded-lg font-semibold text-purple-300"
            style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)" }}
          >
            ⚡ Superscalar Dispatch — {issuedIds.size} instructions issued simultaneously this cycle!
          </motion.div>
        )}
        {wasted.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="text-[10px] px-3 py-1.5 rounded-lg font-semibold text-red-300"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            🗑 Pipeline Flush — {wasted.length} speculative instruction{wasted.length > 1 ? "s" : ""} discarded this cycle
          </motion.div>
        )}
      </div>

      {}
      <div className="flex-1 px-3 pb-2">
        {robInsts.length > 0 ? (
          <Virtuoso
            totalCount={robInsts.length}
            itemContent={itemContent}
            overscan={20}
            style={{ height: "100%" }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-700 text-xs py-8 h-full">
            ROB is empty at cycle {currentCycle}
          </div>
        )}
      </div>
    </div>
  );
}