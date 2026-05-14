#include "pin.H"
#include <iostream>
#include <fstream>
#include <map>
#include <vector>
#include <string>
#include <set>
using namespace std;
struct InstMetaData {
    string mnemonic;
    vector<REG> readRegs;
    vector<REG> writeRegs;
    bool readsMemory;
    bool writesMemory;
    UINT32 size;
};
map<ADDRINT, InstMetaData> staticInstMap;
ofstream traceFile;
ofstream dictFile;
set<ADDRINT> mainPCs;
VOID LogNoMem(ADDRINT pc)
{
    traceFile << std::hex << pc << "\n";
}
VOID LogMemRead(ADDRINT pc, ADDRINT addr)
{
    traceFile << std::hex << pc << "|R:" << addr << "\n";
}
VOID LogMemWrite(ADDRINT pc, ADDRINT addr)
{
    traceFile << std::hex << pc << "|W:" << addr << "\n";
}
VOID LogMemReadWrite(ADDRINT pc, ADDRINT rAddr, ADDRINT wAddr)
{
    traceFile << std::hex << pc << "|RW:" << rAddr << "\n";
}
VOID Routine(RTN rtn, VOID *v)
{
    if (RTN_Name(rtn) != "main") return;
    RTN_Open(rtn);
    for (INS ins = RTN_InsHead(rtn); INS_Valid(ins); ins = INS_Next(ins)) {
        ADDRINT pc = INS_Address(ins);
        mainPCs.insert(pc);
        if (staticInstMap.find(pc) == staticInstMap.end()) {
            InstMetaData meta;
            meta.mnemonic = INS_Mnemonic(ins);
            meta.readsMemory  = INS_IsMemoryRead(ins);
            meta.writesMemory = INS_IsMemoryWrite(ins);
            meta.size         = INS_Size(ins);
            UINT32 numOperands = INS_OperandCount(ins);
            for (UINT32 i = 0; i < numOperands; ++i) {
                if (INS_OperandIsReg(ins, i)) {
                    REG reg = INS_OperandReg(ins, i);
                    if (INS_OperandRead(ins, i)) meta.readRegs.push_back(reg);
                    if (INS_OperandWritten(ins, i)) meta.writeRegs.push_back(reg);
                }
            }
            staticInstMap[pc] = meta;
        }
        bool reads  = INS_IsMemoryRead(ins);
        bool writes = INS_IsMemoryWrite(ins);
        if (reads && writes) {
            INS_InsertCall(ins, IPOINT_BEFORE, (AFUNPTR)LogMemReadWrite,
                           IARG_INST_PTR,
                           IARG_MEMORYREAD_EA,
                           IARG_MEMORYWRITE_EA,
                           IARG_END);
        } else if (reads) {
            INS_InsertCall(ins, IPOINT_BEFORE, (AFUNPTR)LogMemRead,
                           IARG_INST_PTR,
                           IARG_MEMORYREAD_EA,
                           IARG_END);
        } else if (writes) {
            INS_InsertCall(ins, IPOINT_BEFORE, (AFUNPTR)LogMemWrite,
                           IARG_INST_PTR,
                           IARG_MEMORYWRITE_EA,
                           IARG_END);
        } else {
            INS_InsertCall(ins, IPOINT_BEFORE, (AFUNPTR)LogNoMem,
                           IARG_INST_PTR,
                           IARG_END);
        }
    }
    RTN_Close(rtn);
}
VOID Fini(INT32 code, VOID *v)
{
    traceFile.close();
    dictFile.open("dictionary.txt");
    for (auto const& [pc, meta] : staticInstMap) {
        dictFile << std::hex << pc << "|" << meta.mnemonic << "|R:";
        for (REG r : meta.readRegs) dictFile << REG_StringShort(r) << ",";
        dictFile << "|W:";
        for (REG w : meta.writeRegs) dictFile << REG_StringShort(w) << ",";
        dictFile << "|M:";
        if (meta.readsMemory)  dictFile << "R";
        if (meta.writesMemory) dictFile << "W";
        dictFile << "|S:" << meta.size << "\n";
    }
    dictFile.close();
}
int main(int argc, char * argv[])
{
    PIN_InitSymbols();
    if (PIN_Init(argc, argv)) return -1;
    traceFile.open("trace.txt");
    RTN_AddInstrumentFunction(Routine, 0);
    PIN_AddFiniFunction(Fini, 0);
    PIN_StartProgram();
    return 0;
}