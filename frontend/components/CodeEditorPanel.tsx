"use client";
import dynamic from "next/dynamic";
import { Play, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Props = {
  code: string; setCode: (v: string) => void;
  pipelining: boolean; setPipelining: (v: boolean) => void;
  forwarding: boolean; setForwarding: (v: boolean) => void;
  reorder: boolean;    setReorder:    (v: boolean) => void;
  bp: boolean;         setBp:         (v: boolean) => void;
  onRun: () => void;
  onCompare: () => void;
  loading: boolean;
  highlightLine: number | null;
};

function Toggle({ label, value, onChange, color }: { label: string; value: boolean; onChange: () => void; color: string }) {
  return (
    <button
      id={`toggle-${label.replace(/\s/g, "-").toLowerCase()}`}
      onClick={onChange}
      className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all"
      style={{
        background: value ? `${color}22` : "rgba(255,255,255,0.04)",
        border: `1px solid ${value ? color : "#1f1f30"}`,
        color: value ? color : "#6b7280",
      }}
    >
      {value ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
      {label}
    </button>
  );
}

export default function CodeEditorPanel({
  code, setCode, pipelining, setPipelining, forwarding, setForwarding, reorder, setReorder, bp, setBp,
  onRun, onCompare, loading, highlightLine,
}: Props) {
  return (
    <div className="glass flex flex-col overflow-hidden" style={{ height: "100%" }}>
      {}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-xs font-semibold text-slate-300">C++ Input</span>
        <div className="flex items-center gap-2">
          <Toggle label="Pipelining"   value={pipelining} onChange={() => setPipelining(!pipelining)} color="#3b82f6" />
          <Toggle label="Forwarding"   value={forwarding} onChange={() => setForwarding(!forwarding)} color="#ec4899" />
          <Toggle label="Reordering"   value={reorder}    onChange={() => setReorder(!reorder)}       color="#10b981" />
          <Toggle label="Branch Pred." value={bp}         onChange={() => setBp(!bp)}                 color="#f59e0b" />
        </div>
      </div>

      {}
      <div className="flex-1 overflow-hidden">
        <MonacoEditor
          height="100%"
          language="cpp"
          theme="vs-dark"
          value={code}
          onChange={(v) => setCode(v ?? "")}
          options={{
            fontSize: 13,
            fontFamily: "JetBrains Mono",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            lineNumbers: "on",
            padding: { top: 8 },
          }}
        />
      </div>

      {}
      <div className="px-4 py-3 border-t border-border flex gap-3">
        <button
          id="btn-compare"
          onClick={onCompare}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: "rgba(59,130,246,0.2)",
            color: "#60a5fa",
            border: "1px solid #3b82f6",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          Compare Architectures
        </button>
        <button
          id="btn-run-simulation"
          onClick={onRun}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: loading ? "rgba(124,58,237,0.3)" : "rgba(124,58,237,0.8)",
            color: "white",
            border: "1px solid #7c3aed",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? "Running Pipeline…" : "Run Simulation"}
        </button>
      </div>
    </div>
  );
}