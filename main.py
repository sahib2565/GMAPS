import os
import json
import osmnx as ox
import folium

def main():
    print("Fetching drivable road network for Verona, Italy...")
    # Fetch graph from place name (limited to drivable streets to keep it lightweight)
    G = ox.graph_from_place("Verona, Italy", network_type="drive")
    
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
    
    # Ensure public folder exists
    public_dir = os.path.join("app", "public")
    os.makedirs(public_dir, exist_ok=True)
    
    print("Saving interactive map to 'app/public/map.html'...")
    m.save(os.path.join(public_dir, "map.html"))
    
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
    
    graph_data = {
        "location": "Verona, Italy",
        "network_type": "drive",
        "num_nodes": num_nodes,
        "num_edges": num_edges,
        "avg_street_count": round(avg_street_count, 2),
        "street_counts": street_counts_dist,
        "center": {"lat": center_lat, "lon": center_lon},
        "nodes": nodes_list
    }
    
    with open(os.path.join(public_dir, "graph_data.json"), "w", encoding="utf-8") as f:
        json.dump(graph_data, f, indent=2)
        
    print("Done! Files successfully created in Next.js public directory.")


if __name__ == "__main__":
    main()




