import { useCallback, useEffect, useRef, useState } from 'react'
import MapView from './map/MapView'
import AskPanel from './chat/AskPanel'
import ModeTabs from './ui/ModeTabs'
import AmbientControls from './map/AmbientControls'
import LocateButton from './map/LocateButton'
import { AMBIENT_OFF, type AmbientConfig } from './map/ambient'
import ReportSheet, { type ReportTarget } from './report/ReportSheet'
import PrivacyDialog from './privacy/PrivacyDialog'
import DetailPanel from './detail/DetailPanel'
import TripPanel from './trip/TripPanel'
import Icon, { type IconName } from './ui/Icon'
import type {
  CommunityReport,
  Fix,
  Poi,
  RouteResult,
  TripStop,
} from './types'
import { EAGER_CATEGORIES } from './config/categories'
import { MUMBAI_CENTER } from './config/localities'
import {
  DataUnavailableError,
  allLoadedPois,
  loadCategory,
  geocode,
  searchWidening,
} from './search/localIndex'
import { localTripInterpret } from './search/parseQuery'
import { interpret, moodLabel } from './search/interpret'
import { rank } from './search/rank'
import { fetchReports, floodReports as liveFloodReports, mergeStatus } from './reports/api'
import {
  GeoError,
  type LiveFix,
  requestFix,
  requestPreciseFix,
  watchLive,
} from './privacy/geo'
import NavPanel from './nav/NavPanel'
import {
  type NavPlace,
  type NavState,
  advance,
  planFrom,
  startNavigation,
} from './nav/navigation'
import { TransitUnavailable } from './nav/transit'
import { buildTrip, isTripComplete, rechooseStop, routablePoints } from './trip/plan'
import { RoutingError, type TravelMode, fetchRoute } from './trip/routing'

import VisitSheet from './board/VisitSheet'
import VisitCard from './board/VisitCard'
import BoardScreen from './board/BoardScreen'
import {
  createVisit as createVisitOnServer,
  deleteVisit as deleteVisitOnServer,
  listVisits as listVisitsFromServer,
} from './board/api'
import { migrateLocalVisits } from './board/store'
import type { Visit, VisitDraft } from './board/types'
import type { PreparedPhoto } from './board/photos'
import HangoutHome from './hangout/HangoutHome'
import ActivitySheet from './hangout/ActivitySheet'
import CreateFlow from './hangout/CreateFlow'
import ChatRoom from './hangout/ChatRoom'
import DmConversation from './hangout/DmConversation'
import AccountPrompt from './hangout/AccountPrompt'
import FirstRunProfile from './hangout/FirstRunProfile'
import EventsHome, { type Horizon, withinHorizon } from './events/EventsHome'
import EventSheet from './events/EventSheet'
import CreateEvent from './events/CreateEvent'
import {
  type ActivityCategory,
  type ActivitySummary,
  type DmThread,
  type EventCategory,
  type EventSummary,
  type Me,
  type Person,
  HangoutError,
  fetchMe,
  getProfile,
  isLive,
  listActivities,
  listEvents,
  listPeople,
  openThread,
  refreshEvents,
  shareLocation,
  stopSharingLocation,
} from './hangout/api'

/**
 * One page, three modes.
 *
 * Ask, Hangout and Events share a single map and a single account. The split
 * into separate apps is gone: switching mode swaps the panel and what the map
 * is showing, not the page you're on.
 *
 * Accounts are demanded late — you can search, route, browse activities and
 * read what's on with none. The prompt appears the first time you try to do
 * something involving another person.
 */

type Mode = 'ask' | 'hangout' | 'events'

const MODES: { key: Mode; label: string; icon: IconName }[] = [
  { key: 'ask', label: 'Ask map', icon: 'sparkle' },
  { key: 'hangout', label: 'Hang out', icon: 'bench' },
  { key: 'events', label: 'Events', icon: 'sparkle' },
]

/** Fallback radius when the user hasn't named an area or shared a location. */
const CITYWIDE_RADIUS_M = 12000
const REFRESH_MS = 30_000
const PRESENCE_MS = 60_000

/*
 * Same places, same community verdicts.
 *
 * mergeStatus rebuilds the list every time it runs, and the weights inside a
 * status decay continuously — so value equality would always say "changed".
 * Only what is actually shown, the verdict and when it was last reported,
 * counts as a change.
 */
function sameStatuses(a: Poi[], b: Poi[]): boolean {
  return (
    a.length === b.length &&
    a.every((poi, i) => {
      const other = b[i]
      return (
        poi.id === other.id &&
        poi.status?.verdict === other.status?.verdict &&
        poi.status?.lastReportAt === other.status?.lastReportAt
      )
    })
  )
}

export default function App() {
  const [mode, setMode] = useState<Mode>('ask')


  // --- ask ----------------------------------------------------------------
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Poi[]>([])
  const [ambient, setAmbient] = useState<Poi[]>([])
  const [explanations, setExplanations] = useState<Record<string, string[]>>({})
  const [askChips, setAskChips] = useState<{ key: string; label: string }[]>([])
  const [askNotice, setAskNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Poi | null>(null)

  // --- civic layers --------------------------------------------------------
  const [reports, setReports] = useState<CommunityReport[]>([])
  const [floodSpots, setFloodSpots] = useState<Poi[]>([])
  const [showFlood, setShowFlood] = useState(false)
  const [showRail, setShowRail] = useState(false)
  /**
   * Life on the map. Persisted, because it is a preference about how the app
   * looks rather than transient state — turning the trains on once should
   * survive a reload.
   */
  const [ambientFx, setAmbientFx] = useState<AmbientConfig>(() => {
    try {
      const saved = localStorage.getItem('ambient')
      if (saved) return { ...AMBIENT_OFF, ...JSON.parse(saved) }
    } catch {
      /* private mode, blocked storage — defaults are fine */
    }
    return AMBIENT_OFF
  })

  // --- trip ----------------------------------------------------------------
  const [tripStops, setTripStops] = useState<TripStop[]>([])
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)

  // --- navigation ----------------------------------------------------------
  const [nav, setNav] = useState<NavState | null>(null)
  const [liveFix, setLiveFix] = useState<LiveFix | null>(null)
  const [followMe, setFollowMe] = useState(true)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const [locating, setLocating] = useState(false)
  const [focus, setFocus] = useState<{ lat: number; lon: number; nonce: number } | null>(null)
  const [startingNav, setStartingNav] = useState(false)

  const [userFix, setUserFix] = useState<Fix | null>(null)
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  // --- account -------------------------------------------------------------
  const [me, setMe] = useState<Me | null>(null)
  const [googleConfigured, setGoogleConfigured] = useState(false)
  const [devAllowed, setDevAllowed] = useState(false)
  /**
   * Shown once, immediately after a first sign-in, with whatever they were
   * trying to do held until it closes.
   */
  const [firstRun, setFirstRun] = useState<{ me: Me; purpose: string | null; then: () => void } | null>(
    null
  )
  const [accountPrompt, setAccountPrompt] = useState<{
    purpose: string
    then: () => void
  } | null>(null)

  // --- hangout -------------------------------------------------------------
  const [activities, setActivities] = useState<ActivitySummary[]>([])
  const [activityFilter, setActivityFilter] = useState<ActivityCategory | 'all'>('all')
  const [activitiesLoading, setActivitiesLoading] = useState(false)
  const [activitiesError, setActivitiesError] = useState<string | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [openActivity, setOpenActivity] = useState<string | null>(null)
  const [creatingActivity, setCreatingActivity] = useState(false)

  // --- events --------------------------------------------------------------
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventCategory, setEventCategory] = useState<EventCategory | 'all'>('all')
  const [eventsFree, setEventsFree] = useState(false)
  /** A specific day, YYYY-MM-DD, or null for no date filter. */
  const [eventDate, setEventDate] = useState<string | null>(null)
  const [eventHorizon, setEventHorizon] = useState<Horizon>('all')
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [refreshingEvents, setRefreshingEvents] = useState(false)
  const [openEvent, setOpenEvent] = useState<string | null>(null)
  const [creatingEvent, setCreatingEvent] = useState(false)

  // --- board ---------------------------------------------------------------
  const [visits, setVisits] = useState<Visit[]>([])
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsError, setVisitsError] = useState<string | null>(null)
  const [visitTarget, setVisitTarget] = useState<{
    label: string
    lat: number
    lon: number
    poiId?: string | null
    category?: string | null
  } | null>(null)
  const [openVisit, setOpenVisit] = useState<Visit | null>(null)
  const [boardOpen, setBoardOpen] = useState(false)
  const [savingVisit, setSavingVisit] = useState(false)
  const [visitSaveError, setVisitSaveError] = useState<string | null>(null)

  // --- chat surfaces -------------------------------------------------------
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)
  const [openDm, setOpenDm] = useState<DmThread | null>(null)
  const [chatRefresh, setChatRefresh] = useState(0)
  const [person, setPerson] = useState<{
    id: string
    name: string
    avatarUrl: string | null
    age: number | null
    city: string | null
    bio: string | null
  } | null>(null)

  const reportsRef = useRef<CommunityReport[]>([])
  reportsRef.current = reports

  const refreshAmbient = useCallback(() => setAmbient(allLoadedPois()), [])

  /*
   * The open place card belongs to the mode it was opened in. It sits ahead of
   * every mode's panel in the bottom-panel chain, so leaving it up across a
   * switch means the mode you switched to never gets to mount.
   */
  const changeMode = useCallback((next: Mode) => {
    setMode(next)
    setSelected(null)
  }, [])

  // ==========================================================================
  // Startup
  // ==========================================================================
  useEffect(() => {
    Promise.all(
      EAGER_CATEGORIES.map((category) =>
        loadCategory(category).catch(() => {
          setBanner('Map data is missing. Run `npm run data`, then reload.')
          return []
        })
      )
    ).then(refreshAmbient)
  }, [refreshAmbient])

  // Show the user where they are the moment the map opens.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const fix = await requestPreciseFix()
        if (cancelled) return
        setLiveFix(fix)
        setUserFix({
          lat: fix.lat,
          lon: fix.lon,
          precisionM: fix.accuracyM,
        })
        setRecenterSignal((n) => n + 1)
      } catch {
        // Denied or unavailable: the map still works.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const { user, configured, devLogin } = await fetchMe()
        setMe(user)
        setGoogleConfigured(configured)
        setDevAllowed(devLogin)
      } catch {
        /* the map works signed out */
      }
    })()
  }, [])

  const refreshReports = useCallback(async () => {
    try {
      setReports(await fetchReports())
    } catch {
      /* baseline data is still usable */
    }
  }, [])

  useEffect(() => {
    void refreshReports()
    const timer = window.setInterval(refreshReports, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [refreshReports])

  /*
   * Reports refresh every five minutes. A fresh array identity each time makes
   * the map re-fit its camera under someone who has panned away, so the old
   * array is kept unless a verdict actually moved.
   */
  useEffect(() => {
    setResults((prev) => {
      if (!prev.length) return prev
      const next = mergeStatus(prev, reports)
      return sameStatuses(prev, next) ? prev : next
    })
  }, [reports])

  useEffect(() => {
    if (!showFlood || floodSpots.length) return
    loadCategory('flood_spot')
      .then(setFloodSpots)
      .catch(() => setBanner('Flood-spot data is missing. Run `npm run data`.'))
  }, [showFlood, floodSpots.length])

  // ==========================================================================
  // Accounts
  // ==========================================================================
  const reloadMe = useCallback(async () => {
    try {
      const { user } = await fetchMe()
      setMe(user)
      return user
    } catch {
      return null
    }
  }, [])

  /** Run an action, asking for an account first if there isn't one. */
  const withAccount = useCallback(
    (purpose: string, action: () => void) => {
      if (me) {
        action()
        return
      }
      setAccountPrompt({ purpose, then: action })
    },
    [me]
  )

  // ==========================================================================
  // Hangout + events data
  // ==========================================================================
  const refreshActivities = useCallback(async () => {
    setActivitiesLoading(true)
    try {
      const [{ activities: rows }, { people: nearby }] = await Promise.all([
        listActivities({ category: activityFilter === 'all' ? null : activityFilter }),
        me ? listPeople().catch(() => ({ people: [] as Person[] })) : Promise.resolve({ people: [] as Person[] }),
      ])
      setActivities(rows)
      setPeople(nearby)
      setActivitiesError(null)
    } catch (err) {
      // Signed-out browsing of activities is expected to 401; that isn't an error
      // worth showing, it's just an empty board with a reason.
      if (err instanceof HangoutError && err.code === 'sign_in_required') {
        setActivities([])
        setActivitiesError(null)
      } else {
        setActivitiesError(
          err instanceof HangoutError ? err.message : 'Could not load activities.'
        )
      }
    } finally {
      setActivitiesLoading(false)
    }
  }, [activityFilter, me])

  /*
   * Presence reaches the refresher through this ref: refreshActivities is
   * rebuilt whenever the category filter changes, and a filter tap must not
   * tear your location sharing down and immediately re-share it.
   */
  const refreshActivitiesRef = useRef(refreshActivities)
  refreshActivitiesRef.current = refreshActivities

  const refreshEventList = useCallback(async () => {
    setEventsLoading(true)
    try {
      const { events: rows } = await listEvents({
        category: eventCategory === 'all' ? null : eventCategory,
        freeOnly: eventsFree,
        date: eventDate,
      })
      setEvents(rows)
      setEventsError(null)
    } catch (err) {
      setEventsError(err instanceof HangoutError ? err.message : 'Could not load events.')
    } finally {
      setEventsLoading(false)
    }
  }, [eventCategory, eventsFree, eventDate])

  useEffect(() => {
    if (mode !== 'hangout') return
    void refreshActivities()
    const timer = window.setInterval(refreshActivities, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [mode, refreshActivities])

  useEffect(() => {
    if (mode !== 'events') return
    void refreshEventList()
  }, [mode, refreshEventList])

  const doRefreshEvents = useCallback(async () => {
    setRefreshingEvents(true)
    try {
      const result = await refreshEvents()
      await refreshEventList()
      if (result.error === 'not_configured') {
        setBanner(
          'Ticketmaster is not configured, so only member posts and the curated list are shown.'
        )
        window.setTimeout(() => setBanner(null), 6000)
      }
    } catch (err) {
      setEventsError(err instanceof HangoutError ? err.message : 'Could not refresh.')
    } finally {
      setRefreshingEvents(false)
    }
  }, [refreshEventList])

  // ==========================================================================
  // Presence
  // ==========================================================================
  /**
   * Appear on the map while you are signed in and looking at Hangout.
   *
   * This used to be a switch in the profile, which was the only thing that
   * ever turned presence on — so removing the switch would have left a
   * one-way mirror where you could see everyone else's bubble and nobody
   * could see yours. The whole point of the Hangout tab is being findable by
   * the people around you, so it is simply on while you are in it, and off
   * the moment you leave or sign out.
   */
  useEffect(() => {
    if (!me || mode !== 'hangout') {
      // No await: this is cleanup, and it expires server-side within the hour
      // regardless.
      void stopSharingLocation().catch(() => {})
      return
    }

    let alive = true
    const push = async () => {
      try {
        const fix = await requestFix()
        if (alive) await shareLocation(fix.lat, fix.lon)
      } catch {
        // Location refused or unavailable — you stay invisible, which is a
        // fine outcome and not worth a banner every minute.
      }
    }
    void push().then(() => {
      if (alive) void refreshActivitiesRef.current()
    })
    const timer = window.setInterval(push, PRESENCE_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
      void stopSharingLocation().catch(() => {})
    }
  }, [me, mode])

  // ==========================================================================
  // Navigation
  // ==========================================================================
  const beginNavigation = useCallback(
    async (
      destination: NavPlace,
      waypoints: NavPlace[] = [],
      travelMode: TravelMode = 'walk'
    ) => {
      setStartingNav(true)
      setBanner(null)
      try {
        const fix = liveFix ?? (await requestPreciseFix())
        setLiveFix(fix)
        setNav(await startNavigation(fix, destination, waypoints, travelMode))
        setFollowMe(true)
        setSelected(null)
        setOpenEvent(null)
      } catch (err) {
        setBanner(
          err instanceof GeoError || err instanceof TransitUnavailable
            ? err.message
            : 'Could not start navigation. Check your location permission.'
        )
        window.setTimeout(() => setBanner(null), 6000)
      } finally {
        setStartingNav(false)
      }
    },
    [liveFix]
  )

  const stopNavigation = useCallback(() => {
    setNav(null)
    setFollowMe(false)
  }, [])

  useEffect(() => {
    if (!nav) return
    return watchLive(
      (fix) => {
        setLiveFix(fix)
        setNav((prev) => (prev ? advance(prev, fix) : prev))
      },
      (err) => setBanner(err.message)
    )
  }, [nav !== null])

  const offRouteSince = useRef<number | null>(null)
  useEffect(() => {
    if (!nav || nav.arrived || nav.recalculating || !nav.offRoute) {
      offRouteSince.current = null
      return
    }
    if (offRouteSince.current === null) {
      offRouteSince.current = Date.now()
      return
    }
    // Eight seconds off the line is a wrong turn; two is GPS drift.
    if (Date.now() - offRouteSince.current < 8000) return

    offRouteSince.current = null
    const fix = nav.fix
    if (!fix) return

    setNav((prev) => (prev ? { ...prev, recalculating: true } : prev))
    void (async () => {
      try {
        const fresh = await planFrom(fix, nav.waypoints, nav.destination, nav.mode)
        setNav((prev) =>
          prev ? advance({ ...prev, route: fresh, recalculating: false, error: null }, fix) : prev
        )
      } catch {
        setNav((prev) =>
          prev ? { ...prev, recalculating: false, error: 'Could not recalculate.' } : prev
        )
      }
    })()
  }, [nav])

  // ==========================================================================
  // Trips (walking itineraries from Ask)
  // ==========================================================================
  const drawRoute = useCallback(async (stops: TripStop[]) => {
    if (!isTripComplete(stops)) {
      setRoute(null)
      return
    }
    const points = routablePoints(stops)
    if (points.length < 2) {
      setRoute(null)
      return
    }
    setRouting(true)
    setRouteError(null)
    try {
      setRoute(await fetchRoute(points))
    } catch (err) {
      setRoute(null)
      setRouteError(err instanceof RoutingError ? err.message : 'Could not work out a route.')
    } finally {
      setRouting(false)
    }
  }, [])

  const chooseStop = useCallback(
    async (stopId: string, poi: Poi) => {
      const updated = await rechooseStop(tripStops, stopId, poi)
      setTripStops(updated)
      void drawRoute(updated)
    },
    [tripStops, drawRoute]
  )

  const clearChoice = useCallback(
    (stopId: string) => {
      setTripStops(tripStops.map((s) => (s.id === stopId ? { ...s, poi: null } : s)))
      setRoute(null)
      setRouteError(null)
    },
    [tripStops]
  )

  const clearTrip = useCallback(() => {
    setTripStops([])
    setRoute(null)
    setRouteError(null)
  }, [])

  const goToPoi = useCallback(
    (poi: Poi, travelMode: TravelMode = 'walk') => {
      void beginNavigation(
        { id: poi.id, name: poi.name ?? 'Destination', lat: poi.lat, lon: poi.lon },
        [],
        travelMode
      )
    },
    [beginNavigation]
  )

  const goTrip = useCallback(() => {
    const places: NavPlace[] = tripStops
      .filter((s) => s.poi)
      .map((s) => ({
        id: s.poi!.id,
        name: s.poi!.name ?? s.label,
        lat: s.poi!.lat,
        lon: s.poi!.lon,
      }))
    if (!places.length) return
    void beginNavigation(places[places.length - 1], places.slice(0, -1))
  }, [tripStops, beginNavigation])

  // ==========================================================================
  // Ask
  // ==========================================================================
  const askQuestion = useCallback(
    async (question: string) => {
      setBusy(true)
      changeMode('ask')
      setAskNotice(null)

      try {
        /*
         * Multi-stop journeys are still their own path, because a trip is a
         * sequence of searches rather than one. Everything else goes through
         * the local interpreter and ranker — no network call, no quota.
         */
        const trip = localTripInterpret(question)
        if (trip && trip.mode === 'trip' && trip.stops.length > 1) {
          const stops = await buildTrip(trip.stops, { userFix })
          refreshAmbient()
          setTripStops(stops)
          setRoute(null)
          setRouteError(null)
          const shown = stops.flatMap((s) => (s.poi ? [s.poi] : s.options.slice(0, 8)))
          setResults(mergeStatus(shown, reportsRef.current))
          setExplanations({})
          setAskChips([])
          setSelected(null)
          if (isTripComplete(stops)) void drawRoute(stops)
          return
        }

        const read = interpret(question)

        if (read.empty) {
          setResults([])
          setExplanations({})
          setAskChips([])
          setAskNotice(
            'Try a mood — chill, coffee, by the water — or name a kind of place: water, toilet, pharmacy, food, park.'
          )
          return
        }

        /*
         * The layer toggles are gone, so the layers follow the question
         * instead: ask about flooding and the flood overlay appears, ask about
         * stations and the rail lines do. One less thing to know about.
         */
        if (read.categories.includes('flood_spot')) setShowFlood(true)
        if (read.categories.includes('transit')) setShowRail(true)

        const locality = read.area
        const center = locality ?? userFix ?? MUMBAI_CENTER
        const radius = locality?.radiusM ?? (userFix ? 2500 : CITYWIDE_RADIUS_M)

        // Pull a generous pool; the ranker, not the radius, decides what wins.
        const pool = await searchWidening({
          categories: read.categories,
          center: { lat: center.lat, lon: center.lon },
          radiusM: radius,
          filters: read.filters,
          limit: 400,
        })

        const withStatus = mergeStatus(pool.results, reportsRef.current)
        const ranked = rank({
          pois: withStatus,
          center: { lat: center.lat, lon: center.lon },
          moods: read.moods,
          text: read.text,
          limit: 24,
        })

        /*
         * Nothing local, but the user typed a name — fall through to the
         * geocoder. "Kitab Khana" is shop=books, a category we never baked and
         * never could, so an empty local result is not evidence of absence.
         */
        let final = ranked
        let viaGeocoder = false
        if (ranked.length === 0 && read.text) {
          const hits = await geocode(read.text)
          if (hits.length) {
            viaGeocoder = true
            final = hits.map((poi) => ({
              poi,
              label: poi.name ?? 'Unnamed place',
              score: 0,
              why: [poi.subtype?.split('=')[1]?.replace(/_/g, ' ') ?? 'place'],
              distanceM: null,
            }))
          }
        }

        refreshAmbient()
        setResults(final.map((r) => r.poi))
        setExplanations(Object.fromEntries(final.map((r) => [r.poi.id, r.why])))
        setSelected(null)

        // What the parser understood, shown back as removable chips.
        setAskChips([
          ...read.moods.map((k) => ({ key: `mood:${k}`, label: moodLabel(k) })),
          ...(read.area ? [{ key: 'area', label: read.area.name }] : []),
          ...(read.text ? [{ key: 'text', label: read.text }] : []),
        ])

        setAskNotice(
          final.length === 0
            ? 'Nothing matched that. Mumbai’s map data is patchy — try a wider area or a different mood.'
            : viaGeocoder
              ? 'Not in our own data — found by searching OpenStreetMap.'
              : null
        )
      } catch (err) {
        setAskNotice(
          err instanceof DataUnavailableError
            ? "I couldn't load the map data for that."
            : `Something went wrong: ${(err as Error).message}`
        )
      } finally {
        setBusy(false)
      }
    },
    [userFix, drawRoute, refreshAmbient, changeMode]
  )

  /**
   * The map's own locate button.
   *
   * This replaced a toggle that cleared your position on a second press.
   * Pressing a "my location" control when you are already located means "take
   * me back to it", never "forget where I am" — and since the same handler now
   * backs both this and the icon in the Ask Map search bar, the two cannot
   * drift apart. Always recentres, and re-reads the position rather than
   * trusting a fix that may be minutes old.
   */
  const locateMe = useCallback(async () => {
    setLocating(true)
    try {
      const fix = await requestFix()
      setUserFix(fix)
      setRecenterSignal((n) => n + 1)
    } catch (err) {
      setBanner(err instanceof GeoError ? err.message : 'Could not get your location.')
      window.setTimeout(() => setBanner(null), 5000)
    } finally {
      setLocating(false)
    }
  }, [])

  // ==========================================================================
  // People and rooms
  // ==========================================================================
  const showPerson = useCallback(async (userId: string) => {
    try {
      setPerson(await getProfile(userId))
    } catch {
      setBanner('Could not open that profile.')
    }
  }, [])

  const openRoom = useCallback((roomId: string) => {
    setOpenDm(null)
    setOpenActivity(null)
    setOpenEvent(null)
    setOpenRoomId(roomId)
  }, [])

  const messagePerson = useCallback(
    async (userId: string) => {
      if (!me) {
        setAccountPrompt({ purpose: 'message people', then: () => void messagePerson(userId) })
        return
      }
      try {
        const { threadId } = await openThread(userId)
        const profile = await getProfile(userId)
        setPerson(null)
        setOpenRoomId(null)
        setOpenDm({
          id: threadId,
          otherId: userId,
          otherName: profile.name,
          otherAvatar: profile.avatarUrl,
          lastBody: null,
          lastAt: Date.now(),
        })
      } catch (err) {
        setBanner(err instanceof HangoutError ? err.message : 'Could not open the chat.')
      }
    },
    [me]
  )

  // --- board ---------------------------------------------------------------

  /** Point the shared map at a place and get out of the way of it. */
  function focusPlace(lat: number, lon: number) {
    setFocus({ lat, lon, nonce: Date.now() })
  }

  /*
   * Visits belong to an account, not to a browser.
   *
   * They used to live only in IndexedDB, which meant the green pins stayed on
   * the map after signing out and anyone else on the same machine could see
   * where you had been. Signed out, there is nothing to show.
   */
  useEffect(() => {
    let alive = true
    if (!me) {
      setVisits([])
      setVisitsError(null)
      return
    }

    setVisitsLoading(true)
    void (async () => {
      /*
       * Anything saved before sign-in existed is lifted to this account once —
       * on its own, because IndexedDB may not be there at all (private window,
       * blocked storage) and a board that lives on the server must still load.
       */
      try {
        const moved = await migrateLocalVisits((draft, photos) =>
          createVisitOnServer(draft, photos as never)
        )
        if (moved > 0 && alive) {
          setBanner(`Moved ${moved} saved ${moved === 1 ? 'place' : 'places'} to your account`)
          window.setTimeout(() => setBanner(null), 3000)
        }
      } catch {
        /* nothing local to lift, or nowhere to lift it from */
      }

      try {
        const { visits: rows } = await listVisitsFromServer()
        if (alive) setVisits(rows)
      } catch {
        if (alive) setVisitsError('Could not load your places.')
      } finally {
        if (alive) setVisitsLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [me])

  async function handleDeleteVisit(visit: Visit) {
    setOpenVisit(null)
    setVisits((prev) => prev.filter((v) => v.id !== visit.id))
    try {
      await deleteVisitOnServer(visit.id)
    } catch {
      setBanner('Could not delete that one.')
      window.setTimeout(() => setBanner(null), 2500)
    }
  }

  async function handleSaveVisit(draft: VisitDraft, photos: PreparedPhoto[]) {
    setSavingVisit(true)
    setVisitSaveError(null)
    try {
      const { photoFailures } = await createVisitOnServer(draft, photos)
      const { visits: rows } = await listVisitsFromServer()
      setVisits(rows)
      setVisitTarget(null)
      /*
       * One banner, because two set in the same tick means only the second is
       * ever seen — and the one being lost was the bad news. Self-clearing: the
       * old call left "Added … to My Map" pinned over the map until something
       * else happened to replace it.
       */
      setBanner(
        photoFailures > 0
          ? `Added ${draft.label} to My Map — ${photoFailures} photo${
              photoFailures === 1 ? '' : 's'
            } did not upload`
          : `Added ${draft.label} to My Map`
      )
      window.setTimeout(() => setBanner(null), photoFailures > 0 ? 4000 : 2500)
    } catch {
      setVisitSaveError('Could not save that. Your photos are still here — try again.')
    } finally {
      setSavingVisit(false)
    }
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  // A conversation owns the whole screen.
  if (openRoomId) {
    return (
      <ChatRoom
        roomId={openRoomId}
        onBack={() => {
          setOpenRoomId(null)
          setChatRefresh((n) => n + 1)
        }}
        onOpenProfile={showPerson}
      />
    )
  }

  if (openDm) {
    return (
      <DmConversation
        thread={openDm}
        onBack={() => {
          setOpenDm(null)
          setChatRefresh((n) => n + 1)
        }}
        onBlocked={() => {
          setOpenDm(null)
          setChatRefresh((n) => n + 1)
        }}
      />
    )
  }

  const tripPanel =
    tripStops.length > 0 ? (
      <TripPanel
        stops={tripStops}
        route={route}
        routing={routing}
        error={routeError}
        onChoose={chooseStop}
        onClearChoice={clearChoice}
        onSelectPoi={setSelected}
        onClear={clearTrip}
        onGo={goTrip}
        goBusy={startingNav}
      />
    ) : undefined

  /** Pins the map shows, by mode. */
  const mapActivities =
    mode === 'hangout'
      ? activities.map((a) => ({
          id: a.id,
          emoji: a.emoji,
          creatorAvatar: a.creatorAvatar,
          creatorName: a.creatorName,
          lat: a.lat,
          lon: a.lon,
          live: isLive(a),
          mine: a.isMine,
        }))
      : []

  /*
   * Filtered once, here, so the pins and the list can never disagree. When the
   * horizon lived inside EventsHome the map still showed every event, which
   * made "Today" and "This week" look like they did nothing at all to anyone
   * watching the map rather than the strip.
   */
  const shownEvents = withinHorizon(events, eventHorizon)

  const mapEvents =
    mode === 'events'
      ? shownEvents.map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, emoji: e.emoji }))
      : []

  const navStops: TripStop[] = nav
    ? [...nav.waypoints, nav.destination].map((place, i) => ({
        id: `nav-${place.id}-${i}`,
        spec: { kind: 'place', name: place.name },
        label: place.name,
        poi: {
          id: place.id,
          name: place.name,
          lat: place.lat,
          lon: place.lon,
          category: 'transit',
          source: 'osm',
          tags: {},
        },
        options: [],
      }))
    : []


  return (
    <main className="relative h-full w-full overflow-hidden">
      <MapView
        results={mode === 'ask' ? results : []}
        ambientPois={mode === 'ask' ? ambient : []}
        floodSpots={floodSpots}
        floodReports={liveFloodReports(reports)}
        tripStops={nav ? navStops : mode === 'ask' ? tripStops : []}
        activities={mapActivities}
        events={mapEvents}
        visits={
          // Ask map only: next to activity or event pins this would be a third
          // pin vocabulary competing for the same space.
          mode === 'ask' ? visits.map((v) => ({ id: v.id, lat: v.lat, lon: v.lon })) : []
        }
        people={mode === 'hangout' ? people : []}
        route={nav ? nav.route : route}
        userFix={userFix}
        liveFix={liveFix}
        followMe={Boolean(nav) && followMe}
        recenterSignal={recenterSignal}
        focus={focus}
        selectedId={selected?.id ?? null}
        showFloodLayer={showFlood}
        showRail={showRail}
        ambient={ambientFx}
        onSelectPoi={setSelected}
        onSelectActivity={(id) => {
          changeMode('hangout')
          setOpenActivity(id)
        }}
        onSelectEvent={(id) => {
          changeMode('events')
          setOpenEvent(id)
        }}
        onSelectPerson={showPerson}
        onSelectVisit={(id) => {
          const hit = visits.find((v) => v.id === id)
          if (hit) setOpenVisit(hit)
        }}
        onPickPoint={(lat, lon) => {
          /*
           * Tapping empty map used to open a flooding report. Marking a place
           * you have been is the far more common intent, so that is what the
           * tap does now; reporting stays on the place card where it belongs.
           */
          const target = { label: 'Dropped pin', lat, lon, poiId: null, category: null }
          if (me) setVisitTarget(target)
          else
            setAccountPrompt({
              purpose: 'keep a board of places you’ve been',
              then: () => setVisitTarget(target),
            })
        }}
      />

      {/* --- mode switcher --- */}
      {!nav && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
          <ModeTabs tabs={MODES} value={mode} onChange={changeMode} />
        </div>
      )}

      {/* The navigation puck already shows where you are, with a heading. */}
      {!nav && (
        <LocateButton
          state={locating ? 'locating' : userFix ? 'located' : 'idle'}
          onLocate={locateMe}
        />
      )}

      {/*
       * The honesty page had nothing that opened it. It sits with the map's own
       * controls rather than inside one mode's panel, because what leaves the
       * device is true of all three modes and should be readable from any of
       * them.
       */}
      {!nav && (
        <div className="absolute right-2.5 top-[14.5rem] z-10 sm:right-3.5">
          <button
            type="button"
            onClick={() => setPrivacyOpen(true)}
            aria-label="What leaves your device"
            title="What leaves your device"
            className="flex h-[29px] w-[29px] items-center justify-center rounded-full border
                       border-white/40 bg-surface/80 text-muted shadow-mid backdrop-blur-xl
                       transition-colors hover:text-ink dark:border-white/10"
          >
            <Icon name="shield" size={15} />
          </button>
        </div>
      )}

      {/* Hidden while navigating: nobody wants birds over their directions. */}
      {!nav && (
        <AmbientControls
          config={ambientFx}
          onChange={(next) => {
            setAmbientFx(next)
            try {
              localStorage.setItem('ambient', JSON.stringify(next))
            } catch {
              /* not worth surfacing */
            }
          }}
        />
      )}

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-32 z-30 px-3">
          <p
            className="mx-auto flex w-fit max-w-md animate-slide-up items-center gap-2
                       rounded-full bg-inverse px-3.5 py-2 text-xs text-inverse-ink shadow-high"
            role="status"
          >
            <Icon name="info" size={14} className="opacity-70" />
            {banner}
          </p>
        </div>
      )}

      {/* --- bottom panel --- */}
      {nav ? (
        <NavPanel
          nav={nav}
          followingMe={followMe}
          onToggleFollow={() => setFollowMe((v) => !v)}
          onRecenter={() => setRecenterSignal((n) => n + 1)}
          onStop={stopNavigation}
        />
      ) : selected ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 sm:px-4 sm:pb-5">
          <div
            className="sheet pointer-events-auto w-full max-w-xl overflow-hidden rounded-sheet
                       border border-white/40 bg-surface/85 shadow-high backdrop-blur-xl
                       dark:border-white/10"
          >
          <DetailPanel
            poi={selected}
            reports={reports}
            onClose={() => setSelected(null)}
            onReport={(poi) => setReportTarget({ type: 'poi', poi })}
            onBeenHere={(poi) => {
              const target = {
                label: poi.name ?? 'This place',
                lat: poi.lat,
                lon: poi.lon,
                poiId: poi.id,
                category: poi.category,
              }
              if (me) setVisitTarget(target)
              else
                setAccountPrompt({
                  purpose: 'keep a board of places you’ve been',
                  then: () => setVisitTarget(target),
                })
            }}
            onGo={goToPoi}
            goBusy={startingNav}
          />
          </div>
        </div>
      ) : mode === 'ask' && tripStops.length > 0 ? (
        /*
         * A trip in progress takes the panel over. It is a working document —
         * stops to choose, a route to check — not something to browse past, so
         * it replaces the search input rather than stacking above it.
         */
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-3 sm:px-4 sm:pb-5">
          <div
            className="sheet pointer-events-auto w-full max-w-xl overflow-hidden rounded-sheet
                       border border-white/40 bg-surface/85 shadow-high backdrop-blur-xl
                       dark:border-white/10"
          >
            {tripPanel}
          </div>
        </div>
      ) : mode === 'ask' ? (
        <AskPanel
          results={results}
          explanations={explanations}
          chips={askChips}
          busy={busy}
          notice={askNotice}
          selectedId={null}
          userFix={userFix}
          onAsk={askQuestion}
          onRemoveChip={(key) => {
            // Removing a chip re-runs the search without that term, which is
            // the whole point of showing what was understood.
            const next = askChips.filter((c) => c.key !== key)
            setAskChips(next)
            const rebuilt = next.map((c) => c.label).join(' ')
            if (rebuilt.trim()) askQuestion(rebuilt)
            else {
              setResults([])
              setExplanations({})
              setAskNotice(null)
            }
          }}
          onSelect={(id) => {
            const hit = results.find((p) => p.id === id)
            if (hit) {
              setSelected(hit)
              focusPlace(hit.lat, hit.lon)
            }
          }}
          onUseLocation={locateMe}
          visits={visits}
          onOpenBoard={() => setBoardOpen(true)}
        />
      ) : mode === 'hangout' ? (
        <HangoutHome
          me={me}
          activities={activities}
          loading={activitiesLoading}
          error={activitiesError}
          filter={activityFilter}
          selfLocation={liveFix ?? userFix}
          peopleCount={people.length}
          googleConfigured={googleConfigured}
          devAllowed={devAllowed}
          chatRefresh={chatRefresh}
          onFilter={setActivityFilter}
          onOpenActivity={setOpenActivity}
          onCreate={() => setCreatingActivity(true)}
          onOpenRoom={openRoom}
          onOpenThread={setOpenDm}
          onMessagePerson={messagePerson}
          onChatChanged={() => setChatRefresh((n) => n + 1)}
          onProfileUpdated={setMe}
          onSignedOut={() => {
            setMe(null)
          }}
          onNeedAccount={(purpose, then) => setAccountPrompt({ purpose, then })}
        />
      ) : (
        <EventsHome
          events={shownEvents}
          loading={eventsLoading}
          error={eventsError}
          category={eventCategory}
          freeOnly={eventsFree}
          selfLocation={liveFix ?? userFix}
          refreshing={refreshingEvents}
          onCategory={setEventCategory}
          onToggleFree={() => setEventsFree((v) => !v)}
          date={eventDate}
          onDate={setEventDate}
          horizon={eventHorizon}
          onHorizon={setEventHorizon}
          onOpen={setOpenEvent}
          onCreate={() => withAccount('post an event', () => setCreatingEvent(true))}
          onRefresh={doRefreshEvents}
        />
      )}

      {/* --- sheets --- */}
      {openActivity && (
        <ActivitySheet
          activityId={openActivity}
          onClose={() => setOpenActivity(null)}
          onChanged={() => {
            void refreshActivities()
            setChatRefresh((n) => n + 1)
          }}
          onOpenRoom={openRoom}
          onOpenProfile={showPerson}
          // The same pair EventSheet gets. Without them a signed-out tap on
          // "I'm in" dead-ends on the server's "Sign in to do that." with no
          // way to actually sign in.
          signedIn={Boolean(me)}
          onNeedAccount={(purpose, then) => setAccountPrompt({ purpose, then })}
        />
      )}

      {creatingActivity && (
        <CreateFlow
          selfLocation={liveFix ?? userFix}
          onClose={() => setCreatingActivity(false)}
          onCreated={(id) => {
            setCreatingActivity(false)
            void refreshActivities()
            setOpenActivity(id)
          }}
        />
      )}

      {openEvent && (
        <EventSheet
          eventId={openEvent}
          signedIn={Boolean(me)}
          onClose={() => setOpenEvent(null)}
          onChanged={() => {
            void refreshEventList()
            setChatRefresh((n) => n + 1)
          }}
          onOpenRoom={openRoom}
          onOpenProfile={showPerson}
          onNeedAccount={(purpose, then) => setAccountPrompt({ purpose, then })}
          onGo={(place) => void beginNavigation(place)}
        />
      )}

      {creatingEvent && (
        <CreateEvent
          selfLocation={liveFix ?? userFix}
          onClose={() => setCreatingEvent(false)}
          onCreated={(id) => {
            setCreatingEvent(false)
            void refreshEventList()
            setOpenEvent(id)
          }}
        />
      )}

      {person && (
        <div
          className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center bg-slate-950/50 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPerson(null)}
        >
          <div
            className="sheet w-full max-w-sm animate-sheet-in rounded-t-sheet bg-surface p-4 shadow-high sm:rounded-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-sunken text-xl font-semibold text-muted">
                {person.avatarUrl ? (
                  <img
                    src={person.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  person.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <h2 className="mt-2.5 text-lg font-semibold">{person.name}</h2>
              <p className="tabular mt-0.5 text-xs text-muted">
                {[person.age, person.city].filter(Boolean).join(' · ')}
              </p>
              {person.bio && (
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{person.bio}</p>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void messagePerson(person.id)}
                className="btn btn-primary flex-1 py-2.5"
              >
                <Icon name="send" size={15} />
                Message
              </button>
              <button
                type="button"
                onClick={() => setPerson(null)}
                className="btn btn-secondary flex-1 py-2.5"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {accountPrompt && (
        <AccountPrompt
          purpose={accountPrompt.purpose}
          googleConfigured={googleConfigured}
          devAllowed={devAllowed}
          onReady={async () => {
            const run = accountPrompt.then
            const purpose = accountPrompt.purpose
            setAccountPrompt(null)
            const user = await reloadMe()
            void refreshActivities()
            /*
             * A profile with nothing but what Google gave us is a first run.
             * Ask for the rest once, holding the original action until they
             * are done — then drop them exactly where they were going.
             */
            if (user && user.age == null && !user.city && !user.bio) {
              setFirstRun({ me: user, purpose, then: run })
            } else {
              run()
            }
          }}
          onCancel={() => setAccountPrompt(null)}
        />
      )}

      {firstRun && (
        <FirstRunProfile
          me={firstRun.me}
          purpose={firstRun.purpose}
          onDone={(updated) => {
            setMe(updated)
            const run = firstRun.then
            setFirstRun(null)
            run()
          }}
        />
      )}

      {reportTarget && (
        <ReportSheet
          target={reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            void refreshReports()
            if (reportTarget.type === 'point') setShowFlood(true)
          }}
        />
      )}

      {boardOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="My Map"
          onClick={() => setBoardOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="sheet flex h-[85vh] w-full flex-col overflow-hidden rounded-t-sheet
                       border-t border-white/40 bg-canvas/95 shadow-sheet backdrop-blur-xl
                       dark:border-white/10 sm:h-[80vh] sm:max-w-lg sm:rounded-sheet sm:border"
          >
            <button
              type="button"
              onClick={() => setBoardOpen(false)}
              className="flex shrink-0 justify-center pb-1 pt-2.5"
              aria-label="Close board"
            >
              <span className="h-1 w-9 rounded-full bg-line-strong" />
            </button>
            <BoardScreen
              visits={visits}
              loading={visitsLoading}
              error={visitsError}
              selfLocation={liveFix ?? userFix}
              onOpenVisit={setOpenVisit}
              onShowOnMap={(v) => {
                setBoardOpen(false)
                focusPlace(v.lat, v.lon)
              }}
              onAddVisit={() => {
                setBoardOpen(false)
                setBanner('Tap any place on the map to add it.')
                window.setTimeout(() => setBanner(null), 3000)
              }}
            />
          </div>
        </div>
      )}

      {openVisit && (
        <VisitCard
          visit={openVisit}
          onClose={() => setOpenVisit(null)}
          onShowOnMap={(v) => {
            setOpenVisit(null)
            setBoardOpen(false)
            focusPlace(v.lat, v.lon)
          }}
          onDelete={handleDeleteVisit}
        />
      )}

      {visitTarget && (
        <VisitSheet
          initial={visitTarget}
          busy={savingVisit}
          error={visitSaveError}
          onClose={() => {
            setVisitTarget(null)
            setVisitSaveError(null)
          }}
          onSave={handleSaveVisit}
        />
      )}

      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}
    </main>
  )
}
