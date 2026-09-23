import { useEffect, useRef } from 'react'
import maplibregl, { type Map as MapLibreMap, type LngLatBoundsLike } from 'maplibre-gl'
import type { CommunityReport, Fix, Poi, RouteResult, TripStop } from '../types'
import { type AmbientConfig, type AmbientHandle, createAmbient } from './ambient'
import type { LiveFix } from '../privacy/geo'
import { categoryColor } from '../config/categories'
import { MUMBAI_CENTER } from '../config/localities'
import { locationPuckElement, respectReducedMotion, visitPinElement } from './markers'

/**
 * The map.
 *
 * Tiles come from OpenFreeMap — free, no API key, OpenStreetMap data. It is the
 * only external origin the CSP permits for tiles, and it receives nothing but
 * tile coordinates.
 *
 * Markers are circle layers rather than image sprites: no icon requests to
 * whitelist, and tens of thousands of points stay smooth on a mid-range phone.
 *
 * Layer order matters and is deliberate — rail context at the bottom, then
 * flooding, then the ambient "everything" layer, then the route, then search
 * results, and trip stops on top of everything.
 */

/*
 * Basemap.
 *
 * Liberty is OpenFreeMap's rendering of the familiar OpenStreetMap style —
 * green parks, coloured roads, named places. An earlier version switched to a
 * near-greyscale Positron, and to a dark variant when the device was in dark
 * mode, on the theory that a quiet base makes pins stand out. In practice the
 * dark map read as "the map is broken", and a civic map people use outdoors
 * should look like the map they already know.
 *
 * So: one style, always, regardless of system theme. The UI chrome still
 * follows the theme; the map itself does not.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/* Fixed to the light basemap, since the basemap no longer changes. */
const MAP_INK = '#0f172a'
const MAP_INK_SOFT = '#475569'
const MAP_HALO = '#ffffff'
/* Pin outlines: a ring of the map's own ground colour reads as a cut-out. */
const PIN_RING = '#ffffff'
/* Numbered trip pins, and the label sitting inside them. */
const STOP_PIN = '#0f172a'
const STOP_PIN_INK = '#ffffff'
/* The route line. Deliberately the blue people already read as "your route". */
const ROUTE_BLUE = '#1a73e8'

const SRC_RAIL = 'rail-lines'
const SRC_AMBIENT = 'ambient-pois'
const SRC_RESULTS = 'results'
const SRC_FLOOD_SPOTS = 'flood-spots'
const SRC_FLOOD_REPORTS = 'flood-reports'
const SRC_ROUTE = 'route'
const SRC_STOPS = 'trip-stops'
const SRC_USER = 'user'

/**
 * Below this zoom the ambient layer is hidden. Showing 13,000 pins across the
 * whole city is noise, not information — this is the same call Google Maps
 * makes when it thins detail as you zoom out.
 */
const AMBIENT_MIN_ZOOM = 14

const DEPTH_COLOR: Record<string, string> = {
  ankle: '#fbbf24',
  knee: '#f97316',
  waist: '#dc2626',
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

interface MapViewProps {
  results: Poi[]
  /** Everything loaded into memory — the "click anything" layer. */
  ambientPois: Poi[]
  floodSpots: Poi[]
  floodReports: CommunityReport[]
  tripStops: TripStop[]
  /** Hangout pins: id + venue coordinates only, never a member's position. */
  activities: {
    id: string
    lat: number
    lon: number
    live: boolean
    mine: boolean
    emoji?: string
    creatorAvatar?: string | null
    creatorName?: string | null
  }[]
  /** Event pins, drawn with the event's own emoji. */
  events: { id: string; lat: number; lon: number; emoji: string }[]
  /** Places the viewer has marked as visited. Shown in every mode. */
  visits?: { id: string; lat: number; lon: number }[]
  /** People who have opted into sharing their position. */
  people: { id: string; name: string; avatarUrl: string | null; lat: number; lon: number }[]
  route: RouteResult | null
  userFix: Fix | null
  /** Precise position while navigating. Drives the puck and the follow camera. */
  liveFix: LiveFix | null
  /** Keep the camera on the user as they move. */
  followMe: boolean
  /** Bump to recentre once, without turning following back on. */
  recenterSignal: number
  /**
   * Somewhere to point the camera, independent of the user's own position.
   * `nonce` is what makes it fire: focusing the same place twice in a row is a
   * legitimate thing to ask for, so the coordinates alone cannot be the key.
   */
  focus?: { lat: number; lon: number; nonce: number } | null
  selectedId: string | null
  showFloodLayer: boolean
  showRail: boolean
  /** Clouds, birds, boats, trains and the seasonal overlay. */
  ambient: AmbientConfig
  onSelectPoi: (poi: Poi | null) => void
  onSelectActivity: (id: string) => void
  onSelectEvent: (id: string) => void
  onSelectPerson: (id: string) => void
  onSelectVisit: (id: string) => void
  onPickPoint: (lat: number, lon: number) => void
}

function poiFeature(p: Poi, selectedId: string | null) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
    properties: {
      id: p.id,
      name: p.name ?? '',
      category: p.category,
      color: p.status?.verdict === 'broken' ? '#ef4444' : categoryColor(p.category),
      selected: p.id === selectedId ? 1 : 0,
    },
  }
}

export default function MapView({
  results,
  ambientPois,
  floodSpots,
  floodReports,
  tripStops,
  activities,
  events,
  visits,
  people,
  route,
  userFix,
  liveFix,
  followMe,
  recenterSignal,
  focus,
  selectedId,
  showFloodLayer,
  showRail,
  ambient,
  onSelectPoi,
  onSelectActivity,
  onSelectEvent,
  onSelectPerson,
  onSelectVisit,
  onPickPoint,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const puckRef = useRef<maplibregl.Marker | null>(null)
  const puckArrowRef = useRef<HTMLElement | null>(null)

  // Handlers are registered once, so read the latest props through refs.
  const onSelectRef = useRef(onSelectPoi)
  const ambientCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const ambientFxRef = useRef<AmbientHandle | null>(null)
  const onVisitRef = useRef(onSelectVisit)
  const onPickRef = useRef(onPickPoint)
  const onActivityRef = useRef(onSelectActivity)
  const onEventRef = useRef(onSelectEvent)
  const onPersonRef = useRef(onSelectPerson)
  /** HTML markers for activities, events and people, rebuilt as data changes. */
  const socialMarkersRef = useRef<maplibregl.Marker[]>([])
  const resultsRef = useRef(results)
  const ambientRef = useRef(ambientPois)

  onSelectRef.current = onSelectPoi
  onVisitRef.current = onSelectVisit
  onPickRef.current = onPickPoint
  onActivityRef.current = onSelectActivity
  onEventRef.current = onSelectEvent
  onPersonRef.current = onSelectPerson
  resultsRef.current = results
  ambientRef.current = ambientPois

  /** Run `fn` once the style is ready, whether or not it already is. */
  const whenReady = (map: MapLibreMap, fn: () => void) => {
    if (readyRef.current) fn()
    else map.once('load', fn)
  }

  // --- init (once) ---------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [MUMBAI_CENTER.lon, MUMBAI_CENTER.lat],
      zoom: 11.5,
      attributionControl: false,
      // No geolocate control — location is only requested from our own explicit
      // button, so consent is never ambiguous.
    })
    mapRef.current = map

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          '© OpenStreetMap contributors · MCGM toilet data via opencity.in',
      }),
      'bottom-right'
    )
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    /*
     * MapLibre reports an invalid layer by throwing from addLayer. Because every
     * layer is added in one 'load' handler, a single bad one used to abort the
     * rest — which is how a rejected route layer left the map with a white
     * casing, no pins wired, and no error anywhere obvious. Adding each layer
     * independently means one failure costs one layer, and says so.
     */
    const addLayer = (spec: maplibregl.LayerSpecification) => {
      try {
        map.addLayer(spec)
      } catch (err) {
        console.error(`[map] layer "${spec.id}" was rejected:`, err)
      }
    }

    map.on('error', (e) => console.error('[map]', e.error?.message ?? e))

    map.on('load', () => {
      for (const id of [
        SRC_RAIL,
        SRC_AMBIENT,
        SRC_FLOOD_SPOTS,
        SRC_FLOOD_REPORTS,
        SRC_ROUTE,
        SRC_RESULTS,
        SRC_STOPS,
        SRC_USER,
      ]) {
        map.addSource(id, { type: 'geojson', data: EMPTY })
      }

      // --- rail / metro lines: context for trip planning -------------------
      addLayer({
        id: 'rail-lines',
        type: 'line',
        source: SRC_RAIL,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'colour'], '#6366f1'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 5],
          'line-opacity': 0.55,
        },
      })

      // --- chronic flood spots ---------------------------------------------
      addLayer({
        id: 'flood-spots-halo',
        type: 'circle',
        source: SRC_FLOOD_SPOTS,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 26, 16, 48],
          'circle-color': '#0369a1',
          'circle-opacity': 0.16,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#0369a1',
          'circle-stroke-opacity': 0.4,
        },
      })

      addLayer({
        id: 'flood-reports',
        type: 'circle',
        source: SRC_FLOOD_REPORTS,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 14],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'freshness'],
          'circle-stroke-width': 2,
          'circle-stroke-color': PIN_RING,
        },
      })

      // --- ambient POIs: faint, clickable, zoom-gated -----------------------
      addLayer({
        id: 'ambient-pois',
        type: 'circle',
        source: SRC_AMBIENT,
        minzoom: AMBIENT_MIN_ZOOM,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 7],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.55,
          'circle-stroke-width': 1,
          'circle-stroke-color': PIN_RING,
          'circle-stroke-opacity': 0.7,
        },
      })

      addLayer({
        id: 'ambient-labels',
        type: 'symbol',
        source: SRC_AMBIENT,
        minzoom: 16.5,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 10,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-max-width': 9,
        },
        paint: {
          'text-color': MAP_INK_SOFT,
          'text-halo-color': MAP_HALO,
          'text-halo-width': 1.2,
        },
      })

      // --- route ------------------------------------------------------------
      /*
       * Three layers, not one.
       *
       * `line-dasharray` accepts only zoom expressions in MapLibre — a
       * data-driven `['case', ['get', 'approximate'], …]` makes addLayer reject
       * the layer outright. That is exactly what happened here: the blue line
       * silently failed and only the white casing beneath it drew, so routes
       * appeared as a white ribbon. Solid and dashed are now separate layers
       * chosen by `filter`, which is the supported way to vary a dash.
       */
      addLayer({
        id: 'route-casing',
        type: 'line',
        source: SRC_ROUTE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 13],
          'line-opacity': 0.95,
        },
      })

      // Real walking route.
      addLayer({
        id: 'route-line',
        type: 'line',
        source: SRC_ROUTE,
        filter: ['!=', ['get', 'approximate'], 1],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_BLUE,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9],
        },
      })

      // Straight-line stand-in when routing is unavailable — dashed, so it can
      // never be mistaken for a path you can actually walk.
      addLayer({
        id: 'route-line-approx',
        type: 'line',
        source: SRC_ROUTE,
        filter: ['==', ['get', 'approximate'], 1],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROUTE_BLUE,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9],
          'line-dasharray': [1.4, 1.1],
          'line-opacity': 0.85,
        },
      })

      // --- search results ---------------------------------------------------
      addLayer({
        id: 'results-circles',
        type: 'circle',
        source: SRC_RESULTS,
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            ['case', ['==', ['get', 'selected'], 1], 8, 5],
            16,
            ['case', ['==', ['get', 'selected'], 1], 16, 10],
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 4, 2],
          'circle-stroke-color': PIN_RING,
        },
      })

      addLayer({
        id: 'results-labels',
        type: 'symbol',
        source: SRC_RESULTS,
        minzoom: 15,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 10,
        },
        paint: {
          'text-color': MAP_INK,
          'text-halo-color': MAP_HALO,
          'text-halo-width': 1.5,
        },
      })

      // --- trip stops: numbered, always on top ------------------------------
      addLayer({
        id: 'trip-stops-circle',
        type: 'circle',
        source: SRC_STOPS,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 16],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 3,
          'circle-stroke-color': PIN_RING,
        },
      })
      addLayer({
        id: 'trip-stops-label',
        type: 'symbol',
        source: SRC_STOPS,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': STOP_PIN_INK },
      })

      // --- the user's own (blurred) position --------------------------------
      addLayer({
        id: 'user-accuracy',
        type: 'circle',
        source: SRC_USER,
        paint: {
          // Replaced with the device's real accuracy the moment a fix arrives —
          // see the user-position effect. This is only what it looks like
          // before then.
          'circle-radius': 0,
          'circle-color': '#2563eb',
          'circle-opacity': 0.14,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#2563eb',
          'circle-stroke-opacity': 0.3,
        },
      })
      // The dot itself is a DOM marker, not a layer — see the user-position
      // effect below. A circle layer cannot pulse.

      readyRef.current = true

      // Clicks: results take priority over ambient, since those are what the
      // user just asked for.
      const clickable = ['results-circles', 'trip-stops-circle', 'ambient-pois']
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: clickable.filter((l) => map.getLayer(l)) })
        if (!hits.length) {
          onSelectRef.current(null)
          return
        }
        const id = hits[0].properties?.id as string | undefined
        if (!id) return

        const found =
          resultsRef.current.find((p) => p.id === id) ??
          ambientRef.current.find((p) => p.id === id)
        if (found) onSelectRef.current(found)
      })

      map.on('contextmenu', (e) => onPickRef.current(e.lngLat.lat, e.lngLat.lng))

      for (const layer of clickable) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = ''
        })
      }
    })

    // Long-press to drop a report pin — phones have no right-click.
    let pressTimer: number | undefined
    const canvas = map.getCanvas()
    const startPress = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      pressTimer = window.setTimeout(() => {
        const rect = canvas.getBoundingClientRect()
        const point = map.unproject([touch.clientX - rect.left, touch.clientY - rect.top])
        onPickRef.current(point.lat, point.lng)
      }, 600)
    }
    const cancelPress = () => window.clearTimeout(pressTimer)

    canvas.addEventListener('touchstart', startPress, { passive: true })
    canvas.addEventListener('touchend', cancelPress)
    canvas.addEventListener('touchmove', cancelPress, { passive: true })

    return () => {
      canvas.removeEventListener('touchstart', startPress)
      canvas.removeEventListener('touchend', cancelPress)
      canvas.removeEventListener('touchmove', cancelPress)
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
  }, [])

  // --- ambient layer -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    whenReady(map, () => {
      const src = map.getSource(SRC_AMBIENT) as maplibregl.GeoJSONSource | undefined
      src?.setData({
        type: 'FeatureCollection',
        features: ambientPois.map((p) => poiFeature(p, selectedId)),
      })
    })
  }, [ambientPois, selectedId])

  // --- results -------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    whenReady(map, () => {
      const src = map.getSource(SRC_RESULTS) as maplibregl.GeoJSONSource | undefined
      src?.setData({
        type: 'FeatureCollection',
        features: results.map((p) => poiFeature(p, selectedId)),
      })
    })
  }, [results, selectedId])

  // --- fit to results (not while a trip is showing) ------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !results.length || tripStops.length || followMe) return
    whenReady(map, () => {
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
      for (const p of results) {
        minLat = Math.min(minLat, p.lat)
        maxLat = Math.max(maxLat, p.lat)
        minLon = Math.min(minLon, p.lon)
        maxLon = Math.max(maxLon, p.lon)
      }
      map.fitBounds(
        [
          [minLon, minLat],
          [maxLon, maxLat],
        ] as LngLatBoundsLike,
        { padding: { top: 80, left: 40, right: 40, bottom: 320 }, maxZoom: 16, duration: 600 }
      )
    })
  }, [results, tripStops.length, followMe])

  // --- trip stops and route ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    whenReady(map, () => {
      const stopSrc = map.getSource(SRC_STOPS) as maplibregl.GeoJSONSource | undefined
      const routeSrc = map.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource | undefined

      const placed = tripStops
        .map((stop, i) => {
          const lat = stop.poi?.lat ?? stop.fix?.lat
          const lon = stop.poi?.lon ?? stop.fix?.lon
          if (lat == null || lon == null) return null
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [lon, lat] },
            properties: {
              id: stop.poi?.id ?? stop.id,
              // Origin is "You"; the rest are numbered in travel order.
              label: stop.spec.kind === 'origin' ? '•' : String(i),
              color: stop.spec.kind === 'origin' ? '#0d6e76' : STOP_PIN,
            },
          }
        })
        .filter(Boolean)

      stopSrc?.setData({ type: 'FeatureCollection', features: placed as never[] })

      routeSrc?.setData(
        route
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: route.coordinates },
                  properties: { approximate: route.approximate ? 1 : 0 },
                },
              ],
            }
          : EMPTY
      )

      // Frame the whole journey once it's drawn.
      if (route?.coordinates.length && !followMe) {
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180
        for (const [lon, lat] of route.coordinates) {
          minLat = Math.min(minLat, lat)
          maxLat = Math.max(maxLat, lat)
          minLon = Math.min(minLon, lon)
          maxLon = Math.max(maxLon, lon)
        }
        map.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ] as LngLatBoundsLike,
          { padding: { top: 90, left: 50, right: 50, bottom: 340 }, maxZoom: 16, duration: 700 }
        )
      }
    })
  }, [tripStops, route, followMe])

  /*
   * Activities, events and people are HTML markers rather than circle layers:
   * each needs an emoji or an avatar inside it, which a glyph-based symbol
   * layer cannot draw. The trade is DOM nodes, which is fine at city scale
   * (dozens) and would need clustering at thousands.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const build = () => {
      for (const marker of socialMarkersRef.current) marker.remove()
      socialMarkersRef.current = []

      const pin = (
        content: string,
        classes: string,
        onClick: () => void,
        label: string
      ) => {
        const el = document.createElement('button')
        el.type = 'button'
        el.setAttribute('aria-label', label)
        el.className = classes
        el.textContent = content
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onClick()
        })
        return el
      }

      /*
       * An activity bubble is the person's face with the activity's emoji
       * tucked into the corner — not a generic party popper. Who is going is
       * the thing that makes you tap it; what it is comes second.
       */
      for (const a of activities) {
        const el = document.createElement('button')
        el.type = 'button'
        el.setAttribute('aria-label', a.creatorName ?? 'Activity')
        el.className =
          'relative flex h-12 w-12 items-center justify-center rounded-full bg-white ' +
          'shadow-lg transition-transform hover:scale-110 ' +
          (a.live ? 'ring-[3px] ring-green-500' : 'ring-2 ring-white')

        if (a.creatorAvatar) {
          const img = document.createElement('img')
          img.src = a.creatorAvatar
          img.alt = ''
          img.referrerPolicy = 'no-referrer'
          img.className = 'h-full w-full rounded-full object-cover'
          // A broken avatar should fall back to an initial, not an empty ring.
          img.onerror = () => {
            img.remove()
            el.textContent = (a.creatorName ?? '?').slice(0, 1).toUpperCase()
            el.classList.add('text-base', 'font-semibold', 'text-slate-500')
          }
          el.appendChild(img)
        } else {
          el.textContent = (a.creatorName ?? '?').slice(0, 1).toUpperCase()
          el.classList.add('text-base', 'font-semibold', 'text-slate-500')
        }

        const badge = document.createElement('span')
        badge.className =
          'absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center ' +
          'rounded-full bg-white text-[13px] shadow ring-1 ring-black/10'
        badge.textContent = a.emoji ?? '🎉'
        el.appendChild(badge)

        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onActivityRef.current(a.id)
        })

        socialMarkersRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat([a.lon, a.lat]).addTo(map)
        )
      }

      for (const e of events) {
        const el = pin(
          e.emoji,
          `flex h-11 w-11 items-center justify-center rounded-full bg-white text-xl
           shadow-lg ring-1 ring-black/10 transition-transform hover:scale-110`,
          () => onEventRef.current(e.id),
          'Event'
        )
        socialMarkersRef.current.push(
          new maplibregl.Marker({ element: el }).setLngLat([e.lon, e.lat]).addTo(map)
        )
      }

      /*
       * Visited places get a push-pin stuck into the map. The board is a map
       * you have pinned things to, and a pin carries that; a flat tick read as
       * a status badge on the place rather than as something you put there.
       *
       * Anchored at the bottom because the point of the needle is the
       * coordinate — centre-anchoring would float the location half-way up the
       * pin's head.
       */
      for (const v of visits ?? []) {
        const el = visitPinElement()
        el.addEventListener('click', (e) => {
          // Without this the map's own click handler also fires and offers to
          // drop a second pin on top of the one just tapped.
          e.stopPropagation()
          onVisitRef.current(v.id)
        })
        socialMarkersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([v.lon, v.lat])
            .addTo(map)
        )
      }

      for (const person of people) {
        const el = document.createElement('button')
        el.type = 'button'
        el.setAttribute('aria-label', person.name)
        el.className =
          'h-9 w-9 overflow-hidden rounded-full bg-white shadow ring-2 ring-blue-500 transition-transform hover:scale-110'
        if (person.avatarUrl) {
          const img = document.createElement('img')
          img.src = person.avatarUrl
          img.alt = ''
          img.referrerPolicy = 'no-referrer'
          img.className = 'h-full w-full object-cover'
          el.appendChild(img)
        } else {
          el.className += ' flex items-center justify-center text-xs font-semibold'
          el.textContent = person.name.slice(0, 1).toUpperCase()
        }
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onPersonRef.current(person.id)
        })
        socialMarkersRef.current.push(
          new maplibregl.Marker({ element: el })
            .setLngLat([person.lon, person.lat])
            .addTo(map)
        )
      }
    }

    whenReady(map, build)
  }, [activities, events, visits, people])

  // --- flood layers --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    whenReady(map, () => {
      const spotSrc = map.getSource(SRC_FLOOD_SPOTS) as maplibregl.GeoJSONSource | undefined
      const reportSrc = map.getSource(SRC_FLOOD_REPORTS) as maplibregl.GeoJSONSource | undefined

      spotSrc?.setData({
        type: 'FeatureCollection',
        features: showFloodLayer
          ? floodSpots.map((p) => ({
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
              properties: { id: p.id, name: p.name ?? '' },
            }))
          : [],
      })

      const now = Date.now()
      reportSrc?.setData({
        type: 'FeatureCollection',
        features: showFloodLayer
          ? floodReports.map((r) => {
              // Fade toward expiry so an ageing report visibly loses authority.
              const life = r.expires_at - r.created_at
              const left = Math.max(0, r.expires_at - now)
              return {
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
                properties: {
                  id: r.id,
                  color: r.kind === 'clear' ? '#16a34a' : DEPTH_COLOR[r.depth ?? 'ankle'],
                  freshness: 0.35 + 0.6 * (life ? left / life : 0),
                },
              }
            })
          : [],
      })
    })
  }, [floodSpots, floodReports, showFloodLayer])

  // --- rail lines ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    whenReady(map, () => {
      if (!map.getLayer('rail-lines')) return
      map.setLayoutProperty('rail-lines', 'visibility', showRail ? 'visible' : 'none')
      if (!showRail) return

      const src = map.getSource(SRC_RAIL) as maplibregl.GeoJSONSource | undefined
      if (!src) return
      fetch(`${import.meta.env.BASE_URL}data/rail_lines.geojson`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && src.setData(data))
        .catch(() => {
          /* layer simply stays empty — rail context is optional */
        })
    })
  }, [showRail])

  // --- ambient life --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    const canvas = ambientCanvasRef.current
    if (!map || !canvas) return
    const handle = createAmbient(canvas, map)
    ambientFxRef.current = handle

    /*
     * Trains need the real rail geometry, which is the same lazily-loaded file
     * the rail layer uses. Fetching it here rather than reading it back out of
     * the map source keeps this independent of whether that layer is visible —
     * you can run trains without the tracks drawn under them.
     */
    fetch(`${import.meta.env.BASE_URL}data/rail_lines.geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.features) return
        handle.setRailLines(
          data.features
            .filter((f: { geometry?: { type?: string } }) => f.geometry?.type === 'LineString')
            .map((f: { geometry: { coordinates: [number, number][] }; properties?: { colour?: string } }) => ({
              coords: f.geometry.coordinates,
              colour: f.properties?.colour ?? null,
            }))
        )
      })
      .catch(() => {
        /* no trains, everything else still runs */
      })

    return () => {
      handle.destroy()
      ambientFxRef.current = null
    }
  }, [])

  useEffect(() => {
    ambientFxRef.current?.setConfig(ambient)
  }, [ambient])

  // --- live navigation puck ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!liveFix) {
      puckRef.current?.remove()
      puckRef.current = null
      puckArrowRef.current = null
      return
    }

    if (!puckRef.current) {
      // Same pulsing dot as the idle position, so "you" looks like one thing
      // whether or not a route is running.
      const el = locationPuckElement()
      respectReducedMotion(el)

      // A separate arrow so it can spin without rotating the dot's border.
      const arrow = document.createElement('span')
      arrow.className =
        'absolute -top-2 h-0 w-0 border-x-4 border-b-[7px] border-x-transparent border-b-blue-600 transition-transform duration-300'
      // The arrow sits 8px above a 20px puck, so its own centre of rotation is
      // 18px down from its top edge — i.e. the middle of the dot.
      arrow.style.transformOrigin = '50% 18px'
      el.appendChild(arrow)
      puckArrowRef.current = arrow

      puckRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([liveFix.lon, liveFix.lat])
        .addTo(map)
    } else {
      puckRef.current.setLngLat([liveFix.lon, liveFix.lat])
    }

    if (puckArrowRef.current) {
      // Hide the arrow when the device reports no heading — a fixed arrow that
      // never turns is worse than none.
      puckArrowRef.current.style.opacity = liveFix.heading == null ? '0' : '1'
      if (liveFix.heading != null) {
        puckArrowRef.current.style.transform = `rotate(${liveFix.heading}deg)`
      }
    }
  }, [liveFix])

  // --- follow camera -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !followMe || !liveFix) return
    map.easeTo({
      center: [liveFix.lon, liveFix.lat],
      zoom: Math.max(map.getZoom(), 16),
      duration: 800,
    })
  }, [followMe, liveFix])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !recenterSignal) return
    const target = liveFix ?? userFix
    if (!target) return
    map.easeTo({ center: [target.lon, target.lat], zoom: 16, duration: 600 })
  }, [recenterSignal, liveFix, userFix])

  // --- focus a specific place ----------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    map.easeTo({ center: [focus.lon, focus.lat], zoom: 16, duration: 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])

  // --- user position -------------------------------------------------------
  /*
   * Two pieces: the accuracy blob stays a circle layer, because it has to
   * scale with zoom to mean anything, and the dot on top is a DOM marker so it
   * can pulse. The marker is skipped while turn-by-turn is running — the
   * navigation puck is the same location with a heading, and two dots on one
   * spot just looks broken.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    whenReady(map, () => {
      const src = map.getSource(SRC_USER) as maplibregl.GeoJSONSource | undefined
      src?.setData({
        type: 'FeatureCollection',
        features: userFix
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'Point' as const, coordinates: [userFix.lon, userFix.lat] },
                properties: {},
              },
            ]
          : [],
      })

      if (!map.getLayer('user-accuracy')) return
      /*
       * The blob is the device's reported accuracy drawn to scale, not a
       * decorative glow. A circle layer's radius is in screen pixels, so the
       * metres have to be converted — and the constant for that depends on
       * whether the renderer counts zoom in 256px or 512px tiles, which is a
       * factor of two and easy to get backwards. So it is measured off the map
       * instead of assumed: project two points a known distance apart and see
       * how many pixels the renderer puts between them.
       *
       * Interpolating between two stops is exact because metres-per-pixel is
       * linear in 2^zoom, which is what `exponential` with base 2 gives.
       */
      map.setPaintProperty(
        'user-accuracy',
        'circle-radius',
        userFix
          ? (() => {
              const DEG = 0.01
              const a = map.project([userFix.lon, userFix.lat])
              const b = map.project([userFix.lon + DEG, userFix.lat])
              const dx = Math.abs(b.x - a.x)
              const metres = 111_320 * DEG * Math.cos((userFix.lat * Math.PI) / 180)
              if (!dx || !Number.isFinite(dx)) return 8

              const metresPerPixelNow = metres / dx
              const perPixelAtZ0 = metresPerPixelNow * 2 ** map.getZoom()
              // A floor, because a 5m fix on a city-wide view is a circle too
              // small to see and reads as a rendering bug.
              const px = (z: number) =>
                Math.max(3, (userFix.precisionM * 2 ** z) / perPixelAtZ0)
              return ['interpolate', ['exponential', 2], ['zoom'], 8, px(8), 20, px(20)]
            })()
          : 0
      )
    })
  }, [userFix])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!userFix || liveFix) {
      userMarkerRef.current?.remove()
      userMarkerRef.current = null
      return
    }

    if (!userMarkerRef.current) {
      const el = locationPuckElement()
      respectReducedMotion(el)
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([userFix.lon, userFix.lat])
        .addTo(map)
    } else {
      userMarkerRef.current.setLngLat([userFix.lon, userFix.lat])
    }
  }, [userFix, liveFix])


  return (
    <>
      {/*
        The weather is declared here and applied in CSS, to the map's canvas
        alone — see the note in index.css. Filtering this element instead would
        also filter the zoom buttons and every marker inside it.
      */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        data-weather={ambient.weather ?? undefined}
      />
      {/* Above the map, below every control: decoration must never eat a tap. */}
      <canvas
        ref={ambientCanvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[5]"
      />
    </>
  )
}
