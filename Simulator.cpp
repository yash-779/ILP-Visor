#include <iostream>
#include <fstream>
#include <vector>
#include <deque>
#include <string>
#include <unordered_map>
#include <sstream>
#include <algorithm>
#include <cstdlib>
#include <ctime>
#include "json.hpp"
using namespace std;
using json = nlohmann::json;
string get_arg(int argc, char* argv[], const string& key, const string& def = "") {
    for (int i = 1; i < argc; ++i) {
        string arg = argv[i];
        string prefix = "--" + key + "=";
        if (arg.rfind(prefix, 0) == 0)
            return arg.substr(prefix.size());
        if (arg == "--" + key && i + 1 < argc)
            return argv[i + 1];
    }
    return def;
}
struct InstMetaData {
    string opcode;
    vector<string> read_regs;
    vector<string> write_regs;
    bool is_mem_read  = false;
    bool is_mem_write = false;
    int  size = 0;
};
struct BTBEntry {
    string tag;
    string target_pc;
    int    state = 1;
    bool   valid = false;
};
struct DynInst {
    int    inst_id       = -1;
    string pc;
    string opcode;
    vector<string> read_regs;
    vector<string> write_regs;
    int fetch_cycle  = -1;
    int issue_cycle  = -1;
    int finish_cycle = -1;
    int retire_cycle = -1;
    bool is_finished         = false;
    bool is_speculative_waste = false;
    vector<int> forwarded_data_from_inst_ids;
    bool   is_branch         = false;
    string predicted_next_pc = "";
    string actual_next_pc    = "";
    string fallthrough_pc    = "";
    bool   actual_taken      = false;
    size_t actual_trace_index = -1;
    string memory_address;
    bool   mem_is_load   = false;
    bool   mem_is_store  = false;
    bool   is_mem_stalled = false;
    string stalled_on_reg      = "";
    int    stalled_on_inst_id  = -1;
    string stalled_on_mem_addr = "";
};
class ILPSimulator {
private:
    bool use_pipelining;
    bool use_data_forwarding;
    bool use_reorder;
    bool use_branch_prediction;
    static constexpr int WINDOW_SIZE = 128;
    static constexpr int FETCH_WIDTH = 4;
    static constexpr int INT_ALU     = 4;
    static constexpr int FP_ALU      = 2;
    static constexpr int MEM_ALU     = 2;
    static constexpr int BTB_SIZE    = 512;
    int current_cycle = 0;
    int instructions_executed = 0;
    int instructions_retired  = 0;
    int next_inst_id          = 0;
    deque<DynInst> instruction_window;
    vector<BTBEntry> btb_table;
    int flush_penalty_timer = 0;
    bool stall_for_branch   = false;
    vector<string>                    full_trace;
    size_t                            trace_index = 0;
    unordered_map<string, InstMetaData> dictionary;
    json json_instructions = json::array();
    string json_out_path;
    size_t btb_index(const string& pc) const {
        return std::hash<string>{}(pc) % BTB_SIZE;
    }
    void btb_update(const string& pc, const string& target, bool actually_taken) {
        size_t idx = btb_index(pc);
        if (!btb_table[idx].valid || btb_table[idx].tag != pc) {
            btb_table[idx].tag       = pc;
            btb_table[idx].target_pc = target;
            btb_table[idx].valid     = true;
            btb_table[idx].state     = actually_taken ? 2 : 1;
        } else {
            if (actually_taken) {
                if (btb_table[idx].state < 3) btb_table[idx].state++;
                btb_table[idx].target_pc = target;
            } else {
                if (btb_table[idx].state > 0) btb_table[idx].state--;
            }
        }
    }
    string btb_predict(const string& pc, const string& fallthrough_pc) const {
        size_t idx = btb_index(pc);
        if (btb_table[idx].valid && btb_table[idx].tag == pc) {
            if (btb_table[idx].state >= 2) {
                return btb_table[idx].target_pc;
            } else {
                return fallthrough_pc;
            }
        }
        return fallthrough_pc;
    }
public:
    ILPSimulator(const string& trace_path,
                 const string& dict_path,
                 bool pipelining,
                 bool forwarding,
                 bool reorder,
                 bool bp,
                 const string& out_path)
        : use_pipelining(pipelining),
          use_data_forwarding(forwarding),
          use_reorder(reorder),
          use_branch_prediction(bp),
          btb_table(BTB_SIZE),
          json_out_path(out_path)
    {
        load_dictionary(dict_path);
        ifstream tf(trace_path);
        if (!tf.is_open()) {
            cerr << "[ERROR] Cannot open trace file: " << trace_path << "\n";
            exit(1);
        }
        string pc;
        while (getline(tf, pc)) {
            if (!pc.empty() && pc.back() == '\r') pc.pop_back();
            if (!pc.empty()) full_trace.push_back(pc);
        }
    }
    void load_dictionary(const string& dict_path) {
        ifstream file(dict_path);
        if (!file.is_open()) {
            cerr << "[ERROR] Cannot open dictionary file: " << dict_path << "\n";
            exit(1);
        }
        string line;
        while (getline(file, line)) {
            stringstream ss(line);
            string pc_str, opcode, reads_str, writes_str, mem_str, size_str;
            getline(ss, pc_str,    '|');
            getline(ss, opcode,    '|');
            getline(ss, reads_str, '|');
            getline(ss, writes_str, '|');
            getline(ss, mem_str, '|');
            getline(ss, size_str);
            InstMetaData meta;
            meta.opcode = opcode;
            if (reads_str.size() > 2) {
                stringstream rss(reads_str.substr(2));
                string reg;
                while (getline(rss, reg, ','))
                    if (!reg.empty()) meta.read_regs.push_back(reg);
            }
            if (writes_str.size() > 2) {
                stringstream wss(writes_str.substr(2));
                string reg;
                while (getline(wss, reg, ','))
                    if (!reg.empty()) meta.write_regs.push_back(reg);
            }
            if (mem_str.size() >= 2 && mem_str.substr(0,2) == "M:") {
                string flags = mem_str.substr(2);
                meta.is_mem_read  = flags.find('R') != string::npos;
                meta.is_mem_write = flags.find('W') != string::npos;
            } else if (mem_str.size() >= 2 && mem_str.substr(0,2) == "S:") {
                meta.size = stoi(mem_str.substr(2));
                mem_str = "";
            }
            if (size_str.size() >= 2 && size_str.substr(0,2) == "S:") {
                meta.size = stoi(size_str.substr(2));
            }
            dictionary[pc_str] = meta;
        }
    }
    void run(int max_inst = 5000) {
        while ((trace_index < full_trace.size() || !instruction_window.empty()) && instructions_retired < max_inst) {
            current_cycle++;
            if (current_cycle > 200000) {
                cerr << "[DEADLOCK] Cycle 200000 reached! Pipeline stuck.\n";
                exit(1);
            }
            if (flush_penalty_timer > 0) flush_penalty_timer--;
            retire();
            execute();
            issue();
            fetch();
        }
        save_json();
    }
private:
    void retire() {
        while (!instruction_window.empty()) {
            DynInst& front = instruction_window.front();
            if (!front.is_finished) break;
            front.retire_cycle = current_cycle;
            instructions_retired++;
            record_instruction(front, false);
            instruction_window.pop_front();
        }
    }
    void execute() {
        for (auto it = instruction_window.begin(); it != instruction_window.end(); ++it) {
            auto& inst = *it;
            if (inst.issue_cycle == -1 || inst.is_finished) continue;
            if (current_cycle < inst.finish_cycle) continue;
            inst.is_finished = true;
            instructions_executed++;
            if (inst.is_branch && use_branch_prediction) {
                btb_update(inst.pc, inst.actual_next_pc, inst.actual_taken);
                bool mispredicted = false;
                if (inst.predicted_next_pc == "" || inst.predicted_next_pc == inst.fallthrough_pc) {
                    if (inst.actual_taken) mispredicted = true;
                } else {
                    if (inst.predicted_next_pc != inst.actual_next_pc) mispredicted = true;
                }
                if (mispredicted) {
                    flush_penalty_timer = 5;
                    for (auto jt = it + 1; jt != instruction_window.end(); ++jt) {
                        jt->is_speculative_waste = true;
                        jt->retire_cycle = current_cycle;
                        record_instruction(*jt, true);
                    }
                    instruction_window.erase(it + 1, instruction_window.end());
                    trace_index = inst.actual_trace_index;
                    stall_for_branch = false;
                    break;
                }
            }
            if (inst.is_branch && !use_branch_prediction) {
                stall_for_branch = false;
                trace_index = inst.actual_trace_index;
                for (auto jt = it + 1; jt != instruction_window.end(); ++jt) {
                    jt->is_speculative_waste = true;
                    jt->retire_cycle = current_cycle;
                    record_instruction(*jt, true);
                }
                instruction_window.erase(it + 1, instruction_window.end());
                break;
            }
        }
    }
    void issue() {
        int int_used = 0, fp_used = 0, mem_used = 0;
        for (auto& inst : instruction_window) {
            if (inst.issue_cycle != -1) continue;
            string op = inst.opcode;
            for (char& c : op) c = tolower(c);
            bool is_fp  = op.find("div")  != string::npos || op.find("sqrt") != string::npos ||
                          op.find("fadd") != string::npos || op.find("fsub") != string::npos ||
                          op.find("vadd") != string::npos || op.find("vsub") != string::npos;
            bool is_mem = op.find("mov")  != string::npos || op.find("push") != string::npos ||
                          op.find("pop")  != string::npos || op.find("lea")  != string::npos;
            bool is_ctrl= op.rfind("j", 0) == 0 || op.find("call") != string::npos ||
                          op.find("ret")   != string::npos || op.rfind("b", 0) == 0;
            bool is_int = !is_fp && !is_mem && !is_ctrl;
            if (is_int  && int_used >= INT_ALU) { if (!use_reorder) break; continue; }
            if (is_fp   && fp_used  >= FP_ALU)  { if (!use_reorder) break; continue; }
            if (is_mem  && mem_used >= MEM_ALU)  { if (!use_reorder) break; continue; }
            bool can_issue = true;
            for (const string& reg : inst.read_regs) {
                for (int wi = (int)instruction_window.size() - 1; wi >= 0; --wi) {
                    const auto& older = instruction_window[wi];
                    if (older.inst_id >= inst.inst_id) continue;
                    bool writes_this = false;
                    for (const string& wr : older.write_regs) {
                        if (wr == reg) { writes_this = true; break; }
                    }
                    if (writes_this) {
                        if (older.finish_cycle == -1 || older.finish_cycle > current_cycle) {
                            can_issue = false;
                            inst.stalled_on_reg     = reg;
                            inst.stalled_on_inst_id = older.inst_id;
                        } else if (older.finish_cycle == current_cycle && use_data_forwarding) {
                        } else if (older.finish_cycle == current_cycle && !use_data_forwarding) {
                            can_issue = false;
                        } else if (!use_data_forwarding) {
                            if (current_cycle < older.finish_cycle + 2) {
                                can_issue = false;
                            }
                        }
                        break;
                    }
                }
                if (!can_issue) break;
            }
            if (can_issue && inst.mem_is_load && !inst.memory_address.empty()) {
                for (int wi = (int)instruction_window.size() - 1; wi >= 0; --wi) {
                    const auto& older = instruction_window[wi];
                    if (older.inst_id >= inst.inst_id) continue;
                    if (!older.mem_is_store) continue;
                    if (older.memory_address == inst.memory_address) {
                        if (!older.is_finished) {
                            can_issue = false;
                            inst.is_mem_stalled = true;
                            inst.stalled_on_mem_addr = inst.memory_address;
                            inst.stalled_on_inst_id  = older.inst_id;
                        }
                        break;
                    }
                }
            }
            if (!use_reorder) {
                if (!can_issue) break;
            } else {
                if (!can_issue) continue;
            }
            if (use_data_forwarding) {
                for (const string& reg : inst.read_regs) {
                    for (int wi = (int)instruction_window.size() - 1; wi >= 0; --wi) {
                        const auto& older = instruction_window[wi];
                        if (older.inst_id >= inst.inst_id) continue;
                        bool writes_this = false;
                        for (const string& wr : older.write_regs) {
                            if (wr == reg) { writes_this = true; break; }
                        }
                        if (writes_this) {
                            if (older.finish_cycle == current_cycle) {
                                if (find(inst.forwarded_data_from_inst_ids.begin(), inst.forwarded_data_from_inst_ids.end(), older.inst_id) == inst.forwarded_data_from_inst_ids.end()) {
                                    inst.forwarded_data_from_inst_ids.push_back(older.inst_id);
                                }
                            }
                            break;
                        }
                    }
                }
            }
            if (is_int) int_used++;
            if (is_fp)  fp_used++;
            if (is_mem) mem_used++;
            inst.issue_cycle = current_cycle;
            int latency = get_execution_latency(inst.opcode);
            if (is_mem) {
                int r = rand() % 100;
                if (r < 90)      latency = 3;
                else if (r < 99) latency = 12;
                else             latency = 20;
            }
            inst.finish_cycle = current_cycle + latency;
        }
    }
    void fetch() {
        if (flush_penalty_timer > 0) return;
        if (!use_branch_prediction && stall_for_branch) return;
        if (!use_pipelining && !instruction_window.empty()) return;
        int fetched = 0;
        int current_fetch_width = use_pipelining ? FETCH_WIDTH : 1;
        while ((int)instruction_window.size() < WINDOW_SIZE &&
               fetched < current_fetch_width &&
               trace_index < full_trace.size())
        {
            string raw_line = full_trace[trace_index++];
            fetched++;
            string pc, mem_addr;
            bool trace_is_load = false, trace_is_store = false;
            size_t pipe_pos = raw_line.find('|');
            if (pipe_pos != string::npos) {
                pc = raw_line.substr(0, pipe_pos);
                string suffix = raw_line.substr(pipe_pos + 1);
                size_t colon = suffix.find(':');
                if (colon != string::npos) {
                    string type = suffix.substr(0, colon);
                    mem_addr    = suffix.substr(colon + 1);
                    if (type == "R")       trace_is_load  = true;
                    else if (type == "W")  trace_is_store = true;
                    else if (type == "RW") { trace_is_load = true; trace_is_store = true; }
                }
            } else {
                pc = raw_line;
            }
            DynInst inst;
            inst.inst_id        = next_inst_id++;
            inst.pc             = pc;
            inst.fetch_cycle    = current_cycle;
            inst.memory_address = mem_addr;
            inst.mem_is_load    = trace_is_load;
            inst.mem_is_store   = trace_is_store;
            if (dictionary.count(pc)) {
                const auto& meta = dictionary[pc];
                inst.opcode     = meta.opcode;
                inst.read_regs  = meta.read_regs;
                inst.write_regs = meta.write_regs;
                if (!trace_is_load && !trace_is_store) {
                    inst.mem_is_load  = meta.is_mem_read;
                    inst.mem_is_store = meta.is_mem_write;
                }
                string op = inst.opcode;
                for (char& c : op) c = tolower(c);
                bool is_branch_op = op.rfind("j", 0) == 0 ||
                                    op.find("call") != string::npos ||
                                    op.find("ret")  != string::npos ||
                                    op.rfind("b", 0) == 0;
                if (is_branch_op) {
                    inst.is_branch = true;
                    uint64_t pc_val = stoull(pc, nullptr, 16);
                    uint64_t ft_val = pc_val + meta.size;
                    stringstream ft_ss;
                    ft_ss << std::hex << ft_val;
                    inst.fallthrough_pc = ft_ss.str();
                    if (use_branch_prediction) {
                        inst.predicted_next_pc = btb_predict(pc, inst.fallthrough_pc);
                    }
                    if (trace_index < full_trace.size()) {
                        const string& next_raw = full_trace[trace_index];
                        size_t np = next_raw.find('|');
                        inst.actual_next_pc    = (np != string::npos) ? next_raw.substr(0, np) : next_raw;
                        inst.actual_trace_index = trace_index;
                        inst.actual_taken = (inst.actual_next_pc != inst.fallthrough_pc);
                    } else {
                        inst.actual_trace_index = full_trace.size();
                        inst.actual_taken = false;
                    }
                    if (!use_branch_prediction) {
                        stall_for_branch = true;
                        instruction_window.push_back(inst);
                        break;
                    }
                }
            }
            instruction_window.push_back(inst);
        }
    }
    void record_instruction(const DynInst& inst, bool is_waste) {
        json j;
        j["inst_id"]                      = inst.inst_id;
        j["pc"]                           = inst.pc;
        j["opcode"]                       = inst.opcode;
        j["fetch_cycle"]                  = inst.fetch_cycle;
        j["issue_cycle"]                  = inst.issue_cycle;
        j["finish_cycle"]                 = inst.finish_cycle;
        j["retire_cycle"]                 = inst.retire_cycle;
        j["is_speculative_waste"]         = is_waste;
        j["is_mem_stalled"]               = inst.is_mem_stalled;
        j["forwarded_data_from_inst_ids"] = inst.forwarded_data_from_inst_ids;
        j["stalled_on_reg"]               = inst.stalled_on_reg;
        j["stalled_on_inst_id"]           = inst.stalled_on_inst_id;
        j["stalled_on_mem_addr"]          = inst.stalled_on_mem_addr;
        j["is_branch"]                    = inst.is_branch;
        j["predicted_next_pc"]            = inst.predicted_next_pc;
        j["actual_next_pc"]               = inst.actual_next_pc;
        json_instructions.push_back(j);
    }
    void save_json() {
        json root;
        json dict_json;
        for (const auto& [pc, meta] : dictionary) {
            json entry;
            entry["opcode"] = meta.opcode;
            entry["reads"]  = meta.read_regs;
            entry["writes"] = meta.write_regs;
            dict_json[pc]   = entry;
        }
        int wasted = instructions_executed - instructions_retired;
        double ilp = current_cycle > 0
                     ? (double)instructions_retired / current_cycle
                     : 0.0;
        root["global_stats"] = {
            {"total_cycles",       current_cycle},
            {"actual_retired",     instructions_retired},
            {"total_executed",     instructions_executed},
            {"wasted_speculative", wasted},
            {"final_ilp",          ilp},
            {"config", {
                {"pipelining",         use_pipelining},
                {"forwarding",         use_data_forwarding},
                {"reorder",            use_reorder},
                {"branch_prediction",  use_branch_prediction}
            }}
        };
        root["dictionary"]    = dict_json;
        root["instructions"]  = json_instructions;
        ofstream out(json_out_path);
        if (!out.is_open()) {
            cerr << "[ERROR] Cannot write output file: " << json_out_path << "\n";
            return;
        }
        out << root.dump(2);
        cerr << "[INFO] Simulation complete. "
             << instructions_retired << " retired, "
             << instructions_executed - instructions_retired << " wasted, "
             << current_cycle << " cycles. ILP=" << ilp << "\n";
    }
    int get_execution_latency(const string& opcode) {
        string op = opcode;
        for (char& c : op) c = tolower(c);
        if (op.find("div")  != string::npos || op.find("sqrt") != string::npos) return 15;
        if (op.find("imul") != string::npos || op.find("mul")  != string::npos) return 3;
        if (op.find("fadd") != string::npos || op.find("fsub") != string::npos ||
            op.find("vadd") != string::npos || op.find("vsub") != string::npos) return 4;
        if (op.find("mov")  != string::npos || op.find("push") != string::npos ||
            op.find("pop")  != string::npos || op.find("lea")  != string::npos) return 3;
        if (op.rfind("j",0)==0 || op.find("call") != string::npos ||
            op.find("ret")  != string::npos || op.find("cmp")  != string::npos ||
            op.find("test") != string::npos || op.rfind("b",0)==0) return 1;
        return 1;
    }
};
int main(int argc, char* argv[]) {
    srand(time(NULL));
    string trace    = get_arg(argc, argv, "trace",      "../trace.txt");
    string dict     = get_arg(argc, argv, "dict",       "../dictionary.txt");
    string out      = get_arg(argc, argv, "json_out",   "result.json");
    bool pipelining = get_arg(argc, argv, "pipelining", "1") != "0";
    bool forwarding = get_arg(argc, argv, "forwarding", "1") != "0";
    bool reorder    = get_arg(argc, argv, "reorder",    "1") != "0";
    bool bp         = get_arg(argc, argv, "bp",         "1") != "0";
    int max_inst    = stoi(get_arg(argc, argv, "max_inst", "5000"));
    ILPSimulator sim(trace, dict, pipelining, forwarding, reorder, bp, out);
    sim.run(max_inst);
    return 0;
}