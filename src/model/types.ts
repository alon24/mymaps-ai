import type { Geometry, Feature } from 'geojson'

/** Geometries we support for editing. */
export type MapGeometry = Extract<Geometry, { type: 'Point' | 'LineString' | 'Polygon' }>

export interface FeatureProps {
  id: string
  name: string
  description: string
  /** CSS hex color, e.g. #1f6f5c */
  color: string
  /** Optional emoji shown on point markers */
  icon?: string
}

export type MapFeature = Feature<MapGeometry, FeatureProps>

export type LayerStyle = 'individual' | 'uniform' | 'numbered'

export interface TripDay {
  /** YYYY-MM-DD */
  date?: string
  /** Draw a line connecting the day's points in order */
  route: boolean
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  /** Layer color: used by uniform style, sequence numbers and the route line */
  color: string
  style: LayerStyle
  /** Set when this layer is a trip day */
  day?: TripDay
  /** Route line through the layer's points in order (for non-day layers; days use day.route) */
  route?: boolean
  /** Order = sequence order (numbers, itinerary, route) */
  features: MapFeature[]
}

export const SCHEMA_VERSION = 1

export interface MapDoc {
  schema: typeof SCHEMA_VERSION
  id: string
  title: string
  description: string
  layers: Layer[]
  /** ISO timestamp of the last local change */
  updatedAt: string
  /** Google Drive file id once the map has been saved to Drive */
  driveFileId?: string
  /** Drive `version` we last synced with (for conflict detection) */
  driveVersion?: string
  /** Local only: a shared map opened without edit rights */
  viewOnly?: boolean
}

export const PALETTE = [
  '#1f6f5c', '#d1495b', '#edae49', '#00798c', '#30638e',
  '#7b2d8e', '#e07a1f', '#3d9a3d', '#5c5c5c', '#c2185b',
] as const

export const ICONS = ['', '📍', '⭐', '🏠', '🍽️', '☕', '🏨', '🅿️', '⛽', '🏖️', '⛰️', '🌳', '🏛️', '🛒', '🚉', '❤️'] as const
