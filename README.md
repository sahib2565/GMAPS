# GMap Router

GMap Router is an interactive shortest-path routing application that lets you load road networks for any city worldwide (powered by OSMnx/OpenStreetMap), visualize them, and watch Dijkstra's algorithm explore the graph in real time before revealing the shortest path.

**Architecture:**
- **Backend:** FastAPI (Python) — fetches OSM road data, builds the graph, runs a custom Dijkstra implementation, and exposes a lightweight REST API. City downloads happen in the background so the server never drops.
- **Frontend:** Next.js 16 (React/TypeScript) — dark-themed UI with a sidebar for routing controls and an embedded Leaflet map served as an HTML iframe.

---

## Features

- Click anywhere on the map to set source and destination nodes
- Watch Dijkstra's algorithm **explore nodes in real time** (amber dots spreading across the road network) before the shortest path is highlighted in red
- Switch cities on the fly — type any place name and the backend downloads the new graph asynchronously while the UI stays responsive
- Node explorer with search and street-count filtering

---

## Run Locally

### Prerequisites

- Python **3.11+**
- Node.js 20+
- [`uv`](https://github.com/astral-sh/uv) — fast Python package manager

### 1. Start the Backend

```bash
# From the project root
cd gmaps

# Install Python dependencies
uv sync

# Start the FastAPI server
uv run uvicorn main:app --port 8000
```

> On first startup the backend downloads the Verona road network (~15–30 seconds). Wait for `Application startup complete.` before opening the app.

If `uv sync` fails due to a Python version conflict, run the server directly through the virtual environment instead:

```bash
# After uv has already created the .venv once
.venv/bin/uvicorn main:app --port 8000
```

### 2. Start the Frontend

```bash
# In a second terminal
cd gmaps/app

npm install
npm run dev
```

### 3. Open the App

Go to [http://localhost:3000](http://localhost:3000)

**Usage:**
1. The map loads centred on Verona. Click any two points to set a **source** (green) and **destination** (red), or use the node list in the sidebar.
2. Dijkstra's exploration animates as amber dots — watch the algorithm fan out from the source.
3. Once exploration finishes, the shortest path draws as a red polyline and the distance appears in the sidebar.
4. To switch cities, type a place name in the **Search Location** box (e.g. `Rome, Italy`) and click **Go**.

---

## Run with Docker

The easiest way to run both services together without managing Python or Node environments yourself.

### Prerequisites

- Docker Desktop (make sure the daemon is running)

### Start

```bash
# From the project root
docker-compose up --build
```

This will:
1. Build the Python backend image and install all dependencies via `uv`.
2. Build the Next.js frontend image, configure the API proxy, and produce a production build.
3. Start both services on a shared internal network.
4. Mount `./cache` as a volume so downloaded city graphs survive container restarts.

Then open [http://localhost:3000](http://localhost:3000).

### Stop

```bash
# Ctrl+C to stop, or:
docker-compose down
```

### Full clean rebuild

```bash
docker-compose down --rmi all -v
docker-compose up --build --force-recreate
```

---

## Project Structure

```
gmaps/
├── main.py              # FastAPI backend — graph loading, Dijkstra, REST API
├── Dockerfile           # Backend container
├── docker-compose.yml   # Orchestrates backend + frontend
├── pyproject.toml       # Python dependencies
├── cache/               # Downloaded OSMnx city graphs (auto-created)
└── app/                 # Next.js frontend
    ├── app/
    │   ├── page.tsx     # Main UI — routing controls, node explorer, map iframe
    │   └── layout.tsx
    ├── next.config.ts   # Rewrites /api/* → FastAPI backend
    └── Dockerfile       # Frontend container
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GMAPS_DEFAULT_LOCATION` | `Verona, Veneto, Italy` | City loaded on backend startup |
| `GMAPS_NETWORK_TYPE` | `drive` | OSMnx network type (`drive`, `walk`, `bike`) |
| `API_URL` | `http://localhost:8000` | Backend URL used by the Next.js proxy |
