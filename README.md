# 🗺️ GMap Router

GMap Router is an interactive shortest-path routing application that allows you to load road networks for different cities worldwide (powered by OSMnx/OpenStreetMap), visualize them, and instantly calculate shortest paths using Dijkstra's algorithm.

The application uses a modern, high-performance architecture:
- **Backend:** FastAPI (Python) fetches map data, builds graph representations, exposes lightweight APIs, and runs large network downloads in the background so connections never drop.
- **Frontend:** Next.js (React/TypeScript) provides a buttery smooth user interface, proxies API requests to the backend, and handles interactive Leaflet map integration without locking up your browser.

---

## 🚀 How to Run Locally (Manual Setup)

If you prefer to run the raw processes on your own machine without containerization, follow these steps.

### Prerequisites
- Python 3.10+
- Node.js 20+
- `uv` (The fast Python package installer)

### 1. Start the Backend
Open your first terminal and run the following commands:
```bash
# Navigate to the project root
cd gmaps

# Install Python dependencies (creates a virtual environment and installs everything)
uv sync

# Run the FastAPI server with auto-reload (skipping front-end & cache folders)
uv run uvicorn main:app --reload --reload-include "*.py" --reload-exclude ".venv" --reload-exclude "app" --reload-exclude "cache" --reload-exclude ".git" --port 8000
```
> **Note:** On first startup, the backend downloads the road network for Verona. Wait until you see `Application startup complete.` in your terminal (about 15–30 seconds) before proceeding.

### 2. Start the Frontend
Open a second terminal and run:
```bash
# Navigate to the Next.js app directory
cd gmaps/app

# Install frontend dependencies
npm install

# Start the Next.js development server
npm run dev
```

### 3. Use the App
- Open your browser to [http://localhost:3000](http://localhost:3000)
- You can click on the map to set a Source and Destination.
- To switch cities, use the search bar on the left (e.g. type `Rome, Italy` and click Go). The app handles massive city downloads asynchronously, so you'll see a smooth loading screen while the backend processes the map data!

---

## 🐳 How to Run with Docker

To easily run both the frontend and backend without managing Node or Python environments yourself, use Docker Compose.

### Prerequisites
- Docker (Ensure Docker Desktop daemon is actually running!)
- Docker Compose

### 1. Start the Application

From the root `gmaps` directory, simply run:

```bash
docker-compose up --build
```

This single command will:
1. Build the Python FastAPI backend image and install `uv` dependencies.
2. Build the Next.js frontend image and statically analyze the API proxy config.
3. Start both services on a shared internal Docker network.
4. Mount the local `./cache` folder as a volume, so if you restart the server you don't have to redownload city maps from OpenStreetMap.

### 2. Use the App

Once the terminal output settles and both services are listening, go to:
- [http://localhost:3000](http://localhost:3000)

### 3. Stopping and Cleaning Up

To stop the application gracefully, press `Ctrl+C` in your terminal. 

If you ever need to completely wipe the Docker images and start totally fresh (for instance, after making a big configuration change), run:
```bash
docker-compose down --rmi all -v
docker-compose up --build --force-recreate
```
