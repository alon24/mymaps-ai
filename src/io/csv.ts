import { createFeature, createLayer } from '../model/ops'
import type { Layer, MapDoc, MapFeature, MapGeometry } from '../model/types'
import { normalizeColor, splitGeometry } from './normalize'
import { dominantColor, type ImportResult } from './kml'
import { PALETTE } from '../model/types'

/** RFC 4180 CSV parser (quotes, escaped quotes, newlines in quotes, BOM, , or ; or tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const find = (headers: string[], names: string[]) =>
  headers.findIndex((h) => names.includes(h.trim().toLowerCase()))

/** Minimal WKT reader for the types Google My Maps CSV export uses. */
export function parseWkt(wkt: string): MapGeometry[] {
  const m = wkt.trim().match(/^(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*Z?\s*\((.*)\)$/is)
  if (!m) return []
  const type = m[1].toUpperCase()
  const body = m[2]
  const pts = (s: string) =>
    s
      .replace(/[()]/g, '')
      .split(',')
      .map((p) => p.trim().split(/\s+/).map(Number).slice(0, 2))
      .filter((p) => p.length === 2 && p.every(Number.isFinite))
  const rings = (s: string) => (s.match(/\([^()]*\)/g) ?? []).map(pts)
  switch (type) {
    case 'POINT':
      return splitGeometry({ type: 'Point', coordinates: pts(body)[0] ?? [] })
    case 'LINESTRING':
      return splitGeometry({ type: 'LineString', coordinates: pts(body) })
    case 'POLYGON':
      return splitGeometry({ type: 'Polygon', coordinates: rings(`(${body})`) })
    case 'MULTIPOINT':
      return splitGeometry({ type: 'MultiPoint', coordinates: pts(body) })
    case 'MULTILINESTRING':
      return splitGeometry({ type: 'MultiLineString', coordinates: rings(`(${body})`) })
    case 'MULTIPOLYGON':
      return (body.match(/\(\([^]*?\)\)/g) ?? []).flatMap((poly) =>
        splitGeometry({ type: 'Polygon', coordinates: rings(poly.slice(1, -1)) }),
      )
  }
  return []
}

export interface PendingAddress {
  name: string
  description: string
  address: string
}

export interface CsvImportResult extends ImportResult {
  /** Rows without coordinates that have an address — the UI geocodes them. */
  pending: PendingAddress[]
  skipped: number
}

export function importCsv(text: string, layerName = 'CSV'): CsvImportResult {
  const [headers = [], ...rows] = parseCsv(text)
  const iLat = find(headers, ['lat', 'latitude', 'y', 'קו רוחב'])
  const iLng = find(headers, ['lng', 'lon', 'long', 'longitude', 'x', 'קו אורך'])
  const iWkt = find(headers, ['wkt', 'geometry'])
  const iName = find(headers, ['name', 'title', 'שם', 'כותרת'])
  const iDesc = find(headers, ['description', 'desc', 'notes', 'תיאור', 'הערות'])
  const iAddr = find(headers, ['address', 'location', 'כתובת', 'מיקום'])
  const iColor = find(headers, ['color', 'צבע'])
  const iLayer = find(headers, ['layer', 'שכבה'])
  if (iWkt < 0 && (iLat < 0 || iLng < 0) && iAddr < 0) {
    throw new Error('לא נמצאו עמודות מיקום ב-CSV (lat/lng, WKT או address)')
  }

  const byLayer = new Map<string, MapFeature[]>()
  const pending: PendingAddress[] = []
  let skipped = 0
  for (const r of rows) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    const props = {
      name: cell(iName),
      description: cell(iDesc),
      color: normalizeColor(cell(iColor)),
    }
    let geoms: MapGeometry[] = []
    if (iWkt >= 0 && cell(iWkt)) geoms = parseWkt(cell(iWkt))
    if (!geoms.length && iLat >= 0 && iLng >= 0) {
      const lat = Number(cell(iLat))
      const lng = Number(cell(iLng))
      if (cell(iLat) && cell(iLng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
        geoms = [{ type: 'Point', coordinates: [lng, lat] }]
    }
    if (!geoms.length) {
      if (cell(iAddr)) pending.push({ name: props.name || cell(iAddr), description: props.description, address: cell(iAddr) })
      else skipped++
      continue
    }
    const key = cell(iLayer) || layerName
    const list = byLayer.get(key) ?? []
    list.push(...geoms.map((g) => createFeature(g, props)))
    byLayer.set(key, list)
  }
  const layers: Layer[] = [...byLayer].map(([name, features], i) =>
    createLayer(name, features, { color: dominantColor(features, PALETTE[i % PALETTE.length]) }),
  )
  if (!layers.length) layers.push(createLayer(layerName))
  return { layers, pending, skipped }
}

// ---------- export ----------

const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function toWkt(g: MapGeometry): string {
  const p = (c: number[]) => `${c[0]} ${c[1]}`
  if (g.type === 'Point') return `POINT (${p(g.coordinates)})`
  if (g.type === 'LineString') return `LINESTRING (${g.coordinates.map(p).join(', ')})`
  return `POLYGON (${g.coordinates.map((r) => `(${r.map(p).join(', ')})`).join(', ')})`
}

export function exportCsv(doc: MapDoc): string {
  const lines = [['WKT', 'name', 'description', 'layer', 'color', 'lat', 'lng'].join(',')]
  for (const l of doc.layers)
    for (const f of l.features) {
      const pt = f.geometry.type === 'Point' ? f.geometry.coordinates : null
      lines.push(
        [toWkt(f.geometry), f.properties.name, f.properties.description, l.name, f.properties.color, pt ? String(pt[1]) : '', pt ? String(pt[0]) : '']
          .map(q)
          .join(','),
      )
    }
  // BOM so Excel opens Hebrew correctly
  return '﻿' + lines.join('\r\n') + '\r\n'
}
