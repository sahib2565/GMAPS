"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Node {
  id: number;
  lat: number;
  lon: number;
  street_count: number;
}

interface GraphInfo {
  location: string;
  loading_location?: string | null;
  network_type: string;
  num_nodes: number;
  num_edges: number;
  center: { lat: number; lon: number };
}

interface RouteResult {
  found: boolean;
  path: number[];
  coords: [number, number][];
  distance: number;
  junctions: number;
  visited_nodes?: { lat: number; lng: number }[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchGraphInfo(): Promise<GraphInfo> {
  const res = await fetch("/api/graph-info");
  if (!res.ok) throw new Error("Failed to load graph info");
  return res.json();
}

async function fetchNodes(
  search: string,
  minStreets: number | "",
  limit = 50
): Promise<{ total: number; nodes: Node[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set("search", search);
  if (minStreets !== "") params.set("min_streets", String(minStreets));
  const res = await fetch(`/api/nodes?${params}`);
  if (!res.ok) throw new Error("Failed to fetch nodes");
  return res.json();
}

async function fetchNearestNode(lat: number, lng: number): Promise<Node> {
  const res = await fetch("/api/nearest-node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error("Failed to find nearest node");
  return res.json();
}

async function fetchRoute(
  sourceId: number,
  destId: number
): Promise<RouteResult> {
  const res = await fetch("/api/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_id: sourceId, destination_id: destId }),
  });
  if (!res.ok) throw new Error("Failed to calculate route");
  return res.json();
}

async function loadNewLocation(
  location: string,
  networkType = "drive"
): Promise<GraphInfo> {
  const res = await fetch("/api/load-location", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location, network_type: networkType }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Failed to load location");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Home() {
  // Graph metadata
  const [info, setInfo] = useState<GraphInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Location search
  const [locationInput, setLocationInput] = useState("");
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState("");

  // Node explorer
  const [search, setSearch] = useState("");
  const [minStreets, setMinStreets] = useState<number | "">("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [totalNodes, setTotalNodes] = useState(0);
  const [nodesLoading, setNodesLoading] = useState(false);

  // Routing
  const [sourceNode, setSourceNode] = useState<Node | null>(null);
  const [destNode, setDestNode] = useState<Node | null>(null);
  const [routingMode, setRoutingMode] = useState<
    "source" | "destination" | null
  >("source");
  const [calculatedRoute, setCalculatedRoute] = useState<RouteResult | null>(
    null
  );
  const [routeLoading, setRouteLoading] = useState(false);

  // Map iframe key (force remount on location change)
  const [mapKey, setMapKey] = useState(0);

  // Exploration animation
  const [isExploring, setIsExploring] = useState(false);
  const explorationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Debounce timer for node search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Initial load
  // ------------------------------------------------------------------
  useEffect(() => {
    fetchGraphInfo()
      .then((data) => {
        setInfo(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  // ------------------------------------------------------------------
  // Load nodes (debounced)
  // ------------------------------------------------------------------
  const loadNodes = useCallback(() => {
    setNodesLoading(true);
    fetchNodes(search, minStreets)
      .then((res) => {
        setNodes(res.nodes);
        setTotalNodes(res.total);
      })
      .catch(console.error)
      .finally(() => setNodesLoading(false));
  }, [search, minStreets]);

  useEffect(() => {
    if (!info) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(loadNodes, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [info, loadNodes]);

  // ------------------------------------------------------------------
  // Map click → nearest node
  // ------------------------------------------------------------------
  const onMapClicked = useCallback(
    async (lat: number, lng: number) => {
      if (!info) return;
      try {
        const closest = await fetchNearestNode(lat, lng);
        if (routingMode === "source") {
          setSourceNode(closest);
          setRoutingMode("destination");
        } else if (routingMode === "destination") {
          setDestNode(closest);
          setRoutingMode(null);
        } else {
          if (!sourceNode) {
            setSourceNode(closest);
            setRoutingMode("destination");
          } else if (!destNode) {
            setDestNode(closest);
            setRoutingMode(null);
          } else {
            setSourceNode(closest);
            setDestNode(null);
            setCalculatedRoute(null);
            setRoutingMode("destination");
          }
        }
      } catch (err) {
        console.error("Nearest node lookup failed:", err);
      }
    },
    [info, routingMode, sourceNode, destNode]
  );

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg && msg.type === "MAP_CLICK") {
        onMapClicked(msg.lat, msg.lng);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onMapClicked]);

  // ------------------------------------------------------------------
  // Route calculation (server-side) + iframe sync + exploration animation
  // ------------------------------------------------------------------
  useEffect(() => {
    // Cancel any in-progress exploration
    if (explorationTimerRef.current) {
      clearInterval(explorationTimerRef.current);
      explorationTimerRef.current = null;
    }
    setIsExploring(false);

    const iframe = document.getElementById(
      "map-iframe"
    ) as HTMLIFrameElement | null;
    if (!iframe?.contentWindow) return;

    iframe.contentWindow.postMessage({ type: "CLEAR_EXPLORATION" }, "*");

    if (sourceNode && destNode) {
      setRouteLoading(true);
      fetchRoute(sourceNode.id, destNode.id)
        .then((route) => {
          setCalculatedRoute(route.found ? route : null);

          const sendFinalRoute = () => {
            const el = document.getElementById(
              "map-iframe"
            ) as HTMLIFrameElement | null;
            el?.contentWindow?.postMessage(
              {
                type: "UPDATE_ROUTE",
                source: { lat: sourceNode.lat, lng: sourceNode.lon, id: sourceNode.id },
                destination: { lat: destNode.lat, lng: destNode.lon, id: destNode.id },
                routeCoords: route.found ? route.coords : [],
              },
              "*"
            );
          };

          const visited = route.visited_nodes;
          if (route.found && visited && visited.length > 0) {
            const BATCH = 40;
            const INTERVAL_MS = 30;
            let idx = 0;
            setIsExploring(true);
            explorationTimerRef.current = setInterval(() => {
              if (idx >= visited.length) {
                clearInterval(explorationTimerRef.current!);
                explorationTimerRef.current = null;
                setIsExploring(false);
                sendFinalRoute();
                return;
              }
              const el = document.getElementById(
                "map-iframe"
              ) as HTMLIFrameElement | null;
              el?.contentWindow?.postMessage(
                { type: "EXPLORE_NODES_BATCH", nodes: visited.slice(idx, idx + BATCH) },
                "*"
              );
              idx += BATCH;
            }, INTERVAL_MS);
          } else {
            sendFinalRoute();
          }
        })
        .catch((err) => {
          console.error("Route calculation failed:", err);
          setCalculatedRoute(null);
        })
        .finally(() => setRouteLoading(false));
    } else {
      // Show markers only (no route yet)
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

    return () => {
      if (explorationTimerRef.current) {
        clearInterval(explorationTimerRef.current);
        explorationTimerRef.current = null;
      }
      setIsExploring(false);
    };
  }, [sourceNode, destNode]);

  // ------------------------------------------------------------------
  // Locate node on map
  // ------------------------------------------------------------------
  const handleLocateNode = (node: Node) => {
    const iframe = document.getElementById(
      "map-iframe"
    ) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "LOCATE_NODE", lat: node.lat, lng: node.lon },
        "*"
      );
    }
  };

  // ------------------------------------------------------------------
  // Reset route
  // ------------------------------------------------------------------
  const handleReset = () => {
    if (explorationTimerRef.current) {
      clearInterval(explorationTimerRef.current);
      explorationTimerRef.current = null;
    }
    setIsExploring(false);
    setSourceNode(null);
    setDestNode(null);
    setCalculatedRoute(null);
    setRoutingMode("source");
    const iframe = document.getElementById(
      "map-iframe"
    ) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: "CLEAR_ROUTE" }, "*");
    }
  };
  // ------------------------------------------------------------------
  // Poll for background loading
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!info?.loading_location) return;

    const interval = setInterval(() => {
      fetchGraphInfo()
        .then((data) => {
          setInfo(data);
          if (!data.loading_location) {
            // Finished loading!
            setMapKey((k) => k + 1);
            setLocationLoading(false);
            loadNodes();
          }
        })
        .catch(console.error);
    }, 2000);

    return () => clearInterval(interval);
  }, [info?.loading_location, loadNodes]);

  // ------------------------------------------------------------------
  // Switch location
  // ------------------------------------------------------------------
  const handleLoadLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const loc = locationInput.trim();
    if (!loc) return;
    setLocationLoading(true);
    setLocationError("");
    handleReset();
    try {
      const res = await loadNewLocation(loc);
      // The backend returns { status: "loading", location: "..." }
      setInfo((prev) => (prev ? { ...prev, loading_location: res.location } : null));
      setLocationInput("");
      // We don't clear setLocationLoading(false) here. 
      // The polling effect will clear it once graph-info reports it's done.
    } catch (err: unknown) {
      setLocationError(
        err instanceof Error ? err.message : "Failed to load location"
      );
      setLocationLoading(false);
    }
  };

  // ------------------------------------------------------------------
  // Render: Loading state
  // ------------------------------------------------------------------
  if (loading || info?.loading_location) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-white font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          <p className="text-zinc-400 animate-pulse">
            {info?.loading_location 
              ? `Downloading map data for ${info.loading_location}... (This may take a minute)` 
              : `Connecting to backend...`}
          </p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: Error state
  // ------------------------------------------------------------------
  if (!info) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-white font-sans">
        <div className="text-center max-w-md p-6 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl">
          <h2 className="text-xl font-bold text-red-400 mb-2">
            Backend Not Available (Yet)
          </h2>
          <p className="text-zinc-400 mb-4 text-sm">
            Could not connect to the FastAPI backend. It might still be downloading the initial city map, or it isn't running.
          </p>
          <p className="text-zinc-500 mb-6 text-xs">
            Check your terminal. Once you see <strong>"Application startup complete"</strong>, refresh this page.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-semibold transition-colors"
          >
            Refresh Page
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: Main UI
  // ------------------------------------------------------------------
  return (
    <div className="flex h-screen w-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-96 border-r border-zinc-800 bg-zinc-900/60 backdrop-blur-md flex flex-col h-full shrink-0">
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              GMap Router
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {info.location}
          </h1>
          <p className="text-xs text-zinc-500 font-mono">
            {info.num_nodes.toLocaleString()} nodes ·{" "}
            {info.num_edges.toLocaleString()} edges · {info.network_type}
          </p>
        </div>

        {/* Location Search */}
        <form
          onSubmit={handleLoadLocation}
          className="p-4 border-b border-zinc-800 flex flex-col gap-2"
        >
          <label className="text-[10px] uppercase font-bold text-zinc-500">
            Search Location
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Rome, Italy"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              disabled={locationLoading}
              className="flex-1 text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 placeholder-zinc-600 text-white disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={locationLoading || !locationInput.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {locationLoading ? (
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Loading…
                </span>
              ) : (
                "Go"
              )}
            </button>
          </div>
          {locationError && (
            <p className="text-[10px] text-red-400 animate-fade-in">
              {locationError}
            </p>
          )}
        </form>

        {/* Route Planner */}
        <div className="p-6 border-b border-zinc-800 flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Route Planner
          </h3>

          <div className="flex flex-col gap-3">
            {/* Source */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-zinc-500">
                Source Point (Green)
              </span>
              <div className="flex gap-2">
                <div className="flex-1 bg-zinc-950 border border-zinc-800 px-3 py-2 rounded-lg text-xs font-mono flex items-center justify-between text-zinc-300">
                  {sourceNode ? (
                    <span>
                      ID: {sourceNode.id} ({sourceNode.lat.toFixed(4)},{" "}
                      {sourceNode.lon.toFixed(4)})
                    </span>
                  ) : (
                    <span className="text-zinc-600 italic">
                      Click map to set...
                    </span>
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

            {/* Destination */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold text-zinc-500">
                Destination Point (Red)
              </span>
              <div className="flex gap-2">
                <div className="flex-1 bg-zinc-950 border border-zinc-800 px-3 py-2 rounded-lg text-xs font-mono flex items-center justify-between text-zinc-300">
                  {destNode ? (
                    <span>
                      ID: {destNode.id} ({destNode.lat.toFixed(4)},{" "}
                      {destNode.lon.toFixed(4)})
                    </span>
                  ) : (
                    <span className="text-zinc-600 italic">
                      Click map to set...
                    </span>
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

            {/* Route loading / exploration indicator */}
            {(routeLoading || isExploring) && (
              <div className="flex items-center gap-2 text-xs text-zinc-400 animate-fade-in">
                <span
                  className={`h-3 w-3 animate-spin rounded-full border-2 border-t-transparent ${
                    isExploring ? "border-amber-500" : "border-indigo-500"
                  }`}
                />
                {isExploring
                  ? "Visualizing node exploration..."
                  : "Calculating shortest path..."}
              </div>
            )}

            {/* Route result */}
            {calculatedRoute && calculatedRoute.found && (
              <div className="bg-red-950/20 border border-red-500/25 p-4 rounded-xl flex flex-col gap-2 animate-fade-in">
                <span className="text-[10px] uppercase font-bold text-red-400">
                  Route Found
                </span>
                <div className="flex justify-between items-end">
                  <div>
                    <span className="text-2xl font-bold text-white">
                      {(calculatedRoute.distance / 1000).toFixed(2)}
                    </span>
                    <span className="text-xs text-zinc-400 ml-1">km</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-zinc-300">
                      {calculatedRoute.junctions}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">
                      Junctions
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* No route found */}
            {calculatedRoute && !calculatedRoute.found && (
              <div className="bg-amber-950/20 border border-amber-500/25 p-3 rounded-xl text-xs text-amber-300 animate-fade-in">
                No route found between these points.
              </div>
            )}

            {/* Reset */}
            {(sourceNode || destNode) && (
              <button
                onClick={handleReset}
                className="w-full bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700 text-xs font-semibold py-2 rounded-lg transition-colors text-zinc-400 hover:text-white"
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
                  setMinStreets(
                    e.target.value === "" ? "" : Number(e.target.value)
                  )
                }
                className="text-xs bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 text-zinc-400"
              >
                <option value="">All</option>
                <option value="3">3+ ways</option>
                <option value="4">4+ ways</option>
              </select>
            </div>
          </div>

          {/* Node list */}
          <div className="flex-1 overflow-y-auto px-4 py-2 divide-y divide-zinc-800/40">
            {nodesLoading && nodes.length === 0 ? (
              // Skeleton loaders
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="py-3 flex items-center justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="h-3 w-20 bg-zinc-800 rounded animate-shimmer" />
                    <div className="h-2 w-32 bg-zinc-800/60 rounded animate-shimmer" />
                  </div>
                  <div className="flex gap-1">
                    <div className="h-5 w-12 bg-zinc-800 rounded animate-shimmer" />
                    <div className="h-5 w-10 bg-zinc-800 rounded animate-shimmer" />
                    <div className="h-5 w-10 bg-zinc-800 rounded animate-shimmer" />
                  </div>
                </div>
              ))
            ) : (
              <>
                {nodes.map((node) => (
                  <div
                    key={node.id}
                    className="py-2.5 flex items-center justify-between text-xs hover:bg-zinc-800/30 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-zinc-300 font-semibold">
                        {node.id}
                      </span>
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
                        onClick={() => {
                          setSourceNode(node);
                          setRoutingMode("destination");
                        }}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500 hover:text-black font-semibold transition-colors"
                      >
                        Start
                      </button>
                      <button
                        onClick={() => {
                          setDestNode(node);
                          setRoutingMode(null);
                        }}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white font-semibold transition-colors"
                      >
                        End
                      </button>
                    </div>
                  </div>
                ))}
                {nodes.length === 0 && !nodesLoading && (
                  <div className="text-center text-zinc-600 text-sm py-8">
                    No matching nodes found.
                  </div>
                )}
                {totalNodes > 50 && (
                  <div className="text-center text-zinc-500 text-[10px] py-2">
                    Showing top 50 of {totalNodes.toLocaleString()} nodes
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main Map */}
      <main className="flex-1 h-full relative bg-zinc-950">
        {locationLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm animate-slide-down">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
              <p className="text-zinc-400 text-sm">
                Loading road network...
              </p>
              <p className="text-zinc-600 text-xs">
                This may take 10-30 seconds for large cities
              </p>
            </div>
          </div>
        )}
        <iframe
          key={mapKey}
          id="map-iframe"
          src="/api/map"
          className="w-full h-full border-none"
          title="Interactive Map"
        />
        {/* Floating info bar */}
        <div className="absolute bottom-4 right-4 bg-zinc-900/90 border border-zinc-800 px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-zinc-500">Center:</span>{" "}
            <span className="text-zinc-300">
              {info.center.lat.toFixed(5)}, {info.center.lon.toFixed(5)}
            </span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div>
            <span className="text-zinc-500">Mode:</span>{" "}
            <span className="text-emerald-400">
              {routingMode
                ? `Click to set ${routingMode}`
                : "Route ready"}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
