import type { MapDoc } from '../model/types'
import { appFeatureUrl, dayRouteUrls, googleSearchUrl, navigateUrl, tripDays, type Day } from '../model/itinerary'
import { formatDistance } from '../geo/measure'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Escape, then turn bare URLs into links and newlines into <br>. */
function richText(s: string): string {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>')
}

/** Descriptions imported from KML may contain HTML: keep line breaks, drop tags. */
export const stripTags = (s: string): string =>
  s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()

export function formatDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** Small offline overview of a day: stops projected into an SVG, numbered, joined in order. */
export function daySketch(day: Day): string {
  if (day.stops.length < 2) return ''
  const W = 320
  const H = 180
  const P = 18
  const lats = day.stops.map((s) => s.lat)
  const lngs = day.stops.map((s) => s.lng)
  const kx = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180))
  const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * kx, 1e-6)
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 1e-6)
  const scale = Math.min((W - 2 * P) / spanX, (H - 2 * P) / spanY)
  const ox = (W - spanX * scale) / 2
  const oy = (H - spanY * scale) / 2
  const pts = day.stops.map((s) => [ox + (s.lng - Math.min(...lngs)) * kx * scale, H - (oy + (s.lat - Math.min(...lats)) * scale)])
  const c = esc(day.layer.color)
  return `<svg class="sketch" viewBox="0 0 ${W} ${H}" role="img" aria-label="סקיצת מסלול היום">
<polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="6 4" stroke-linejoin="round"/>
${pts.map((p, i) => `<g><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="10" fill="${c}" stroke="#fff" stroke-width="2"/><text x="${p[0].toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="middle">${i + 1}</text></g>`).join('\n')}
</svg>`
}

export interface ItineraryOptions {
  /** App URL (origin + base path) for "show on map" links */
  appBase: string
}

export function itineraryHtml(doc: MapDoc, opts: ItineraryOptions): string {
  const days = tripDays(doc)
  const dayBlocks = days
    .map((day, di) => {
      const routes = dayRouteUrls(day.stops)
      const routeLinks = routes
        .map((u, i) => `<a class="btn primary" href="${esc(u)}" target="_blank" rel="noopener">מסלול ${routes.length > 1 ? `חלק ${i + 1}` : 'היום'} ב-Google Maps</a>`)
        .join('')
      const stops = day.stops
        .map((s) => {
          const p = s.feature.properties
          const inApp = appFeatureUrl(opts.appBase, doc.driveFileId, p.id)
          return `<li class="stop" data-lat="${s.lat}" data-lng="${s.lng}">
  <div class="num" style="background:${esc(day.layer.color)}">${s.number}</div>
  <div class="body">
    <div class="leg">${s.legMeters ? `${formatDistance(s.legMeters)} מהעצירה הקודמת` : ''}<span class="me"></span></div>
    <h3>${p.icon ? `<span class="icon">${esc(p.icon)}</span> ` : ''}${esc(p.name || 'ללא שם')}</h3>
    ${p.description ? `<p>${richText(stripTags(p.description))}</p>` : ''}
    <div class="links">
      <a class="btn primary" href="${esc(navigateUrl(s))}" target="_blank" rel="noopener">ניווט</a>
      <a class="btn" href="${esc(googleSearchUrl(p.name, s))}" target="_blank" rel="noopener">חפש ב-Google Maps</a>
      ${inApp ? `<a class="btn" href="${esc(inApp)}" target="_blank" rel="noopener">הצג במפה</a>` : ''}
    </div>
  </div>
</li>`
        })
        .join('\n')
      const others = day.others.length
        ? `<p class="others">גם ביום הזה: ${day.others.map((f) => esc(f.properties.name || (f.geometry.type === 'LineString' ? 'קו' : 'אזור'))).join(', ')}</p>`
        : ''
      return `<section class="day" id="day-${di + 1}">
  <header style="border-color:${esc(day.layer.color)}">
    <h2>${esc(day.layer.name)}</h2>
    <div class="meta">${[formatDate(day.layer.day?.date), `${day.stops.length} עצירות`, day.totalMeters ? `${formatDistance(day.totalMeters)} בקו אווירי` : ''].filter(Boolean).join(' | ')}</div>
    <div class="links">${routeLinks}</div>
  </header>
  ${daySketch(day)}
  <ol class="stops">${stops || '<li class="empty">אין עדיין עצירות ביום הזה.</li>'}</ol>
  ${others}
</section>`
    })
    .join('\n')

  const toc = days.length > 1
    ? `<nav class="toc">${days.map((d, i) => `<a href="#day-${i + 1}" style="border-color:${esc(d.layer.color)}">${esc(d.layer.name)}</a>`).join('')}</nav>`
    : ''
  const mapLink = appFeatureUrl(opts.appBase, doc.driveFileId)

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)} — מסלול</title>
<style>
:root{--ink:#17302a;--muted:#5d6f69;--line:#dfe6e3;--bg:#f3f6f5;--card:#fff;--accent:#1f6f5c}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:720px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.75rem;line-height:1.2;margin:8px 0 4px}
.lead{color:var(--muted);margin:0 0 16px}
.toc{display:flex;gap:8px;overflow-x:auto;padding:4px 0 12px;position:sticky;top:0;background:var(--bg);z-index:1}
.toc a{flex:none;padding:6px 12px;border:2px solid;border-radius:999px;color:var(--ink);text-decoration:none;background:var(--card);font-weight:600}
.day{background:var(--card);border-radius:14px;margin:16px 0;overflow:hidden;box-shadow:0 1px 0 var(--line)}
.day header{padding:14px 16px;border-inline-start:6px solid}
.day h2{margin:0;font-size:1.3rem}
.meta{color:var(--muted);font-size:.92rem;margin:2px 0 10px}
.sketch{display:block;width:100%;height:auto;background:#eef3f1}
.sketch text{fill:#fff;font:700 11px system-ui,sans-serif}
.stops{list-style:none;margin:0;padding:0}
.stop{display:flex;gap:12px;padding:14px 16px;border-top:1px solid var(--line)}
.num{flex:none;width:32px;height:32px;border-radius:50%;color:#fff;font-weight:700;display:grid;place-items:center}
.body{min-width:0;flex:1}
.body h3{margin:0;font-size:1.08rem}
.body p{margin:4px 0 0;color:#33463f;overflow-wrap:anywhere}
.leg{font-size:.85rem;color:var(--muted)}
.leg:empty{display:none}
.me{color:var(--accent);font-weight:600}
.leg .me:not(:empty)::before{content:" · "}
.locate{position:fixed;bottom:16px;inset-inline-start:16px;z-index:2;box-shadow:0 4px 14px rgb(0 0 0 / .18)}
.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.btn{display:inline-flex;align-items:center;min-height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-weight:600;background:#fff}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.empty,.others{color:var(--muted);padding:12px 16px;margin:0}
footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:24px}
@media print{body{background:#fff}.toc,.links{display:none}.day{break-inside:avoid;box-shadow:none;border:1px solid var(--line)}}
</style>
</head>
<body>
<main>
<h1>${esc(doc.title)}</h1>
${doc.description ? `<p class="lead">${richText(doc.description)}</p>` : ''}
${mapLink ? `<p><a class="btn" href="${esc(mapLink)}" target="_blank" rel="noopener">פתח את המפה המלאה</a></p>` : ''}
${toc}
${dayBlocks || '<p class="lead">אין ימי טיול במפה הזו. סמן שכבה כ"יום בטיול" כדי לבנות מסלול.</p>'}
${days.length ? '<button class="btn primary locate" id="locate" type="button">הצג מרחק ממני</button>' : ''}
<footer>נוצר ב-MyMaps AI · ${esc(new Date().toLocaleDateString('he-IL'))}</footer>
</main>
<script>
(function(){
  var btn=document.getElementById('locate'); if(!btn||!navigator.geolocation) { if(btn) btn.remove(); return }
  function fmt(m){return m<1000?Math.round(m)+" מ'":(m/1000).toFixed(m<10000?1:0)+' ק"מ'}
  function hav(a,b,c,d){var r=Math.PI/180,x=Math.sin((c-a)*r/2),y=Math.sin((d-b)*r/2),h=x*x+Math.cos(a*r)*Math.cos(c*r)*y*y;return 12742018*Math.asin(Math.min(1,Math.sqrt(h)))}
  function update(p){
    var la=p.coords.latitude, lo=p.coords.longitude, best=null, bestD=1/0;
    document.querySelectorAll('.stop[data-lat]').forEach(function(li){
      var d=hav(la,lo,+li.dataset.lat,+li.dataset.lng); li.querySelector('.me').textContent=fmt(d)+' ממך';
      if(d<bestD){bestD=d;best=li}
    });
    btn.textContent='הכי קרוב אליך: '+(best?best.querySelector('h3').textContent.trim():'');
    btn.onclick=function(){ best&&best.scrollIntoView({behavior:'smooth',block:'center'}) };
  }
  btn.onclick=function(){ btn.textContent='מאתר…'; navigator.geolocation.watchPosition(update,function(){btn.textContent='אין הרשאת מיקום'},{enableHighAccuracy:true,maximumAge:15000}) };
})();
</script>
</body>
</html>
`
}
