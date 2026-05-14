"""
FastAPI Backend — ILP Simulator Web Application
Orchestrates: C++ compile → PIN trace extraction → addr2line mapping → Simulator JSON
"""

import json
import os
import subprocess
import tempfile
import shutil
import traceback
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ilp_backend")


SCRIPT_DIR  = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent.resolve()
SIM_BIN     = PROJECT_DIR / "sim"


PIN_ROOT_ENV = os.environ.get("PIN_ROOT")
if PIN_ROOT_ENV:
    PIN_ROOT = Path(PIN_ROOT_ENV)
else:
    PIN_ROOT = PROJECT_DIR / "pin"

PIN_BIN     = PIN_ROOT / "pin"


_TOOL_CANDIDATES = [
    PROJECT_DIR / "obj-intel64" / "ilp_extract.so",
    PROJECT_DIR / "ilp_extract.so",
    PIN_ROOT / "source" / "tools" / "ManualExamples" / "obj-intel64" / "ilp_extract.so",
]
PIN_TOOL = next((p for p in _TOOL_CANDIDATES if p.exists()), None)

log.info(f"PROJECT_DIR : {PROJECT_DIR}")
log.info(f"SIM_BIN     : {SIM_BIN}  (exists={SIM_BIN.exists()})")
log.info(f"PIN_BIN     : {PIN_BIN}  (exists={PIN_BIN.exists()})")
log.info(f"PIN_TOOL    : {PIN_TOOL}")


app = FastAPI(title="ILP Visor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SimulateRequest(BaseModel):
    code: str
    pipelining: bool = True
    forwarding: bool = True
    reorder: bool = True
    branch_prediction: bool = True


@app.post("/simulate")
async def simulate(req: SimulateRequest):
    saved_traces_dir = PROJECT_DIR / "saved_traces"
    saved_traces_dir.mkdir(exist_ok=True)
    req_num = 1
    while (saved_traces_dir / f"req_{req_num}").exists():
        req_num += 1
    work_dir = saved_traces_dir / f"req_{req_num}"
    work_dir.mkdir()
    log.info(f"Work dir: {work_dir}")
    try:
        src_path = work_dir / "main.cpp"
        src_path.write_text(req.code)

        binary = work_dir / "target"
        compile_result = subprocess.run(
            ["g++", "-g", "-O0", "-no-pie", str(src_path), "-o", str(binary)],
            capture_output=True, text=True, timeout=30
        )
        log.info(f"Compile exit={compile_result.returncode}")
        if compile_result.returncode != 0:
            raise HTTPException(status_code=400, detail={
                "stage": "compilation",
                "error": compile_result.stderr,
                "stdout": compile_result.stdout,
            })

        trace_path = work_dir / "trace.txt"
        dict_path  = work_dir / "dictionary.txt"

        if not PIN_BIN.exists():
            raise HTTPException(status_code=500, detail={
                "stage": "pin_extraction",
                "error": f"PIN binary not found at {PIN_BIN}. "
                         f"Please check your PIN installation path in backend/main.py"
            })

        if PIN_TOOL is None:
            raise HTTPException(status_code=500, detail={
                "stage": "pin_extraction",
                "error": f"ilp_extract.so not found. Searched: {[str(p) for p in _TOOL_CANDIDATES]}. "
                         f"Build your PIN tool first with 'make' in the ManualExamples directory."
            })

        pin_result = subprocess.run(
            [
                str(PIN_BIN), "-t", str(PIN_TOOL),
                "--", str(binary)
            ],
            capture_output=True, text=True,
            cwd=str(work_dir), timeout=60
        )
        log.info(f"PIN exit={pin_result.returncode}, trace_exists={trace_path.exists()}")
        if pin_result.returncode != 0 or not trace_path.exists():
            raise HTTPException(status_code=500, detail={
                "stage": "pin_extraction",
                "error": pin_result.stderr or "PIN tool produced no trace file.",
                "stdout": pin_result.stdout,
            })

        source_map = {}
        if dict_path.exists():
            pcs = set()
            for line in dict_path.read_text().splitlines():
                parts = line.split("|")
                if parts:
                    pcs.add(parts[0].strip())

            if pcs:
                addr2line_result = subprocess.run(
                    ["addr2line", "-e", str(binary), "-f"] + list(pcs),
                    capture_output=True, text=True, timeout=10
                )
                lines_out = addr2line_result.stdout.splitlines()
                for i, pc in enumerate(list(pcs)):
                    if i * 2 + 1 < len(lines_out):
                        loc = lines_out[i * 2 + 1]
                        if ":" in loc:
                            file_part, line_part = loc.rsplit(":", 1)
                            try:
                                source_map[pc] = {
                                    "file": Path(file_part).name,
                                    "line": int(line_part)
                                }
                            except ValueError:
                                pass

        if not SIM_BIN.exists():
            raise HTTPException(status_code=500, detail={
                "stage": "simulation",
                "error": f"Simulator binary not found at {SIM_BIN}. "
                         f"Build it with: g++ -O3 -std=c++17 Simulator.cpp -o sim"
            })

        result_json_path = work_dir / "result.json"
        sim_result = subprocess.run(
            [
                str(SIM_BIN),
                f"--trace={trace_path}",
                f"--dict={dict_path}",
                f"--json_out={result_json_path}",
                f"--pipelining={'1' if req.pipelining else '0'}",
                f"--forwarding={'1' if req.forwarding else '0'}",
                f"--reorder={'1' if req.reorder else '0'}",
                f"--bp={'1' if req.branch_prediction else '0'}",
            ],
            capture_output=True, text=True, timeout=300
        )
        log.info(f"Sim exit={sim_result.returncode}, result_exists={result_json_path.exists()}")
        log.info(f"Sim stderr: {sim_result.stderr[:500]}")

        if not result_json_path.exists():
            raise HTTPException(status_code=500, detail={
                "stage": "simulation",
                "error": sim_result.stderr or "Simulator produced no result.json",
                "stdout": sim_result.stdout,
            })

        sim_data = json.loads(result_json_path.read_text())

        return {
            "source_code": req.code,
            "source_map":  source_map,
            "simulation":  sim_data,
            "sim_log":     sim_result.stderr,
        }

    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        log.error(f"Unhandled exception:\n{tb}")
        raise HTTPException(status_code=500, detail={
            "stage": "internal",
            "error": str(e),
            "traceback": tb,
        })
    finally:
        pass

@app.post("/compare")
async def compare(req: SimulateRequest):
    saved_traces_dir = PROJECT_DIR / "saved_traces"
    saved_traces_dir.mkdir(exist_ok=True)
    req_num = 1
    while (saved_traces_dir / f"compare_req_{req_num}").exists():
        req_num += 1
    work_dir = saved_traces_dir / f"compare_req_{req_num}"
    work_dir.mkdir()
    try:
        src_path = work_dir / "main.cpp"
        src_path.write_text(req.code)

        binary = work_dir / "target"
        compile_result = subprocess.run(
            ["g++", "-g", "-O0", "-no-pie", str(src_path), "-o", str(binary)],
            capture_output=True, text=True, timeout=30
        )
        if compile_result.returncode != 0:
            raise HTTPException(status_code=400, detail={
                "stage": "compilation",
                "error": compile_result.stderr,
                "stdout": compile_result.stdout,
            })

        trace_path = work_dir / "trace.txt"
        dict_path  = work_dir / "dictionary.txt"

        if not PIN_BIN.exists() or PIN_TOOL is None:
            raise HTTPException(status_code=500, detail={"stage": "pin_extraction", "error": "PIN binary or tool not found."})

        pin_result = subprocess.run(
            [str(PIN_BIN), "-t", str(PIN_TOOL), "--", str(binary)],
            capture_output=True, text=True, cwd=str(work_dir), timeout=60
        )
        if pin_result.returncode != 0 or not trace_path.exists():
            raise HTTPException(status_code=500, detail={"stage": "pin_extraction", "error": pin_result.stderr})

        configs = [
            {"name": "Strict Non-Pipelined",   "pipelining": False, "fwd": False, "ooo": False, "bp": False},
            {"name": "Base Pipelined",         "pipelining": True,  "fwd": False, "ooo": False, "bp": False},
            {"name": "Pipelined + Forwarding", "pipelining": True,  "fwd": True,  "ooo": False, "bp": False},
            {"name": "Pipelined + OoOE",       "pipelining": True,  "fwd": False, "ooo": True,  "bp": False},
            {"name": "Fully Optimized",        "pipelining": True,  "fwd": True,  "ooo": True,  "bp": True},
        ]

        results = []
        for cfg in configs:
            result_json_path = work_dir / f"result_{cfg['name'].replace(' ', '_')}.json"
            subprocess.run(
                [
                    str(SIM_BIN),
                    f"--trace={trace_path}",
                    f"--dict={dict_path}",
                    f"--json_out={result_json_path}",
                    f"--pipelining={'1' if cfg['pipelining'] else '0'}",
                    f"--forwarding={'1' if cfg['fwd'] else '0'}",
                    f"--reorder={'1' if cfg['ooo'] else '0'}",
                    f"--bp={'1' if cfg['bp'] else '0'}",
                ],
                capture_output=True, text=True, timeout=300
            )
            if result_json_path.exists():
                data = json.loads(result_json_path.read_text())
                stats = data.get("global_stats", {})
                results.append({
                    "name": cfg["name"],
                    "ilp": stats.get("final_ilp", 0),
                    "cycles": stats.get("total_cycles", 0)
                })

        return results

    except HTTPException:
        raise
    except Exception as e:
        tb = traceback.format_exc()
        raise HTTPException(status_code=500, detail={"stage": "internal", "error": str(e), "traceback": tb})


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "sim_binary":   SIM_BIN.exists(),
        "pin_binary":   PIN_BIN.exists(),
        "pin_tool":     str(PIN_TOOL) if PIN_TOOL else None,
        "project_dir":  str(PROJECT_DIR),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)