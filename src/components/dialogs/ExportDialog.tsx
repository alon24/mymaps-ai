import { routesByLayer } from '../../store/routeStore'
import { useMapStore } from '../../store/mapStore'
import { downloadBlob, exportDoc, type ExportFormat } from '../../io'
import { itineraryHtml } from '../../io/itineraryHtml'
import { tripDays } from '../../model/itinerary'
import { appBase } from '../../lib/appBase'
import { Icon } from '../ui'

// ---------------- Export ----------------
export function ExportDialog() {
  const doc = useMapStore((s) => s.doc)
  const hasDays = tripDays(doc).length > 0
  const run = async (f: ExportFormat) => {
    const { blob, filename } = await exportDoc(doc, f)
    downloadBlob(blob, filename)
  }
  const formats: { f: ExportFormat; title: string; text: string }[] = [
    { f: 'kml', title: 'KML', text: 'לייבוא ל-Google My Maps ול-Google Earth' },
    { f: 'kmz', title: 'KMZ', text: 'KML דחוס' },
    { f: 'geojson', title: 'GeoJSON', text: 'לכלי GIS ומפתחים' },
    { f: 'csv', title: 'CSV', text: 'לאקסל ול-Google Sheets' },
  ]
  return (
    <div className="export">
      <ul className="export__list">
        {formats.map((x) => (
          <li key={x.f}>
            <button type="button" className="export__item" onClick={() => void run(x.f)}>
              <Icon name="download" />
              <span>
                <strong>{x.title}</strong>
                <span>{x.text}</span>
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="export__item"
            disabled={!hasDays}
            onClick={() => downloadBlob(new Blob([itineraryHtml(doc, { appBase: appBase(), routes: routesByLayer(doc) })], { type: 'text/html;charset=utf-8' }), `${doc.title || 'trip'} - מסלול.html`)}
          >
            <Icon name="route" />
            <span>
              <strong>מסלול לטיול (HTML)</strong>
              <span>{hasDays ? 'דף אחד עם הימים, העצירות וקישורי ניווט. עובד גם בלי אינטרנט.' : 'זמין כשיש במפה ימי טיול'}</span>
            </span>
          </button>
        </li>
      </ul>
      <p className="hint">כדי להעביר ל-Google My Maps: ייצא KML, ואז ב-My Maps בחר "ייבוא" בשכבה חדשה.</p>
    </div>
  )
}

export default ExportDialog
