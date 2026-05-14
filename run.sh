#!/bin/bash

echo "=========================================="
echo "🚀 Starting ArchScope Servers"
echo "=========================================="

# 1. Start the Python Backend in the background
echo "🐍 Starting Backend (Port 8000)..."
cd backend
source venv/bin/activate
python main.py &
BACKEND_PID=$!
cd ..

# 2. Start the Next.js Frontend in the background
echo "🌐 Starting Frontend (Port 3000)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "=========================================="
echo "✅ Both servers are starting up!"
echo "➡️  Dashboard will be available at: http://localhost:3000"
echo "🛑 Press Ctrl+C to stop both servers."
echo "=========================================="

# Trap Ctrl+C (SIGINT) to elegantly kill both processes
trap "echo 'Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit" SIGINT SIGTERM

# Wait for both background processes to keep the script running
wait
