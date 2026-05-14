import { X, BarChart as BarChartIcon } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type CompareResult = {
  name: string;
  ilp: number;
  cycles: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  data: CompareResult[] | null;
  loading: boolean;
  error: string | null;
};

export default function ArchitectureCompareModal({ isOpen, onClose, data, loading, error }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass w-[900px] max-w-[95vw] max-h-[90vh] flex flex-col rounded-xl border border-slate-700/50 shadow-2xl overflow-hidden">
        {}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <BarChartIcon className="text-purple-400" size={24} />
            <h2 className="text-lg font-bold text-white">Compare Architectures</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {}
        <div className="p-6 flex-1 overflow-y-auto min-h-[400px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 mt-20">
               <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
               <p>Running benchmark suite across configurations...</p>
            </div>
          ) : error ? (
            <div className="text-red-400 text-sm font-mono whitespace-pre-wrap p-4 bg-red-900/20 border border-red-800 rounded">
               {error}
            </div>
          ) : data && data.length > 0 ? (
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" angle={-25} textAnchor="end" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis yAxisId="left" orientation="left" stroke="#8b5cf6" tick={{ fill: "#8b5cf6" }} />
                  <YAxis yAxisId="right" orientation="right" stroke="#10b981" tick={{ fill: "#10b981" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar yAxisId="left" dataKey="ilp" name="ILP" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="cycles" name="Total Cycles" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center text-slate-500 mt-20">No data available.</div>
          )}
        </div>
      </div>
    </div>
  );
}