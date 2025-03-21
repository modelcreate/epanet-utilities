export type NetworkData = {
  coordinates: Record<string, [number, number]>; // Node ID -> [X, Y]
  vertices: Record<string, [number, number][]>; // Link ID -> Array of [X, Y] coordinates
  inp: string;
  name: string;
};

export type ProjectionInputMethod = "search" | "file" | "manual";

export interface Projection {
  id: string; // EPSG code or unique identifier
  name: string; // Human-readable name of the projection
  code: string; // PROJ.4 or WKT string
}
