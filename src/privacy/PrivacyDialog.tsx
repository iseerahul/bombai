import { useEffect, useRef } from 'react'
import Icon, { type IconName } from '../ui/Icon'

interface PrivacyDialogProps {
  onClose: () => void
}

/**
 * The honesty page.
 *
 * The rule here: every claim must be something the code actually enforces, and
 * the one real leak (question text reaching Google) is stated plainly rather
 * than buried. A privacy page that overclaims is worse than none.
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
              <Claim lead="Which areas you look up.">
                “Andheri East” is resolved against a list of localities shipped
                inside the app, not a geocoding service.
              </Claim>
            </ul>
          </Section>

          <Section icon="alert" title="What does get sent, and where" tone="caution">
            <ul className="space-y-2">
              <Claim lead="Your question text">
                goes to our server, which passes it to Google's Gemini API to work
                out what you meant. Google receives the words you typed. It does
                not receive your location, your identity, or anything linking one
                question to another.
              </Claim>
              <Claim lead="Trip routes are the exception to everything above.">
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
              If a question can be understood without help, the app answers it on
              your device and skips the network call entirely. It'll tell you which
              happened under each answer.
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
                overwritten each update and deleted when you switch it off.
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
              profile picture, plus what you join and post. Appearing on the map
              is a separate switch that is off until you turn it on, keeps one
              overwritten row rather than a trail, and deletes itself when you
              switch it off.
            </p>
          </section>

          <section className="mt-5 rounded-card border border-line bg-sunken p-3.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon name="sparkle" size={14} className="text-accent" />
              About the AI suggestions
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              When you ask for the “best” of something, the AI may only choose from
              places already in this app's OpenStreetMap dataset — the server
              discards anything else it tries to name. It has no reviews, ratings,
              or visit data, so treat those suggestions as a starting point, not a
              verdict. Community reports are the only verified signal here.
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
