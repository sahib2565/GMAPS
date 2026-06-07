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
    
    print("Saving interactive map to 'map.html'...")
    m.save("map.html")
    print("Done! You can open 'map.html' in your browser.")


if __name__ == "__main__":
    main()




