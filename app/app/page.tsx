"use client";

import { useEffect, useState } from "react";

interface Node {
  id: number;
  lat: number;
  lon: number;
  street_count: number;
}

interface Edge {
  target: string;
  weight: number;
  coords: [number, number][];
}

type AdjacencyList = Record<string, Edge[]>;

interface GraphData {
  location: string;
  network_type: string;
  num_nodes: number;
  num_edges: number;
  avg_street_count: number;
  street_counts: Record<string, number>;
  center: { lat: number; lon: number };
  nodes: Node[];
  adjacency: AdjacencyList;
}

// A simple MinHeap implementation for Dijkstra's Priority Queue
class MinHeap {
  elements: { id: string; priority: number }[] = [];
  
  push(element: { id: string; priority: number }) {
    this.elements.push(element);
    this.up(this.elements.length - 1);
  }
  
  pop() {
    if (this.elements.length === 0) return null;
    const top = this.elements[0];
    const bottom = this.elements.pop();
    if (this.elements.length > 0 && bottom) {
      this.elements[0] = bottom;
      this.down(0);
    }
    return top;
  }
  
  up(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.elements[index].priority >= this.elements[parent].priority) break;
      this.swap(index, parent);
      index = parent;
    }
  }
  
  down(index: number) {
    const len = this.elements.length;
    while (index * 2 + 1 < len) {
      let child = index * 2 + 1;
      if (child + 1 < len && this.elements[child + 1].priority < this.elements[child].priority) {
        child++;
      }
      if (this.elements[index].priority <= this.elements[child].priority) break;
      this.swap(index, child);
      index = child;
    }
  }
  
  swap(i: number, j: number) {
    const tmp = this.elements[i];
    this.elements[i] = this.elements[j];
    this.elements[j] = tmp;
  }
  
  isEmpty() {
    return this.elements.length === 0;
  }
}

// Client-side Dijkstra Shortest Path Router
function calculateShortestPath(
  adj: AdjacencyList,
  start: string,
  end: string
): { path: string[]; coords: [number, number][]; distance: number } | null {
  if (!adj) {
    console.error("Adjacency list is undefined!");
    return null;
  }
  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const edgeCoords: Record<string, [number, number][]> = {};
  const heap = new MinHeap();

  distances[start] = 0;
  previous[start] = null;
  heap.push({ id: start, priority: 0 });

  while (!heap.isEmpty()) {
    const item = heap.pop();
    if (!item) break;
    const u = item.id;
    const dist = item.priority;

    if (dist > distances[u]) continue;

    if (u === end) {
      const path: string[] = [];
      const coords: [number, number][] = [];
      let curr: string | null | undefined = end;
      const totalDistance = distances[end];

      while (curr) {
        path.push(curr);
        const prev = previous[curr];
        if (prev) {
          const edgeGeo = edgeCoords[`${prev}->${curr}`];
          if (edgeGeo) {
            // Prepend the segment coordinates to trace path from start to end
            coords.unshift(...edgeGeo);
          }
        }
        curr = prev;
      }
      return { path: path.reverse(), coords, distance: totalDistance };
    }

    const neighbors = adj[u] || [];
    for (const edge of neighbors) {
      const v = edge.target;
      const newDist = dist + edge.weight;
      if (distances[v] === undefined || newDist < distances[v]) {
        distances[v] = newDist;
        previous[v] = u;
        edgeCoords[`${u}->${v}`] = edge.coords;
        heap.push({ id: v, priority: newDist });
      }
    }
  }
  return null;
}

export default function Home() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [minStreets, setMinStreets] = useState<number | "">("");

  // Routing State
  const [sourceNode, setSourceNode] = useState<Node | null>(null);
  const [destNode, setDestNode] = useState<Node | null>(null);
  const [routingMode, setRoutingMode] = useState<"source" | "destination" | null>("source");
  const [calculatedRoute, setCalculatedRoute] = useState<{
    path: string[];
    coords: [number, number][];
    distance: number;
  } | null>(null);

  // Fetch the graph data on load
  useEffect(() => {
    fetch("/graph_data.json?t=" + Date.now())
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load map data");
        }
        return res.json();
      })
      .then((data: GraphData) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error loading graph data:", err);
        setLoading(false);
      });
  }, []);

  // Listen to MAP_CLICK messages from the iframe
  useEffect(() => {
    const handleMapClick = (event: MessageEvent) => {
      const msg = event.data;
      if (msg && msg.type === "MAP_CLICK") {
        console.log("NextJS received MAP_CLICK:", msg);
        onMapClicked(msg.lat, msg.lng);
      }
    };
    window.addEventListener("message", handleMapClick);
    return () => window.removeEventListener("message", handleMapClick);
  }, [data, routingMode, sourceNode, destNode]);

  // Sync route drawing with iframe whenever source or destination changes
  useEffect(() => {
    const iframe = document.getElementById("map-iframe") as HTMLIFrameElement | null;
    if (!iframe || !iframe.contentWindow) return;

    if (sourceNode && destNode && data) {
      const route = calculateShortestPath(
        data.adjacency,
        sourceNode.id.toString(),
        destNode.id.toString()
      );
      if (route) {
        iframe.contentWindow.postMessage(
          {
            type: "UPDATE_ROUTE",
            source: { lat: sourceNode.lat, lng: sourceNode.lon, id: sourceNode.id },
            destination: { lat: destNode.lat, lng: destNode.lon, id: destNode.id },
            routeCoords: route.coords,
          },
          "*"
        );
        setCalculatedRoute(route);
      } else {
        iframe.contentWindow.postMessage(
          {
            type: "UPDATE_ROUTE",
            source: { lat: sourceNode.lat, lng: sourceNode.lon, id: sourceNode.id },
            destination: { lat: destNode.lat, lng: destNode.lon, id: destNode.id },
            routeCoords: [],
          },
          "*"
        );
        setCalculatedRoute(null);
      }
    } else {
      iframe.contentWindow.postMessage(
        {
          type: "UPDATE_ROUTE",
          source: sourceNode
            ? { lat: sourceNode.lat, lng: sourceNode.lon, id: sourceNode.id }
            : null,
          destination: destNode
            ? { lat: destNode.lat, lng: destNode.lon, id: destNode.id }
            : null,
          routeCoords: [],
        },
        "*"
      );
      setCalculatedRoute(null);
    }
  }, [sourceNode, destNode, data]);

  const handleLocateNode = (node: Node) => {
    console.log("Locate button clicked for node:", node);
    const iframe = document.getElementById("map-iframe") as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      console.log("Sending LOCATE_NODE message to iframe", { lat: node.lat, lng: node.lon });
      iframe.contentWindow.postMessage(
        {
          type: "LOCATE_NODE",
          lat: node.lat,
          lng: node.lon,
        },
        "*"
      );
    } else {
      console.error("Iframe not found or not accessible!");
    }
  };

  // Handle map click by finding closest node
  const onMapClicked = (lat: number, lng: number) => {
    console.log("onMapClicked triggered with:", lat, lng);
    if (!data) {
        console.warn("No data available for click!");
        return;
    }

    let closestNode = data.nodes[0];
    let minDist = Infinity;
    for (const node of data.nodes) {
      const dist = Math.pow(node.lat - lat, 2) + Math.pow(node.lon - lng, 2);
      if (dist < minDist) {
        minDist = dist;
        closestNode = node;
      }
    }
    
    console.log("Closest node found:", closestNode);

    if (routingMode === "source") {
      setSourceNode(closestNode);
      setRoutingMode("destination");
    } else if (routingMode === "destination") {
      setDestNode(closestNode);
      setRoutingMode(null);
    } else {
      // Default to alternating
      if (!sourceNode) {
        setSourceNode(closestNode);
        setRoutingMode("destination");
      } else if (!destNode) {
        setDestNode(closestNode);
        setRoutingMode(null);
      } else {
        setSourceNode(closestNode);
        setDestNode(null);
        setRoutingMode("destination");
      }
    }
  };

  const handleReset = () => {
    setSourceNode(null);
    setDestNode(null);
    setCalculatedRoute(null);
    setRoutingMode("source");
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
          <p className="text-zinc-400 animate-pulse">Loading GIS Data...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-white font-sans">
        <div className="text-center max-w-md p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl">
          <h2 className="text-xl font-bold text-red-400 mb-2">Data Not Found</h2>
          <p className="text-zinc-400 mb-4 text-sm">
            Could not load <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-red-300">graph_data.json</code>. Make sure to run your Python script first to generate the map files in the Next.js public directory!
          </p>
          <code className="block bg-zinc-950 p-3 rounded text-left text-xs font-mono text-zinc-300 overflow-x-auto select-all">
            uv run main.py
          </code>
        </div>
      </div>
    );
  }

  const filteredNodes = data.nodes.filter((node) => {
    const matchesSearch =
      node.id.toString().includes(search) ||
      node.lat.toFixed(5).includes(search) ||
      node.lon.toFixed(5).includes(search);
    const matchesStreets = minStreets === "" || node.street_count >= minStreets;
    return matchesSearch && matchesStreets;
  });

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar: Controls & Pathfinding */}
      <aside className="w-96 border-r border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex flex-col h-full shrink-0">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-indigo-500 animate-pulse"></span>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Interactive Path Routing
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{data.location}</h1>
          <p className="text-xs text-zinc-500 font-mono">Network Type: {data.network_type}</p>
        </div>

        {/* Path Planner Section */}
        <div className="p-6 border-b border-zinc-800 flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Route Planner
          </h3>
          
          <div className="flex flex-col gap-3">
            {/* Source Input */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Source Point (Green)</span>
              <div className="flex gap-2">
                <div className="flex-1 bg-zinc-950 border border-zinc-850 px-3 py-2 rounded-lg text-xs font-mono flex items-center justify-between text-zinc-300">
                  {sourceNode ? (
                    <span>ID: {sourceNode.id}</span>
                  ) : (
                    <span className="text-zinc-600 italic">Click map to set...</span>
                  )}
                </div>
                <button
                  onClick={() => setRoutingMode("source")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    routingMode === "source"
                      ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  Set
                </button>
              </div>
            </div>

            {/* Destination Input */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Destination Point (Red)</span>
              <div className="flex gap-2">
                <div className="flex-1 bg-zinc-950 border border-zinc-850 px-3 py-2 rounded-lg text-xs font-mono flex items-center justify-between text-zinc-300">
                  {destNode ? (
                    <span>ID: {destNode.id}</span>
                  ) : (
                    <span className="text-zinc-600 italic">Click map to set...</span>
                  )}
                </div>
                <button
                  onClick={() => setRoutingMode("destination")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    routingMode === "destination"
                      ? "bg-red-500 text-white shadow-lg shadow-red-500/20"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  Set
                </button>
              </div>
            </div>

            {/* Path Results */}
            {calculatedRoute && (
              <div className="bg-red-950/20 border border-red-500/25 p-4 rounded-xl flex flex-col gap-2 animate-fade-in">
                <span className="text-[10px] uppercase font-bold text-red-400">Route Found</span>
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-2xl font-bold text-white">
                      {(calculatedRoute.distance / 1000).toFixed(2)}
                    </span>
                    <span className="text-xs text-zinc-400 ml-1">km</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-zinc-300">
                      {calculatedRoute.path.length}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">Junctions</span>
                  </div>
                </div>
              </div>
            )}

            {/* Reset Button */}
            {(sourceNode || destNode) && (
              <button
                onClick={handleReset}
                className="w-full bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-750 text-xs font-semibold py-2 rounded-lg transition-colors text-zinc-400 hover:text-white"
              >
                Clear Route Selection
              </button>
            )}
          </div>
        </div>

        {/* Node Explorer */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-zinc-800 flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Intersections Explorer
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search ID / Coordinates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 placeholder-zinc-600 text-white"
              />
              <select
                value={minStreets}
                onChange={(e) =>
                  setMinStreets(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 text-zinc-400"
              >
                <option value="">All</option>
                <option value="3">3+ ways</option>
                <option value="4">4+ ways</option>
              </select>
            </div>
          </div>

          {/* Node List */}
          <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-zinc-800/40">
            {filteredNodes.slice(0, 50).map((node) => (
              <div
                key={node.id}
                className="py-2.5 flex items-center justify-between text-xs hover:bg-zinc-800/30 px-2 rounded-lg transition-colors"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-zinc-300 font-semibold">{node.id}</span>
                  <span className="text-zinc-500 font-mono text-[10px]">
                    {node.lat.toFixed(5)}, {node.lon.toFixed(5)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleLocateNode(node)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500 hover:text-white font-semibold transition-colors"
                  >
                    Locate
                  </button>
                  <button
                    onClick={() => setSourceNode(node)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500 hover:text-black font-semibold transition-colors"
                  >
                    Start
                  </button>
                  <button
                    onClick={() => setDestNode(node)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white font-semibold transition-colors"
                  >
                    End
                  </button>
                </div>
              </div>
            ))}
            {filteredNodes.length === 0 && (
              <div className="text-center text-zinc-600 text-sm py-8">No matching nodes found.</div>
            )}
            {filteredNodes.length > 50 && (
              <div className="text-center text-zinc-500 text-[10px] py-2">
                Showing top 50 of {filteredNodes.length} nodes
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Map Viewport */}
      <main className="flex-1 h-full relative bg-zinc-950">
        <iframe
          id="map-iframe"
          src="/map.html"
          className="w-full h-full border-none"
          title="Interactive Map"
        />
        {/* Floating coordinate/map overlay control */}
        <div className="absolute bottom-4 right-4 bg-zinc-900/90 border border-zinc-800 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-zinc-500">Center:</span>{" "}
            <span className="text-zinc-300">
              {data.center.lat.toFixed(5)}, {data.center.lon.toFixed(5)}
            </span>
          </div>
          <div className="h-4 w-px bg-zinc-800"></div>
          <div>
            <span className="text-zinc-500">Zoom Performance:</span>{" "}
            <span className="text-emerald-400">Canvas Optimized (Fast)</span>
          </div>
        </div>
      </main>
    </div>
  );
}
