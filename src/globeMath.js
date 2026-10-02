import { Vector3 } from 'three';
// Coordinates match Three.js sphere UVs and the equirectangular map texture.
export function globePoint(lat, lng, radius = 1) {
  const latitude = lat * Math.PI / 180;
  const longitude = lng * Math.PI / 180;
  return new Vector3(radius * Math.cos(latitude) * Math.cos(longitude), radius * Math.sin(latitude), -radius * Math.cos(latitude) * Math.sin(longitude));
}
