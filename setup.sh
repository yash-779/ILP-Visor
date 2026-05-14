#!/bin/bash
set -e

echo "=========================================="
echo "🚀 Starting ArchScope Setup"
echo "=========================================="

# 1. Download and Extract Intel Pin Tool
PIN_VERSION="3.28-98749-g6643ecee5"
PIN_TAR="pin-${PIN_VERSION}-gcc-linux.tar.gz"
PIN_URL="https://software.intel.com/sites/landingpage/pintool/downloads/${PIN_TAR}"

if [ ! -d "pin" ]; then
    echo "⬇️ Downloading Intel Pin Tool..."
    wget -qO pin.tar.gz "$PIN_URL"
    echo "📦 Extracting Pin Tool..."
    tar -xf pin.tar.gz
    mv "pin-${PIN_VERSION}-gcc-linux" pin
    rm pin.tar.gz
    echo "✅ Pin Tool installed."
else
    echo "✅ Pin Tool already exists."
fi

export PIN_ROOT="$(pwd)/pin"

# 2. Compile the Pin Tool (ilp_extract.cpp)
echo "🔨 Compiling Pin Instrumentation Tool..."
# Copy the tool to Pin's ManualExamples directory to use their Makefile structure safely
cp ilp_extract.cpp pin/source/tools/ManualExamples/
cd pin/source/tools/ManualExamples/
mkdir -p obj-intel64
make obj-intel64/ilp_extract.so
cd ../../../../
# Copy the compiled tool back to the root directory
cp pin/source/tools/ManualExamples/obj-intel64/ilp_extract.so ./
echo "✅ Pin Tool compiled."

# 3. Compile the Simulator
echo "🔨 Compiling Simulator..."
g++ -O3 -std=c++17 Simulator.cpp -o sim
echo "✅ Simulator compiled."

# 4. Setup Python Backend
echo "🐍 Setting up Python Backend..."
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
echo "✅ Backend setup complete."

# 5. Setup Frontend
echo "🌐 Setting up Next.js Frontend..."
cd frontend
npm install
cd ..
echo "✅ Frontend setup complete."

echo "=========================================="
echo "🎉 Setup Complete!"
echo ""
echo "To run the application:"
echo "1. Start Backend: cd backend && source venv/bin/activate && python main.py"
echo "2. Start Frontend: cd frontend && npm run dev"
echo "=========================================="
