import { useEffect, useRef } from 'react'
import Icon, { type IconName } from '../ui/Icon'

interface PrivacyDialogProps {
  onClose: () => void
}

/**
 * The honesty page.
 *
 * The rule here: every claim must be something the code actually enforces, and
 * the things that do leave the device are stated plainly rather than buried. A
 * privacy page that overclaims is worse than none — which is why this file
 * changes whenever the code does. It used to disclose question text reaching
 * Google's Gemini API; that call no longer exists, so that claim is gone too.
 *
 * The layout follows that rule too — "what leaves the device" is not tucked
 * below the reassuring part, it sits at equal weight with its own colour.
 */

function Section({
  icon,
  title,
  tone,
  children,
}: {
  icon: IconName
  title: string
  tone: 'positive' | 'caution' | 'neutral'
  children: React.ReactNode
}) {
  const tones = {
    positive: 'bg-positive-soft text-positive-ink',
    caution: 'bg-caution-soft text-caution-ink',
    neutral: 'bg-sunken text-muted',
  }

  return (
    <section className="mt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}
        >
          <Icon name={icon} size={13} />
        </span>
        {title}
      </h3>
      <div className="mt-2 pl-8">{children}</div>
    </section>
  )
}

/** Bulleted claim with a lead-in. Keeps every item structurally identical. */
function Claim({ lead, children }: { lead: string; children?: React.ReactNode }) {
  return (
    <li className="text-sm leading-relaxed text-muted">
      <strong className="font-semibold text-ink">{lead}</strong>
      {children ? <> {children}</> : null}
    </li>
  )
}

export default function PrivacyDialog({ onClose }: PrivacyDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex animate-fade-in items-end justify-center
                 bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="sheet scrollbar-slim max-h-[88vh] w-full max-w-lg animate-sheet-in
                   overflow-y-auto rounded-t-sheet bg-surface shadow-high outline-none
                   sm:rounded-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header so the close control never scrolls away on mobile. */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur-md">
          <h2
            id="privacy-title"
            className="text-lg font-semibold leading-tight tracking-[-0.02em]"
          >
            What this app does and doesn't collect
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost -mr-1 aspect-square shrink-0 !rounded-full p-0"
            style={{ width: '2rem', height: '2rem', minHeight: 0 }}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="px-5 pb-5">
          <Section icon="shield" title="What stays on your device" tone="positive">
            <ul className="space-y-2">
              <Claim lead="Your location, for every search.">
                The entire map dataset is downloaded to your phone, so finding
                what's “near me” is arithmetic done locally. Searching never sends
                a coordinate anywhere. (Trip routing is the one exception — see
                below.)
              </Claim>
              <Claim lead="The words you type.">
                Searching is arithmetic over map files already on your phone —
                your question is read, matched and ranked here, and never sent
                anywhere. An earlier version passed it to Google's Gemini API to
                work out what you meant; that is gone, and so is the key for it.
              </Claim>
              <Claim lead="Which areas you look up.">
                “Andheri East” is resolved against a list of localities shipped
                inside the app, not a geocoding service.
              </Claim>
            </ul>
          </Section>

          <Section icon="alert" title="What does get sent, and where" tone="caution">
            <ul className="space-y-2">
              <Claim lead="A place name nothing here matches.">
                The app carries fifteen categories; OpenStreetMap has hundreds.
                So if you name something we never packed — a bookshop, a salon —
                and nothing on your phone matches, that name alone is sent to our
                server and on to OpenStreetMap's public geocoders to look up.
                Only the name: not the rest of your question, not your location,
                not anything identifying you. It is cached by name, so the same
                lookup isn't asked twice. This runs only after the on-device
                search has come back with nothing.
              </Claim>
              <Claim lead="Trip routes, and only trip routes, send your location.">
                Walking directions cannot be worked out on your phone — the road
                network is far too large to download — so when you plan a trip,
                the coordinates of your stops are sent to OpenRouteService through
                our server. This is the only feature that does that, it only
                happens when you explicitly plan a trip, and the routing service
                never sees your IP address or any identifier. Nothing about the
                route is stored. If that trade isn't worth it to you, don't use
                trip planning — everything else stays on your device.
              </Claim>
              <Claim lead="Map tiles">
                are fetched from OpenFreeMap, which sees which map squares you
                viewed — the same as any map site.
              </Claim>
              <Claim lead="Reports you submit">
                are stored with a location rounded to about 110 m, and nothing
                else.
              </Claim>
            </ul>
            <p className="mt-2.5 text-xs leading-relaxed text-subtle">
              That is the whole list. An ordinary search — one the map files can
              answer, which is nearly all of them — touches none of it.
            </p>
          </Section>

          <Section icon="close" title="What doesn't exist at all" tone="neutral">
            <ul className="space-y-1.5 text-sm text-muted">
              <li>
                No password, email address or phone number. Signing in is
                Google, or a name on this device — nothing else is asked for.
              </li>
              <li>No analytics, trackers, or third-party scripts.</li>
              <li>
                No IP address is ever stored — rate limiting uses a hash whose
                salt changes daily, so today's activity can't be linked to
                tomorrow's.
              </li>
              <li>
                No location history. Sharing your position keeps one row that is
                overwritten each update and deleted when you leave the Hangout
                tab or sign out.
              </li>
              <li>No ads, sponsored pins, or paid placement, ever.</li>
              <li>
                No payments. Ticket links go to whoever actually sells the
                ticket; this app never handles money.
              </li>
            </ul>
            <p className="mt-2.5 text-xs leading-relaxed text-subtle">
              Direct messages <strong>do</strong> exist, between any two
              signed-in people. An earlier version of this app had none and said
              so here; that changed, so this did too. You can block anyone, which
              is symmetric — you disappear from each other everywhere.
            </p>
          </Section>

          <section className="mt-5">
            <h3 className="text-sm font-semibold text-caution-ink">
              Accounts, and when you need one
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Asking the map, getting directions, browsing what's on and reading
              activity listings all work with no account and nothing stored. An
              account is asked for once, at the moment you first do something
              involving another person — joining, posting, or messaging.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              With an account, the server knows a name and (via Google) a
              profile picture, plus what you join and post. While you are signed
              in and looking at the Hangout tab, your position is shared with
              other people there — that is what makes the tab work, so there is
              no separate switch for it. It stops the moment you leave the tab
              or sign out, and it keeps one row that is overwritten each update
              rather than a trail, which is deleted when the sharing stops.
            </p>
          </section>

          <section className="mt-5 rounded-card border border-line bg-sunken p-3.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon name="sparkle" size={14} className="text-accent" />
              How results get ordered
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              No model chooses for you. The order is a fixed sum your phone works
              out: how far away a place is, how well its name matches, whether
              it's open now, and what community reports say. That's why every
              result carries a line saying why it's there — anything that can't be
              explained shouldn't be ranked. Nothing here has reviews, ratings or
              visit data, so treat the order as a starting point, not a verdict.
              Community reports are the only verified signal.
            </p>
          </section>

          <p className="mt-4 text-2xs leading-relaxed text-subtle">
            Map data © OpenStreetMap contributors (ODbL). Public toilet records from
            MCGM via data.opencity.in. Flood-prone locations are a hand-compiled
            reference list of historically affected areas, not live status.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary mt-4 w-full py-2.5"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
