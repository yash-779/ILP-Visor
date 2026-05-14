"use client";
import { useMemo } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import type { SimInstruction } from "@/app/page";

type GlobalStats = {
  total_cycles:       number;
  actual_retired:     number;
  total_executed:     number;
  wasted_speculative: number;
  final_ilp:          number;
  config: { pipelining?: boolean; forwarding: boolean; reorder: boolean; branch_prediction: boolean };
};

type Props = {
  instructions: SimInstruction[];
  globalStats:  GlobalStats;
  currentCycle: number;
  totalCycles:  number;
};


const TOOLTIP_STYLE = {
  background: "rgba(10,10,18,0.96)",
  border: "1px solid #1f1f30",
  borderRadius: 8,
  fontSize: 11,
  backdropFilter: "blur(12px)",
  color: "#e2e8f0",
};
const TOOLTIP_ITEM_STYLE = { color: "#e2e8f0" };
const TOOLTIP_LABEL_STYLE = { color: "#94a3b8" };
const GRID_COLOR = "#1e293b";
const AXIS_TICK = { fontSize: 9, fill: "#475569" };


function classifyOp(op: string): "INT" | "FP" | "MEM" | "BRANCH" {
  const o = op.toLowerCase();
  if (/^j|call|ret|^b/.test(o) || /cmp|test/.test(o)) return "BRANCH";
  if (/mov|push|pop|lea/.test(o)) return "MEM";
  if (/div|sqrt|fadd|fsub|vadd|vsub/.test(o)) return "FP";
  return "INT";
}


function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div className="rounded-xl p-3 text-center transition-all duration-300" style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
      <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
      <div className="text-lg font-bold font-mono" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}


function ChartCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-4 flex flex-col gap-2">
      <div>
        <p className="text-xs font-semibold text-slate-300">{title}</p>
        <p className="text-[9px] text-slate-500 mt-0.5">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export default function AnalyticsDashboard({ instructions, globalStats, currentCycle, totalCycles }: Props) {

  const data = useMemo(() => {
    const retired   = instructions.filter(i => !i.is_speculative_waste && i.retire_cycle !== -1 && i.retire_cycle <= currentCycle);
    const allVisible = instructions.filter(i => i.fetch_cycle <= currentCycle);

    let fwdCount = 0, lsqCount = 0, flushCount = 0, rawCount = 0;
    for (const inst of allVisible) {
      if (inst.is_speculative_waste) { flushCount++; continue; }
      if (inst.is_mem_stalled) lsqCount++;
      if (inst.stalled_on_reg && inst.stalled_on_inst_id !== -1) rawCount++;
      if (inst.forwarded_data_from_inst_ids?.length > 0) fwdCount++;
    }

    let rawStalls = 0, lsqStalls = 0, branchFlush = 0, structStalls = 0;
    for (const inst of allVisible) {
      if (inst.is_speculative_waste) { branchFlush++; continue; }
      if (inst.is_mem_stalled) { lsqStalls++; continue; }
      if (inst.stalled_on_reg && inst.stalled_on_inst_id !== -1) { rawStalls++; continue; }
      if (inst.issue_cycle !== -1 && inst.issue_cycle > inst.fetch_cycle + 1) structStalls++;
    }
    const stallBudget = [
      { name: "Branch Flush",   value: branchFlush,  color: "#ef4444" },
      { name: "LSQ Memory",     value: lsqStalls,    color: "#f97316" },
      { name: "RAW Hazard",     value: rawStalls,    color: "#eab308" },
      { name: "Structural",     value: structStalls, color: "#3b82f6" },
    ].filter(d => d.value > 0);

    const SAMPLE = Math.max(1, Math.floor(totalCycles / 80));
    const robData: { cycle: number; inflight: number }[] = [];
    for (let c = 1; c <= currentCycle; c += SAMPLE) {
      let inflight = 0;
      for (const inst of instructions) {
        if (inst.fetch_cycle <= c && (inst.retire_cycle === -1 || inst.retire_cycle > c)) inflight++;
      }
      robData.push({ cycle: c, inflight });
    }

    const WIN = 10;
    const rollingILP: { cycle: number; ilp: number }[] = [];
    for (let c = WIN; c <= currentCycle; c += Math.max(1, Math.floor(totalCycles / 80))) {
      const count = instructions.filter(i => !i.is_speculative_waste && i.retire_cycle >= c - WIN + 1 && i.retire_cycle <= c).length;
      rollingILP.push({ cycle: c, ilp: parseFloat((count / WIN).toFixed(3)) });
    }

    const latBuckets: Record<string, number> = { "1-3": 0, "4-6": 0, "7-10": 0, "11-15": 0, "16-20": 0, "21+": 0 };
    for (const inst of retired) {
      const lat = inst.retire_cycle - inst.fetch_cycle;
      if (lat <= 3)       latBuckets["1-3"]++;
      else if (lat <= 6)  latBuckets["4-6"]++;
      else if (lat <= 10) latBuckets["7-10"]++;
      else if (lat <= 15) latBuckets["11-15"]++;
      else if (lat <= 20) latBuckets["16-20"]++;
      else                latBuckets["21+"]++;
    }
    const latencyData = Object.entries(latBuckets).map(([name, count]) => ({ name, count }));

    const rawDist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5+": 0 };
    for (const inst of allVisible) {
      if (inst.stalled_on_inst_id === -1) continue;
      const dist = inst.inst_id - inst.stalled_on_inst_id;
      if (dist <= 0) continue;
      if (dist === 1) rawDist["1"]++;
      else if (dist === 2) rawDist["2"]++;
      else if (dist === 3) rawDist["3"]++;
      else if (dist === 4) rawDist["4"]++;
      else rawDist["5+"]++;
    }
    const rawDistData = Object.entries(rawDist).map(([name, count]) => ({ name, count }));

    const opcodeMap: Record<string, { clean: number; stalled: number }> = {
      INT: { clean: 0, stalled: 0 },
      FP:  { clean: 0, stalled: 0 },
      MEM: { clean: 0, stalled: 0 },
      BRANCH: { clean: 0, stalled: 0 },
    };
    for (const inst of allVisible) {
      if (inst.is_speculative_waste) continue;
      const cls = classifyOp(inst.opcode || "");
      const isStalled = inst.issue_cycle !== -1 && inst.issue_cycle > inst.fetch_cycle + 1;
      if (isStalled) opcodeMap[cls].stalled++;
      else opcodeMap[cls].clean++;
    }
    const opcodeData = Object.entries(opcodeMap).map(([name, v]) => ({ name, ...v }));

    const branchMap = new Map<string, { hits: number; misses: number }>();
    for (const inst of allVisible) {
      if (!inst.is_branch) continue;
      const entry = branchMap.get(inst.pc) ?? { hits: 0, misses: 0 };
      if (inst.predicted_next_pc === inst.actual_next_pc) entry.hits++;
      else entry.misses++;
      branchMap.set(inst.pc, entry);
    }
    const branchData = Array.from(branchMap.entries())
      .sort((a, b) => (b[1].hits + b[1].misses) - (a[1].hits + a[1].misses))
      .slice(0, 12)
      .map(([pc, v]) => ({ name: `…${pc.slice(-4)}`, hits: v.hits, misses: v.misses }));

    return {
      fwdCount, lsqCount, flushCount, rawCount,
      retiredCount: retired.length,
      stallBudget, robData, rollingILP,
      latencyData, rawDistData, opcodeData, branchData,
    };
  }, [instructions, currentCycle, totalCycles]);

  return (
    <div className="flex flex-col gap-5">

      {}
      <div className="grid grid-cols-6 gap-3">
        <StatCard label="Final ILP"         value={globalStats.final_ilp.toFixed(4)} color="#a78bfa" />
        <StatCard label="Retired"           value={data.retiredCount.toLocaleString()} color="#6366f1" />
        <StatCard label="Fwd Events"        value={data.fwdCount.toLocaleString()}     color="#10b981" sub="bypass activations" />
        <StatCard label="RAW Stalls"        value={data.rawCount.toLocaleString()}     color="#eab308" sub="register hazards" />
        <StatCard label="LSQ Stalls"        value={data.lsqCount.toLocaleString()}     color="#f97316" sub="memory collisions" />
        <StatCard label="Flushed"           value={data.flushCount.toLocaleString()}   color="#ef4444" sub="speculative waste" />
      </div>

      {}
      <div className="grid grid-cols-3 gap-4">

        {}
        <ChartCard title="Stall Budget Breakdown" hint="Your primary bottleneck at a glance. Branch Flush → bad BP. RAW → dense deps. LSQ → memory aliasing.">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data.stallBudget}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="48%"
                innerRadius={52}
                outerRadius={78}
                paddingAngle={4}
                strokeWidth={0}
              >
                {data.stallBudget.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                itemStyle={TOOLTIP_ITEM_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                formatter={(value: number, name: string) => [value.toLocaleString(), name]}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                layout="horizontal"
                verticalAlign="bottom"
                align="center"
                wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {}
        <ChartCard title="ROB Occupancy Over Time" hint="Dips to 0 = branch flush recovery (5 dead cycles). Low sustained occupancy = pipeline starved.">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.robData}>
              <defs>
                <linearGradient id="robGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="cycle" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Area type="monotone" dataKey="inflight" stroke="#3b82f6" strokeWidth={2} fill="url(#robGrad)" name="In-Flight Insts" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {}
        <ChartCard title="Rolling ILP (10-cycle window)" hint="Valleys = branch flushes or memory stalls. A flat high line = steady superscalar throughput.">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.rollingILP}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="cycle" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
              <Line type="monotone" dataKey="ilp" stroke="#a78bfa" strokeWidth={2} dot={false} name="ILP" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {}
        <ChartCard title="Fetch-to-Retire Latency (cycles)" hint="Tight around 3–5 = clean pipeline. Long tail (16+) = memory latency or deep RAW chains dominating.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: "#1e293b" }} />
              <Bar dataKey="count" fill="#14b8a6" name="Instructions" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {}
        <ChartCard title="RAW Dependency Distance" hint="Distance 1 = consecutive insts sharing a register, hardest case. Distance 4+ = OoOE can easily hide this.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.rawDistData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} label={{ value: "Instruction Distance", position: "insideBottom", offset: -2, fontSize: 9, fill: "#475569" }} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: "#1e293b" }} />
              <Bar dataKey="count" fill="#f59e0b" name="Stalls" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {}
        <ChartCard title="Execution Unit Utilization (Stacked)" hint="High MEM stall rate = memory-bound. High BRANCH stall = unpredictable code. Balanced = well-optimized.">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.opcodeData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: "#1e293b" }} />
              <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
              <Bar dataKey="clean"   stackId="a" fill="#10b981" name="Clean"   radius={[0, 0, 0, 0]} />
              <Bar dataKey="stalled" stackId="a" fill="#ef4444" name="Stalled" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {}
        <div className="col-span-3">
          <ChartCard title="Branch Prediction Accuracy by PC (Last 4 Hex Digits)" hint="50/50 hit rate = hard-to-predict branch (loop exit, switch). 100% hits = BTB converged. Misses → 5-cycle pipeline flush each.">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.branchData} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} cursor={{ fill: "#1e293b" }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
                <Bar dataKey="hits"   fill="#10b981" name="Predicted Correctly" radius={[0, 4, 4, 0]} />
                <Bar dataKey="misses" fill="#ef4444" name="Mispredicted"        radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {}
      <div className="flex gap-2 text-[10px]">
        {[
          { k: "pipelining",        label: "Pipelining",       color: "#3b82f6" },
          { k: "forwarding",        label: "Data Forwarding",  color: "#10b981" },
          { k: "reorder",           label: "Out-of-Order",     color: "#a78bfa" },
          { k: "branch_prediction", label: "Branch Pred.",     color: "#f59e0b" },
        ].map(({ k, label, color }) => {
          const on = globalStats.config[k as keyof typeof globalStats.config];
          return (
            <span key={k} className="px-2 py-1 rounded-full transition-all duration-300"
              style={{ background: on ? `${color}20` : "rgba(255,255,255,0.04)", border: `1px solid ${on ? color : "#1f1f30"}`, color: on ? color : "#4b5563" }}>
              {label}: {on ? "ON" : "OFF"}
            </span>
          );
        })}
      </div>
    </div>
  );
}