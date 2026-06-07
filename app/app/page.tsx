"use client";

import { useEffect, useState } from "react";

interface Node {
  id: number;
  lat: number;
  lon: number;
  street_count: number;
}

interface GraphData {
  location: string;
  network_type: string;
  num_nodes: number;
  num_edges: number;
  avg_street_count: number;
  street_counts: Record<string, number>;
  center: { lat: number; lon: number };
  nodes: Node[];
}

export default function Home() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [minStreets, setMinStreets] = useState<number | "">("");

  useEffect(() => {
    fetch("/graph_data.json")
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

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"></div>
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

  // Filter nodes based on search & street count
  const filteredNodes = data.nodes.filter((node) => {
    const matchesSearch = node.id.toString().includes(search) || 
                          node.lat.toFixed(5).includes(search) || 
                          node.lon.toFixed(5).includes(search);
    const matchesStreets = minStreets === "" || node.street_count >= minStreets;
    return matchesSearch && matchesStreets;
  });

  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar: Diagnostics & Analytics */}
      <aside className="w-96 border-r border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex flex-col h-full shrink-0">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-blue-500 animate-pulse"></span>
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">GIS Core Map Viewer</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{data.location}</h1>
          <p className="text-xs text-zinc-500 font-mono">Network Type: {data.network_type}</p>
        </div>

        {/* Stats */}
        <div className="p-6 border-b border-zinc-800 grid grid-cols-2 gap-4">
          <div className="bg-zinc-950/40 border border-zinc-800/60 p-4 rounded-xl">
            <p className="text-xs text-zinc-500 font-medium uppercase">Intersections</p>
            <p className="text-2xl font-bold text-white mt-1">{data.num_nodes.toLocaleString()}</p>
          </div>
          <div className="bg-zinc-950/40 border border-zinc-800/60 p-4 rounded-xl">
            <p className="text-xs text-zinc-500 font-medium uppercase">Road Segments</p>
            <p className="text-2xl font-bold text-white mt-1">{data.num_edges.toLocaleString()}</p>
          </div>
          <div className="bg-zinc-950/40 border border-zinc-800/60 p-4 rounded-xl col-span-2 flex justify-between items-center">
            <div>
              <p className="text-xs text-zinc-500 font-medium uppercase">Junction Complexity</p>
              <p className="text-lg font-bold text-blue-400 mt-0.5">{data.avg_street_count} roads/node</p>
            </div>
            {/* Visual indicator of complexity */}
            <div className="w-16 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className="bg-blue-500 h-full rounded-full" 
                style={{ width: `${Math.min((data.avg_street_count / 4) * 100, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Junction Type Breakdown */}
        <div className="p-6 border-b border-zinc-800 flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Junction Breakdown</h3>
          <div className="flex flex-col gap-2.5">
            {Object.entries(data.street_counts)
              .sort((a, b) => Number(b[0]) - Number(a[0]))
              .map(([roads, count]) => {
                const percentage = ((count / data.num_nodes) * 100).toFixed(1);
                return (
                  <div key={roads} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-zinc-300">{roads}-way Intersection</span>
                      <span className="text-zinc-500">{count} ({percentage}%)</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-950/80 rounded-full overflow-hidden">
                      <div 
                        className="bg-emerald-500 h-full rounded-full" 
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Node Explorer */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-zinc-800 flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Node Explorer</h3>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search by ID / Lat / Lon..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500 placeholder-zinc-600"
              />
              <select
                value={minStreets}
                onChange={(e) => setMinStreets(e.target.value === "" ? "" : Number(e.target.value))}
                className="text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
              >
                <option value="">All</option>
                <option value="3">3+ ways</option>
                <option value="4">4+ ways</option>
                <option value="5">5+ ways</option>
              </select>
            </div>
          </div>

          {/* Node List */}
          <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-zinc-800/40">
            {filteredNodes.slice(0, 100).map((node) => (
              <div key={node.id} className="py-2.5 flex items-center justify-between text-xs hover:bg-zinc-800/20 px-2 rounded-lg transition-colors">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-zinc-400 font-semibold">{node.id}</span>
                  <span className="text-zinc-500 font-mono">{node.lat.toFixed(5)}, {node.lon.toFixed(5)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    node.street_count >= 4 
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20' 
                      : node.street_count === 3 
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {node.street_count}-way
                  </span>
                </div>
              </div>
            ))}
            {filteredNodes.length === 0 && (
              <div className="text-center text-zinc-600 text-sm py-8">No matching nodes found.</div>
            )}
            {filteredNodes.length > 100 && (
              <div className="text-center text-zinc-500 text-[10px] py-2">Showing top 100 of {filteredNodes.length} nodes</div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Map Viewport */}
      <main className="flex-1 h-full relative bg-zinc-950">
        <iframe
          src="/map.html"
          className="w-full h-full border-none"
          title="Interactive Map"
        />
        {/* Floating coordinate/map overlay control */}
        <div className="absolute bottom-4 right-4 bg-zinc-900/90 border border-zinc-800 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-zinc-500">Center:</span>{' '}
            <span className="text-zinc-300">{data.center.lat.toFixed(5)}, {data.center.lon.toFixed(5)}</span>
          </div>
          <div className="h-4 w-px bg-zinc-800"></div>
          <div>
            <span className="text-zinc-500">Zoom:</span>{' '}
            <span className="text-emerald-400">Active (Canvas-Optimized)</span>
          </div>
        </div>
      </main>
    </div>
  );
}
