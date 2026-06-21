"""
FastAPI backend for the GMap Router application.

Serves an OSMnx road network graph, provides shortest-path routing via
Dijkstra (NetworkX), nearest-node snapping, and dynamic city loading.
"""

import os
import json
import heapq
import logging
from contextlib import asynccontextmanager
from typing import Optional

import networkx as nx
import osmnx as ox
import folium
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from scipy.spatial import KDTree

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gmaps-backend")

# ---------------------------------------------------------------------------
# In-memory graph store
# ---------------------------------------------------------------------------
_state: dict = {
    "G": None,
    "gdf_nodes": None,
    "gdf_edges": None,
    "location": None,
    "network_type": "drive",
    "center": {"lat": 0.0, "lon": 0.0},
    "node_lookup": {},   # id -> {id, lat, lon, street_count}
    "kdtree": None,      # scipy KDTree for fast nearest-node
    "kdtree_ids": [],    # ordered node ids matching KDTree rows
    "map_html": "",      # pre-rendered Folium HTML string
}


# ---------------------------------------------------------------------------
# Dijkstra with exploration tracking
# ---------------------------------------------------------------------------

def _sample_explored(visited_order: list, max_count: int) -> list[dict]:
    """Evenly sample visited_order and return [{lat, lng}, ...] dicts."""
    node_lookup = _state["node_lookup"]
    total = len(visited_order)
    if total <= max_count:
        sampled = visited_order
    else:
        step = total / max_count
        sampled = [visited_order[int(i * step)] for i in range(max_count)]
    return [
        {"lat": node_lookup[n]["lat"], "lng": node_lookup[n]["lon"]}
        for n in sampled
        if n in node_lookup
    ]


def _dijkstra_with_exploration(
    G, source: int, target: int, weight: str = "length", max_visited: int = 2000
) -> tuple:
    """Run Dijkstra and return (path | None, distance, visited_coords).

    visited_coords is a sampled list of {lat, lng} dicts in exploration order.
    """
    if source == target:
        return [source], 0.0, []

    dist: dict = {source: 0.0}
    prev: dict = {source: None}
    heap: list = [(0.0, source)]
    visited_order: list = []
    settled: set = set()

    while heap:
        d, u = heapq.heappop(heap)
        if u in settled:
            continue
        settled.add(u)
        visited_order.append(u)
        if u == target:
            break
        for v, edge_dict in G[u].items():
            best = min(edge_dict.values(), key=lambda e: e.get(weight, 1.0))
            w = float(best.get(weight, 1.0))
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(heap, (nd, v))

    if target not in dist:
        return None, float("inf"), _sample_explored(visited_order, max_visited)

    path: list = []
    cur = target
    while cur is not None:
        path.append(cur)
        cur = prev.get(cur)
    path.reverse()

    return path, dist[target], _sample_explored(visited_order, max_visited)


# ---------------------------------------------------------------------------
# Graph loading helpers
# ---------------------------------------------------------------------------


def _build_map_html(gdf_edges, center_lat: float, center_lon: float) -> str:
    """Generate the Folium/Leaflet map HTML string."""
    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=13,
        tiles="cartodbpositron",
        prefer_canvas=True,
    )

    # Slim down edges for rendering
    columns_to_keep = ["geometry"]
    if "name" in gdf_edges.columns:
        columns_to_keep.append("name")
    if "highway" in gdf_edges.columns:
        columns_to_keep.append("highway")

    plot_edges = gdf_edges[columns_to_keep].copy()

    for col in plot_edges.columns:
        if col != "geometry":
            plot_edges[col] = plot_edges[col].apply(
                lambda x: ", ".join(map(str, x)) if isinstance(x, list) else x
            )
            plot_edges[col] = plot_edges[col].fillna("")

    tooltip_fields = [c for c in ["name", "highway"] if c in plot_edges.columns]

    folium.GeoJson(
        plot_edges,
        style_function=lambda x: {"color": "#3388ff", "weight": 2, "opacity": 0.7},
        tooltip=folium.GeoJsonTooltip(fields=tooltip_fields) if tooltip_fields else None,
    ).add_to(m)

    # Inject click-forwarding JS
    map_name = m.get_name()
    js_code = f"""
    var routeLayer = null;
    var sourceMarker = null;
    var destinationMarker = null;
    var explorationLayer = L.layerGroup().addTo({map_name});

    function sendClick(e) {{
        if (e && e.latlng) {{
            window.parent.postMessage({{
                type: 'MAP_CLICK',
                lat: e.latlng.lat,
                lng: e.latlng.lng
            }}, '*');
        }}
    }}

    {map_name}.on('click', sendClick);
    {map_name}.eachLayer(function(layer) {{
        if (layer.on) layer.on('click', sendClick);
    }});

    window.addEventListener('message', function(event) {{
        var data = event.data;
        if (!data || !data.type) return;

        if (data.type === 'UPDATE_ROUTE') {{
            explorationLayer.clearLayers();
            if (routeLayer) {map_name}.removeLayer(routeLayer);
            if (sourceMarker) {map_name}.removeLayer(sourceMarker);
            if (destinationMarker) {map_name}.removeLayer(destinationMarker);

            if (data.source) {{
                sourceMarker = L.marker([data.source.lat, data.source.lng], {{
                    icon: L.divIcon({{
                        className: 'custom-div-icon-source',
                        html: "<div style='background-color:#10B981;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
                        iconSize: [14, 14], iconAnchor: [7, 7]
                    }})
                }}).addTo({map_name}).bindPopup("Source: " + data.source.id);
            }}

            if (data.destination) {{
                destinationMarker = L.marker([data.destination.lat, data.destination.lng], {{
                    icon: L.divIcon({{
                        className: 'custom-div-icon-dest',
                        html: "<div style='background-color:#EF4444;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
                        iconSize: [14, 14], iconAnchor: [7, 7]
                    }})
                }}).addTo({map_name}).bindPopup("Destination: " + data.destination.id);
            }}

            if (data.routeCoords && data.routeCoords.length > 0) {{
                routeLayer = L.polyline(data.routeCoords, {{
                    color: '#EF4444', weight: 8, opacity: 0.9
                }}).addTo({map_name});
                {map_name}.fitBounds(routeLayer.getBounds(), {{padding: [50, 50]}});
            }}
        }} else if (data.type === 'CLEAR_ROUTE') {{
            explorationLayer.clearLayers();
            if (routeLayer) {map_name}.removeLayer(routeLayer);
            if (sourceMarker) {map_name}.removeLayer(sourceMarker);
            if (destinationMarker) {map_name}.removeLayer(destinationMarker);
        }} else if (data.type === 'LOCATE_NODE') {{
            {map_name}.setView([data.lat, data.lng], 17);
            if (window.locateMarker) {map_name}.removeLayer(window.locateMarker);
            window.locateMarker = L.circleMarker([data.lat, data.lng], {{
                color: '#3B82F6', fillColor: '#3B82F6', fillOpacity: 0.8, radius: 8
            }}).addTo({map_name});
        }} else if (data.type === 'EXPLORE_NODES_BATCH') {{
            (data.nodes || []).forEach(function(n) {{
                L.circleMarker([n.lat, n.lng], {{
                    radius: 4,
                    color: '#F59E0B',
                    fillColor: '#FBBF24',
                    fillOpacity: 0.55,
                    weight: 0,
                    interactive: false
                }}).addTo(explorationLayer);
            }});
        }} else if (data.type === 'CLEAR_EXPLORATION') {{
            explorationLayer.clearLayers();
        }}
    }});
    """

    html = m.get_root().render()
    inject_script = f"\n<script>\n{js_code}\n</script>\n"
    html = html.replace("</html>", inject_script + "</html>")
    return html


def load_location(location: str, network_type: str = "drive") -> None:
    """Fetch the road network for *location* and populate _state."""
    logger.info("Loading road network for '%s' (type=%s)...", location, network_type)

    G = ox.graph_from_place(location, network_type=network_type)
    gdf_nodes, gdf_edges = ox.graph_to_gdfs(G)

    centroid = gdf_nodes.union_all().centroid
    center_lat, center_lon = centroid.y, centroid.x

    # Build node lookup dict & KDTree arrays
    node_lookup = {}
    coords_for_tree = []
    kdtree_ids = []
    for node_id, data in G.nodes(data=True):
        lat = float(data.get("y"))
        lon = float(data.get("x"))
        node_lookup[int(node_id)] = {
            "id": int(node_id),
            "lat": lat,
            "lon": lon,
            "street_count": int(data.get("street_count", 0)),
        }
        coords_for_tree.append((lat, lon))
        kdtree_ids.append(int(node_id))

    kdtree = KDTree(coords_for_tree)

    # Build map HTML
    map_html = _build_map_html(gdf_edges, center_lat, center_lon)

    # Write state
    _state.update(
        {
            "G": G,
            "gdf_nodes": gdf_nodes,
            "gdf_edges": gdf_edges,
            "location": location,
            "network_type": network_type,
            "center": {"lat": center_lat, "lon": center_lon},
            "node_lookup": node_lookup,
            "kdtree": kdtree,
            "kdtree_ids": kdtree_ids,
            "map_html": map_html,
        }
    )
    logger.info(
        "Loaded %d nodes, %d edges for '%s'.",
        len(G.nodes),
        len(G.edges),
        location,
    )


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load default location on startup."""
    default_location = os.environ.get("GMAPS_DEFAULT_LOCATION", "Verona, Veneto, Italy")
    default_network = os.environ.get("GMAPS_NETWORK_TYPE", "drive")
    load_location(default_location, default_network)
    yield


app = FastAPI(
    title="GMap Router API",
    description="OSMnx-powered road network routing backend",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class LatLng(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    source_id: int
    destination_id: int


class LoadLocationRequest(BaseModel):
    location: str
    network_type: str = "drive"


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


@app.get("/api/graph-info")
def graph_info():
    """Return lightweight graph metadata."""
    G = _state["G"]
    if G is None:
        raise HTTPException(status_code=503, detail="No graph loaded yet")
    return {
        "location": _state["location"],
        "loading_location": _state.get("loading_location"),
        "network_type": _state["network_type"],
        "num_nodes": len(G.nodes),
        "num_edges": len(G.edges),
        "center": _state["center"],
    }


@app.get("/api/nodes")
def get_nodes(
    search: str = Query("", description="Search by node ID or coordinates"),
    min_streets: Optional[int] = Query(None, description="Minimum street_count filter"),
    limit: int = Query(50, ge=1, le=200, description="Max results"),
):
    """Return filtered, paginated node list (sorted by street_count desc)."""
    if not _state["node_lookup"]:
        raise HTTPException(status_code=503, detail="No graph loaded yet")

    nodes = sorted(
        _state["node_lookup"].values(),
        key=lambda n: n["street_count"],
        reverse=True,
    )

    # Apply filters
    if min_streets is not None:
        nodes = [n for n in nodes if n["street_count"] >= min_streets]

    if search:
        search_lower = search.lower()
        nodes = [
            n
            for n in nodes
            if search_lower in str(n["id"])
            or search_lower in f"{n['lat']:.5f}"
            or search_lower in f"{n['lon']:.5f}"
        ]

    total = len(nodes)
    return {"total": total, "nodes": nodes[:limit]}


@app.post("/api/nearest-node")
def nearest_node(payload: LatLng):
    """Find the nearest graph node to the given coordinates."""
    if _state["kdtree"] is None:
        raise HTTPException(status_code=503, detail="No graph loaded yet")

    _, idx = _state["kdtree"].query([payload.lat, payload.lng])
    node_id = _state["kdtree_ids"][idx]
    return _state["node_lookup"][node_id]


@app.post("/api/route")
def calculate_route(payload: RouteRequest):
    """Compute shortest path between two nodes using Dijkstra."""
    G = _state["G"]
    if G is None:
        raise HTTPException(status_code=503, detail="No graph loaded yet")

    src = payload.source_id
    dst = payload.destination_id

    if src not in G.nodes:
        raise HTTPException(status_code=404, detail=f"Source node {src} not found in graph")
    if dst not in G.nodes:
        raise HTTPException(status_code=404, detail=f"Destination node {dst} not found in graph")

    path, distance, visited_nodes = _dijkstra_with_exploration(G, src, dst, weight="length")

    if path is None:
        return {"found": False, "path": [], "coords": [], "distance": 0, "junctions": 0, "visited_nodes": []}

    # Build polyline coordinates from edge geometries
    coords: list[list[float]] = []
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        edge_data = min(G[u][v].values(), key=lambda d: d.get("length", 0))
        geom = edge_data.get("geometry")
        if geom:
            segment = [[lat, lon] for lon, lat in geom.coords]
        else:
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            segment = [[u_data["y"], u_data["x"]], [v_data["y"], v_data["x"]]]
        coords.extend(segment)

    return {
        "found": True,
        "path": [int(n) for n in path],
        "coords": coords,
        "distance": round(distance, 2),
        "junctions": len(path),
        "visited_nodes": visited_nodes,
    }


from fastapi import BackgroundTasks

def _do_load_location(location: str, network_type: str):
    try:
        load_location(location, network_type)
    except Exception as e:
        logger.exception("Failed to load location '%s'", location)
    finally:
        _state["loading_location"] = None

@app.post("/api/load-location")
def api_load_location(payload: LoadLocationRequest, background_tasks: BackgroundTasks):
    """Switch to a different city / location in the background."""
    _state["loading_location"] = payload.location
    background_tasks.add_task(_do_load_location, payload.location, payload.network_type)
    return {"status": "loading", "location": payload.location}




@app.get("/api/map", response_class=HTMLResponse)
def serve_map():
    """Serve the pre-rendered Folium map HTML."""
    if not _state["map_html"]:
        raise HTTPException(status_code=503, detail="Map not generated yet")
    return _state["map_html"]
