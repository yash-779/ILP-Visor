"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Zap, CornerDownRight, Activity } from "lucide-react";
import type { SimInstruction, CycleState } from "@/app/page";

type Props = {
  cycleState: CycleState;
  currentCycle: number;
};

export default function PipelineVisualizer({ cycleState, currentCycle }: Props) {
  const [hoveredInst, setHoveredInst] = useState<SimInstruction | null>(null);

  const getDiagnosis = (inst: SimInstruction) => {
    if (inst.is_speculative_waste && inst.retire_cycle !== -1 && inst.retire_cycle <= currentCycle) {
      return "🔴 Pipeline Flush: Victim of BTB Branch Misprediction.";
    }

    const hasIssued = inst.issue_cycle !== -1 && inst.issue_cycle <= currentCycle;

    if (!hasIssued) {
      if (inst.fetch_cycle === currentCycle) {
        return "⏳ Decoding... (Will attempt issue next cycle).";
      }
      if (inst.is_mem_stalled) {
        const addr = inst.stalled_on_mem_addr ? `0x${inst.stalled_on_mem_addr}` : "unknown";
        const src  = inst.stalled_on_inst_id !== -1 ? ` from Instruction #${inst.stalled_on_inst_id}` : "";
        return `🔒 LSQ Stall: Address collision at ${addr}${src}`;
      }
      if (inst.stalled_on_reg && inst.stalled_on_inst_id !== -1) {
        return `⛔ RAW Stall: Waiting on register [${inst.stalled_on_reg}] produced by Instruction #${inst.stalled_on_inst_id}`;
      }
      return "⏳ Active Stall: RAW Data Hazard or Structural Hazard.";
    }

    const delay = inst.issue_cycle - inst.fetch_cycle - 1;
    let diag = "";
    if (delay > 0) {
      if (inst.is_mem_stalled) {
        const addr = inst.stalled_on_mem_addr ? `0x${inst.stalled_on_mem_addr}` : "unknown";
        diag = `🔒 Resolved LSQ Stall at ${addr} (delayed ${delay}c). `;
      } else if (inst.stalled_on_reg) {
        diag = `✅ Resolved RAW on [${inst.stalled_on_reg}] from #${inst.stalled_on_inst_id} (delayed ${delay}c). `;
      } else {
        diag = `✅ Resolved Hazard (delayed ${delay}c). `;
      }
    }

    if (inst.forwarded_data_from_inst_ids?.length > 0) {
      diag += `⚡ Data Forwarding: Bypassed from Instruction(s) #${inst.forwarded_data_from_inst_ids.join(", #")}`;
    }

    if (!diag) diag = "✅ Issued and executing normally.";
    return diag.trim();
  };

  const is_fp = (op: string) => /div|sqrt|fadd|fsub|vadd|vsub/i.test(op);
  const is_mem = (op: string) => /mov|push|pop|lea/i.test(op);
  const intInsts = cycleState.executing.filter(i => !is_fp(i.opcode) && !is_mem(i.opcode));
  const fpInsts = cycleState.executing.filter(i => is_fp(i.opcode));
  const memInsts = cycleState.executing.filter(i => is_mem(i.opcode));

  const getRobColor = (inst: SimInstruction) => {
    if (inst.is_speculative_waste && inst.retire_cycle !== -1 && inst.retire_cycle <= currentCycle) return "#ef4444";
    if (inst.issue_cycle === -1 || inst.issue_cycle > currentCycle) return "#eab308";
    if (inst.finish_cycle === -1 || inst.finish_cycle > currentCycle) return "#3b82f6";
    return "#10b981";
  };

  const InstBlock = ({ inst, isRob = false }: { inst: SimInstruction, isRob?: boolean }) => {
    const isFlushing = inst.is_speculative_waste && inst.retire_cycle === currentCycle;
    const isForwarded = cycleState.forwardedIds.has(inst.inst_id);
    const color = isRob ? getRobColor(inst) : "#a78bfa";

    return (
      <div
        onMouseEnter={() => setHoveredInst(inst)}
        onMouseLeave={() => setHoveredInst(null)}
        className="relative px-2 py-1 rounded text-[11px] font-mono cursor-pointer border flex justify-between items-center overflow-hidden"
        style={{
          background: `${color}15`,
          borderColor: isForwarded && !isRob ? "#ec4899" : `${color}40`,
          color: color,
          boxShadow: isForwarded && !isRob ? "0 0 8px #ec4899" : "none"
        }}
      >
        <span className="z-10 truncate">#{inst.inst_id} {inst.opcode}</span>
        {}
        {!isRob && inst.issue_cycle !== -1 && inst.finish_cycle > inst.issue_cycle + 1 && currentCycle >= inst.issue_cycle && currentCycle < inst.finish_cycle && (
          <div
            className="absolute left-0 bottom-0 h-[2px] bg-emerald-400 opacity-50 z-0"
            style={{ width: `${((currentCycle - inst.issue_cycle) / (inst.finish_cycle - inst.issue_cycle)) * 100}%` }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-10 grid-rows-10 gap-4 h-[600px] w-full">
      {}
      <div className="col-span-3 row-span-10 glass p-3 flex flex-col relative overflow-hidden">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-2">
            <Activity size={14}/> Reorder Buffer
          </h3>
          <div className="flex gap-2 text-[9px] font-mono">
            <span className="flex items-center gap-1 text-yellow-500"><div className="w-2 h-2 bg-yellow-500/20 border border-yellow-500/50 rounded-sm"></div>Unissued</span>
            <span className="flex items-center gap-1 text-blue-400"><div className="w-2 h-2 bg-blue-500/20 border border-blue-500/50 rounded-sm"></div>Exec</span>
            <span className="flex items-center gap-1 text-emerald-400"><div className="w-2 h-2 bg-emerald-500/20 border border-emerald-500/50 rounded-sm"></div>Finish</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-1 relative">
          <AnimatePresence>
            {cycleState.robInsts.map((inst, idx) => {
              const isHead = idx === 0;
              const isTail = idx === cycleState.robInsts.length - 1;
              return (
                <motion.div
                  key={inst.inst_id}
                  className="relative flex items-center"
                  exit={inst.is_speculative_waste ? { opacity: 0, x: -10, scale: 0.9, filter: "brightness(0.5) hue-rotate(-50deg)" } : { opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex-1">
                    <InstBlock inst={inst} isRob={true} />
                  </div>
                  {isHead && <span className="ml-2 text-[10px] text-emerald-400 font-bold whitespace-nowrap">← HEAD</span>}
                  {isTail && !isHead && <span className="ml-2 text-[10px] text-sky-400 font-bold whitespace-nowrap">← TAIL</span>}
                </motion.div>
              );
            })}
            {cycleState.robInsts.length === 0 && (
              <span className="text-slate-600 text-xs italic mt-4 text-center">ROB is empty</span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {}
      <div className="col-span-7 row-span-6 glass p-3 flex flex-col">
        <h3 className="text-xs font-semibold text-slate-400 mb-3">Pipeline Datapath</h3>
        <div className="flex-1 flex gap-3 min-h-0">
          {}
          <div className="flex-1 flex flex-col gap-2 rounded-lg p-2 min-h-0" style={{ background: "rgba(14,165,233,0.05)", border: "1px solid rgba(14,165,233,0.2)" }}>
            <h4 className="text-[10px] font-bold text-sky-400 tracking-widest text-center">FETCH [F]</h4>
            <div className="flex flex-col gap-1 flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
              <AnimatePresence>
                {cycleState.fetched.map(inst => (
                  <div key={inst.inst_id} className="relative">
                    <InstBlock inst={inst} />
                    {/j|call|ret|b/i.test(inst.opcode) && (
                      <div className="absolute -top-1 -right-1 bg-yellow-500 text-black text-[8px] font-bold px-1 rounded">BTB</div>
                    )}
                  </div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {}
          <div className="flex-1 flex flex-col gap-2 rounded-lg p-2 min-h-0" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <h4 className="text-[10px] font-bold text-amber-400 tracking-widest text-center">ISSUE [I]</h4>
            <div className="flex flex-col gap-1 flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
              <AnimatePresence>
                {cycleState.robInsts
                  .filter(i => i.fetch_cycle < currentCycle && (i.issue_cycle === -1 || i.issue_cycle >= currentCycle))
                  .map(inst => {
                    const isStalled = inst.issue_cycle === -1 || inst.issue_cycle > currentCycle;
                    const isHazard = isStalled && currentCycle > inst.fetch_cycle + 1;
                    return (
                      <div key={inst.inst_id} className={`relative ${isHazard ? 'opacity-60' : ''}`}>
                        <InstBlock inst={inst} />
                        {isHazard && (
                          inst.is_mem_stalled ? (
                            <div className="absolute -right-2 top-1/2 -translate-y-1/2 text-orange-500"><Lock size={12}/></div>
                          ) : (
                            <div className="text-[8px] text-red-400 text-right w-full mt-0.5">RAW Hazard</div>
                          )
                        )}
                      </div>
                    );
                  })}
              </AnimatePresence>
            </div>
          </div>

          {}
          <div className="flex-[1.5] flex flex-col gap-2 rounded-lg p-2 min-h-0" style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <h4 className="text-[10px] font-bold text-emerald-400 tracking-widest text-center">EXECUTE [E]</h4>
            <div className="flex-1 grid grid-cols-3 gap-2 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
              <div className="flex flex-col gap-1 border-r border-emerald-900/30 pr-1">
                <span className="text-[9px] text-slate-500 text-center">INT (x4)</span>
                {intInsts.map(i => <InstBlock key={i.inst_id} inst={i} />)}
              </div>
              <div className="flex flex-col gap-1 border-r border-emerald-900/30 px-1">
                <span className="text-[9px] text-slate-500 text-center">FP (x2)</span>
                {fpInsts.map(i => <InstBlock key={i.inst_id} inst={i} />)}
              </div>
              <div className="flex flex-col gap-1 pl-1">
                <span className="text-[9px] text-slate-500 text-center">MEM (x2)</span>
                {memInsts.map(i => <InstBlock key={i.inst_id} inst={i} />)}
              </div>
            </div>
          </div>

          {}
          <div className="flex-1 flex flex-col gap-2 rounded-lg p-2 min-h-0" style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.2)" }}>
            <h4 className="text-[10px] font-bold text-indigo-400 tracking-widest text-center">RETIRE [R]</h4>
            <div className="flex flex-col gap-1 flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
              <AnimatePresence>
                {cycleState.retired.map(inst => (
                  <motion.div key={inst.inst_id} exit={{ opacity: 0, x: 20 }}>
                    <InstBlock inst={inst} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </div>

      {}
      <div className="col-span-7 row-span-4 glass p-4 flex flex-col relative overflow-hidden">
        <h3 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-2">
          <CornerDownRight size={14}/> Telemetry Inspector
        </h3>
        {hoveredInst ? (
          <div className="flex gap-8 h-full">
            <div className="flex flex-col gap-2 w-1/3">
              <div className="text-2xl font-mono text-white font-bold px-3 py-1 rounded bg-slate-800/50 border border-slate-700 break-words">
                #{hoveredInst.inst_id} {hoveredInst.opcode}
              </div>
              <div className="text-xs font-mono text-slate-400 ml-1">PC: {hoveredInst.pc}</div>
              <div className="mt-2 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded">
                <b>Diagnosis:</b> <br/> {getDiagnosis(hoveredInst)}
              </div>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1 text-sm justify-center">
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-500">Fetched:</span>
                  <span className="font-mono text-sky-400">Cycle {hoveredInst.fetch_cycle}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-500">Issued:</span>
                  <span className="font-mono text-amber-400">
                    {hoveredInst.issue_cycle !== -1 && hoveredInst.issue_cycle <= currentCycle ? (
                      <>
                        Cycle {hoveredInst.issue_cycle}
                        {hoveredInst.issue_cycle > hoveredInst.fetch_cycle + 1 &&
                          <span className="text-[10px] text-slate-500 ml-1">(Stalled {hoveredInst.issue_cycle - hoveredInst.fetch_cycle - 1}c)</span>
                        }
                      </>
                    ) : (
                      <span className="text-slate-500 italic">[Pending...]</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-500">Finished:</span>
                  <span className="font-mono text-emerald-400">
                    {hoveredInst.finish_cycle !== -1 && hoveredInst.finish_cycle <= currentCycle ? (
                      <>
                        Cycle {hoveredInst.finish_cycle}
                        {hoveredInst.issue_cycle !== -1 && hoveredInst.issue_cycle <= currentCycle &&
                          <span className="text-[10px] text-slate-500 ml-1">({hoveredInst.finish_cycle - hoveredInst.issue_cycle}c latency)</span>
                        }
                      </>
                    ) : (
                      <span className="text-slate-500 italic">[Pending...]</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-500">Retired:</span>
                  <span className="font-mono text-indigo-400">
                    {hoveredInst.retire_cycle !== -1 && hoveredInst.retire_cycle <= currentCycle ? (
                      `Cycle ${hoveredInst.retire_cycle}`
                    ) : (
                      <span className="text-slate-500 italic">[In Flight...]</span>
                    )}
                  </span>
                </div>
              </div>

              {hoveredInst.issue_cycle !== -1 && hoveredInst.issue_cycle <= currentCycle && hoveredInst.forwarded_data_from_inst_ids?.length > 0 && (
                <div className="flex flex-col justify-center items-center p-3 rounded border border-pink-500/30 bg-pink-500/5">
                  <Zap className="text-pink-400 mb-1" size={24} />
                  <span className="text-xs text-pink-300 text-center font-semibold">Data Forwarding Bypassed Writeback</span>
                  <span className="text-xs text-slate-400 mt-2 font-mono">
                    Sources: #{hoveredInst.forwarded_data_from_inst_ids.join(", #")}
                  </span>
                </div>
              )}
              {hoveredInst.is_branch && hoveredInst.issue_cycle !== -1 && hoveredInst.issue_cycle <= currentCycle && (
                <div className="flex flex-col justify-center items-center p-3 rounded border border-yellow-500/30 bg-yellow-500/5">
                  <span className="text-xs text-yellow-300 font-semibold mb-1">🌿 Branch Target</span>
                  <div className="text-[10px] font-mono text-slate-400 flex flex-col gap-1 w-full">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Predicted:</span>
                      <span className="text-amber-400">{hoveredInst.predicted_next_pc || "Not Taken"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Actual:</span>
                      <span className={hoveredInst.predicted_next_pc === hoveredInst.actual_next_pc ? "text-emerald-400" : "text-red-400"}>
                        {hoveredInst.actual_next_pc}
                        {hoveredInst.predicted_next_pc !== hoveredInst.actual_next_pc && " ⚠ Mispredicted"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-slate-800 rounded-lg">
            <p className="text-slate-500 text-sm">Hover over an instruction block to inspect its telemetry.</p>
          </div>
        )}
      </div>
    </div>
  );
}