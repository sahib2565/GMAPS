import os
import json
import osmnx as ox
import folium
import branca

def main():
    print("Fetching drivable road network for Verona, Veneto, Italy...")
    # Fetch graph from place name (limited to drivable streets to keep it lightweight)
    G = ox.graph_from_place("Verona, Veneto, Italy", network_type="drive")
    
    # Convert graph to GeoDataFrames
    gdf_nodes, gdf_edges = ox.graph_to_gdfs(G)
    
    # Find center coordinates of the graph for map positioning
    centroid = gdf_nodes.union_all().centroid
    center_lat, center_lon = centroid.y, centroid.x
    
    # Create base map with prefer_canvas=True for smooth panning and zooming performance
    m = folium.Map(
        location=[center_lat, center_lon],
        zoom_start=13,
        tiles="cartodbpositron",
        prefer_canvas=True
    )
    
    # Keep only the essential columns to drastically reduce the output HTML file size
    columns_to_keep = ['geometry']
    if 'name' in gdf_edges.columns:
        columns_to_keep.append('name')
    if 'highway' in gdf_edges.columns:
        columns_to_keep.append('highway')
        
    plot_edges = gdf_edges[columns_to_keep].copy()
    
    # Clean up the edges data to make it GeoJSON serializable (converting list values to strings)
    for col in plot_edges.columns:
        if col != 'geometry':
            plot_edges[col] = plot_edges[col].apply(
                lambda x: ", ".join(map(str, x)) if isinstance(x, list) else x
            )
            plot_edges[col] = plot_edges[col].fillna("")
            
    # Add road network to the map
    tooltip_fields = []
    if 'name' in plot_edges.columns:
        tooltip_fields.append('name')
    if 'highway' in plot_edges.columns:
        tooltip_fields.append('highway')
        
    print("Generating interactive map...")
    folium.GeoJson(
        plot_edges,
        style_function=lambda x: {
            'color': '#3388ff',
            'weight': 2,
            'opacity': 0.7
        },
        tooltip=folium.GeoJsonTooltip(fields=tooltip_fields) if tooltip_fields else None
    ).add_to(m)
    
    # Inject JavaScript for interactive source/destination marking and path drawing
    js_code = """
    var routeLayer = null;
    var sourceMarker = null;
    var destinationMarker = null;

    console.log("Map script loaded successfully!");
    
    // Function to send click event to parent
    function sendClick(e) {
        console.log("Map click event captured inside iframe:", e);
        if (e && e.latlng) {
            console.log("Sending MAP_CLICK to parent:", e.latlng);
            window.parent.postMessage({
                type: 'MAP_CLICK',
                lat: e.latlng.lat,
                lng: e.latlng.lng
            }, '*');
        }
    }

    // Listen to clicks on the map
    {{this.get_name()}}.on('click', sendClick);

    // Listen to clicks on any other layers (like the GeoJSON roads)
    {{this.get_name()}}.eachLayer(function(layer) {
        if (layer.on) {
            layer.on('click', sendClick);
        }
    });

    // Listen to messages from the parent window
    window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data || !data.type) return;
        
        if (data.type === 'UPDATE_ROUTE') {
            // Clear previous layers
            if (routeLayer) {{this.get_name()}}.removeLayer(routeLayer);
            if (sourceMarker) {{this.get_name()}}.removeLayer(sourceMarker);
            if (destinationMarker) {{this.get_name()}}.removeLayer(destinationMarker);
            
            // Add source marker
            if (data.source) {
                sourceMarker = L.marker([data.source.lat, data.source.lng], {
                    icon: L.divIcon({
                        className: 'custom-div-icon-source',
                        html: "<div style='background-color:#10B981;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    })
                }).addTo({{this.get_name()}}).bindPopup("Source: " + data.source.id);
            }
            
            // Add destination marker
            if (data.destination) {
                destinationMarker = L.marker([data.destination.lat, data.destination.lng], {
                    icon: L.divIcon({
                        className: 'custom-div-icon-dest',
                        html: "<div style='background-color:#EF4444;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);'></div>",
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    })
                }).addTo({{this.get_name()}}).bindPopup("Destination: " + data.destination.id);
            }
            
            // Add route line
            if (data.routeCoords && data.routeCoords.length > 0) {
                routeLayer = L.polyline(data.routeCoords, {
                    color: '#EF4444',
                    weight: 8,
                    opacity: 0.9
                }).addTo({{this.get_name()}});
                
                // Zoom map to fit the route bounds
                {{this.get_name()}}.fitBounds(routeLayer.getBounds(), {padding: [50, 50]});
            }
        } else if (data.type === 'CLEAR_ROUTE') {
            if (routeLayer) {{this.get_name()}}.removeLayer(routeLayer);
            if (sourceMarker) {{this.get_name()}}.removeLayer(sourceMarker);
            if (destinationMarker) {{this.get_name()}}.removeLayer(destinationMarker);
        } else if (data.type === 'LOCATE_NODE') {
            console.log("LOCATING NODE", data);
            {{this.get_name()}}.setView([data.lat, data.lng], 17);
            if (window.locateMarker) {{this.get_name()}}.removeLayer(window.locateMarker);
            window.locateMarker = L.circleMarker([data.lat, data.lng], {
                color: '#3B82F6',
                fillColor: '#3B82F6',
                fillOpacity: 0.8,
                radius: 8
            }).addTo({{this.get_name()}});
        }
    });
    """
    map_name = m.get_name()
    final_js = js_code.replace('{{this.get_name()}}', map_name)
    
    # Ensure public folder exists
    public_dir = os.path.join("app", "public")
    os.makedirs(public_dir, exist_ok=True)
    
    print("Saving interactive map to 'app/public/map.html'...")
    map_path = os.path.join(public_dir, "map.html")
    m.save(map_path)
    
    # Post-process: inject our custom script at the very END of the HTML,
    # AFTER the Leaflet map object has been created by Folium's own scripts.
    with open(map_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    
    inject_script = f"\n<script>\n{final_js}\n</script>\n"
    html_content = html_content.replace("</html>", inject_script + "</html>")
    
    with open(map_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    
    # Extract metadata and stats
    print("Extracting and saving node metadata to 'app/public/graph_data.json'...")
    num_nodes = len(G.nodes)
    num_edges = len(G.edges)
    
    # Calculate average street count
    street_counts_series = gdf_nodes['street_count']
    avg_street_count = float(street_counts_series.mean())
    street_counts_dist = {int(k): int(v) for k, v in street_counts_series.value_counts().items()}
    
    # List of node objects
    nodes_list = []
    for node_id, data in G.nodes(data=True):
        nodes_list.append({
            "id": int(node_id),
            "lat": float(data.get('y')),
            "lon": float(data.get('x')),
            "street_count": int(data.get('street_count', 0))
        })
        
    # Sort nodes by street_count descending
    nodes_list.sort(key=lambda x: x['street_count'], reverse=True)
    
    # Build adjacency list for Dijkstra and route rendering
    adjacency = {}
    for u, v, k, data in G.edges(keys=True, data=True):
        u_str = str(u)
        v_str = str(v)
        
        # Get geometry coordinates
        geom = data.get('geometry')
        if geom:
            # coords are (lon, lat) in Shapely, we need (lat, lon) for Folium
            coords = [[lat, lon] for lon, lat in geom.coords]
        else:
            u_data = G.nodes[u]
            v_data = G.nodes[v]
            coords = [[u_data['y'], u_data['x']], [v_data['y'], v_data['x']]]
            
        weight = data.get('length', 0)
        
        if u_str not in adjacency:
            adjacency[u_str] = []
            
        # Check if an edge between u and v already exists
        existing_edge_idx = -1
        for idx, edge in enumerate(adjacency[u_str]):
            if edge["target"] == v_str:
                existing_edge_idx = idx
                break
                
        edge_entry = {
            "target": v_str,
            "weight": weight,
            "coords": coords
        }
        
        if existing_edge_idx == -1:
            adjacency[u_str].append(edge_entry)
        else:
            if weight < adjacency[u_str][existing_edge_idx]["weight"]:
                adjacency[u_str][existing_edge_idx] = edge_entry
    
    graph_data = {
        "location": "Verona, Veneto, Italy",
        "network_type": "drive",
        "num_nodes": num_nodes,
        "num_edges": num_edges,
        "avg_street_count": round(avg_street_count, 2),
        "street_counts": street_counts_dist,
        "center": {"lat": center_lat, "lon": center_lon},
        "nodes": nodes_list,
        "adjacency": adjacency
    }
    
    with open(os.path.join(public_dir, "graph_data.json"), "w", encoding="utf-8") as f:
        json.dump(graph_data, f, indent=2)
        
    print("Done! Files successfully created in Next.js public directory.")


if __name__ == "__main__":
    main()




