import { createFileRoute } from "@tanstack/react-router";
import { MapPin, Users, CalendarDays, ArrowUpRight, Bookmark, Clock } from "lucide-react";

import mapBlue from "@/assets/mumbai-map-blue.jpg";
import stickerRickshaw from "@/assets/sticker-rickshaw.png";
import stickerChai from "@/assets/sticker-chai.png";
import stickerVadaPav from "@/assets/sticker-vadapav.png";
import stickerCouple from "@/assets/sticker-couple.png";
import nightDrive from "@/assets/mumbai-night-drive.jpg";
import friendsToast from "@/assets/friends-toast.jpg";
import dancefloor from "@/assets/mumbai-dancefloor.jpg";
import marineSnacks from "@/assets/marine-drive-snacks.jpg";

import askMapShot from "@/assets/Screenshot_2026-09-18_164046.png";
import beenHereShot from "@/assets/Screenshot_2026-09-18_164832.png";
import hangoutShot from "@/assets/Screenshot_2026-09-18_164156.png";
import eventsShot from "@/assets/Screenshot_2026-09-18_164446.png";
import walkArt from "@/assets/Nature_in_the_city_vibes.jpg";
import rooftopArt from "@/assets/download_1.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bambai Side Up — Mumbai hangouts, events and crews" },
      {
        name: "description",
        content:
          "Ask the map, drop a pin where you've been, start a hangout or find tonight's gig. Bambai Side Up opens Mumbai up, one plan at a time.",
      },
      { property: "og:title", content: "Bambai Side Up — Mumbai hangouts, events and crews" },
      {
        property: "og:description",
        content:
          "Find the event. Meet the crew. Make the city yours. 42 plans live across Mumbai right now.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const cards = [
  {
    n: "01",
    title: "Ask the map",
    kicker: "कुछ भी पूछो",
    body: "Type how you feel — chill, by the water, somewhere with the kids — and get real places, ranked, each with the reason attached.",
    stat: "19,336 places",
    img: askMapShot,
    bg: "var(--azure)",
    tilt: "-1.5deg",
  },
  {
    n: "02",
    title: "Been here",
    kicker: "अपना नक़्शा",
    body: "Drop a red pin where you actually went. Photos, a note, yours alone. Publish one and it joins the city's map.",
    stat: "your map",
    img: beenHereShot,
    bg: "var(--coral)",
    tilt: "1.5deg",
  },
  {
    n: "03",
    title: "Hang out",
    kicker: "साथ चलें",
    body: "Start something where you're standing. See who's nearby, land in the group chat, turn up.",
    stat: "live now",
    img: hangoutShot,
    bg: "var(--mint)",
    tilt: "1deg",
  },
  {
    n: "04",
    title: "Events",
    kicker: "आज क्या है",
    body: "Gigs, open mics, run clubs, pool parties. Tonight, this week, or a date you pick.",
    stat: "274 this week",
    img: eventsShot,
    bg: "var(--sun)",
    tilt: "-1deg",
  },
];

const tags = [
  "SEA BREEZE",
  "ART CRAWL",
  "AFTER DARK",
  "CHILL EATS",
  "CUTTING CHAI",
  "MARINE DRIVE",
  "KALA GHODA",
  "OPEN MIC",
  "SUNSET WALK",
];

/**
 * Where every "Explore Bambai" goes: the map app.
 *
 * In production both halves are served from one Cloudflare origin — this
 * landing at / and the map at /app/ — so the plain path is right and the
 * click is a same-origin navigation. In development they are two Vite servers
 * on two ports, so VITE_MAP_URL in .env.development points at the other one;
 * without it the CTA 404s against this server.
 */
const MAP_URL = import.meta.env.VITE_MAP_URL ?? "/app/";

function ExploreButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={MAP_URL}
      className={`press inline-flex items-center gap-3 rounded-full border-[3px] border-border bg-primary px-8 py-4 font-display text-2xl tracking-wide text-primary-foreground uppercase shadow-[6px_6px_0_0_var(--ink)] ${className}`}
    >
      Explore Bambai
      <ArrowUpRight className="h-5 w-5 shrink-0" strokeWidth={3} />
    </a>
  );
}

function Landing() {
  return (
    <main className="overflow-x-hidden bg-background text-foreground">
      {/* NAV */}
      <header className="sticky top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-5">
        <nav className="ink-frame flex flex-nowrap items-center justify-between gap-3 rounded-sm bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <a href="#top" className="min-w-0 truncate font-display text-2xl tracking-wide">
            Bambai <span className="text-primary">Side Up</span>
          </a>
          <div className="hidden items-center gap-8 justify-self-center font-mono text-xs tracking-[0.18em] uppercase lg:flex">
            <a href="#do" className="hover:text-primary">
              Events
            </a>
            <a href="#crew" className="hover:text-primary">
              Find your people
            </a>
            <a href="#close" className="hover:text-primary">
              City line
            </a>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
              <Bookmark className="h-4 w-4" /> 0 saved
            </span>
            <ExploreButton className="!px-5 !py-2 !text-lg" />
          </div>
        </nav>
      </header>

      {/* 1 · HERO */}
      <section id="top" className="relative -mt-[4.5rem] min-h-screen overflow-hidden">
        <img
          src={mapBlue}
          alt="Illustrated blue map of Mumbai"
          className="absolute inset-0 h-full w-full object-cover brightness-110 contrast-95 saturate-90"
        />

        {/* sticker cutouts */}
        <img
          src={stickerChai}
          alt="Cutting chai sticker"
          className="pointer-events-none absolute left-[2%] top-[13%] z-10 w-24 -rotate-12 sm:left-[3%] sm:w-36 lg:left-[4%] lg:top-[14%] lg:w-44"
        />
        <img
          src={stickerVadaPav}
          alt="Vada pav sticker"
          className="pointer-events-none absolute right-[1%] top-[6%] z-10 w-28 rotate-8 sm:right-[2%] sm:w-40 lg:right-[3%] lg:top-[7%] lg:w-52"
        />
        <img
          src={stickerRickshaw}
          alt="Auto-rickshaw sticker"
          className="pointer-events-none absolute bottom-[1%] left-[0%] z-10 w-44 -rotate-6 sm:left-[2%] sm:w-64 lg:left-[3%] lg:w-72"
        />
        <img
          src={stickerCouple}
          alt="Two friends laughing sticker"
          className="pointer-events-none absolute right-[0%] bottom-[1%] z-10 w-44 rotate-6 sm:right-[2%] sm:w-64 lg:right-[3%] lg:w-72"
        />

        {/* Mumbai moments floating as square cards */}
        <div className="drift ink-frame absolute left-[4%] top-[38%] z-20 w-20 -rotate-3 overflow-hidden bg-background p-1 sm:left-[14%] sm:top-[40%] sm:w-28 lg:left-[17%] lg:top-[41%] lg:w-36">
          <img src={nightDrive} alt="Friends out in Mumbai at night" className="aspect-square w-full object-cover" />
        </div>
        <div className="drift ink-frame absolute right-[4%] top-[36%] z-20 w-20 rotate-3 overflow-hidden bg-background p-1 sm:right-[14%] sm:top-[38%] sm:w-28 lg:right-[17%] lg:top-[39%] lg:w-36" style={{ animationDelay: "1.2s" }}>
          <img src={friendsToast} alt="Friends raising a toast" className="aspect-square w-full object-cover" />
        </div>
        <div className="drift ink-frame absolute bottom-[26%] left-[6%] z-20 w-20 rotate-2 overflow-hidden bg-background p-1 sm:bottom-[27%] sm:left-[15%] sm:w-28 lg:bottom-[25%] lg:left-[19%] lg:w-36" style={{ animationDelay: "2.4s" }}>
          <img src={dancefloor} alt="A Mumbai dance floor" className="aspect-square w-full object-cover" />
        </div>
        <div className="drift ink-frame absolute right-[6%] bottom-[26%] z-20 w-20 -rotate-2 overflow-hidden bg-background p-1 sm:right-[15%] sm:bottom-[27%] sm:w-28 lg:right-[19%] lg:bottom-[26%] lg:w-36" style={{ animationDelay: "0.6s" }}>
          <img src={marineSnacks} alt="Late-night snacks by Marine Drive" className="aspect-square w-full object-cover" />
        </div>

        <div className="relative z-30 flex min-h-screen flex-col items-center justify-center px-4 pt-28 pb-20 text-center">
          <span className="ink-frame bg-foreground px-4 py-2 font-sans text-[11px] font-extrabold tracking-wide text-background uppercase sm:text-xs">
            Mumbai is outside · 2.4K live people
          </span>
          <h1 className="poster-caps mt-5 text-[18vw] sm:text-[14vw] lg:text-[10.5rem]">
            <span className="block">Bambai</span>
            <span
              className="block text-transparent"
              style={{ WebkitTextStroke: "3px var(--ink)" }}
            >
              Side Up
            </span>
          </h1>
          <p className="mt-6 max-w-lg border-2 border-border bg-background/70 px-4 py-2 text-sm font-bold shadow-[4px_4px_0_0_var(--ink)] backdrop-blur-sm sm:text-lg">
            Find the event. Meet the crew. Make the city yours.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
            <ExploreButton />
            <div className="ink-frame flex items-center gap-3 bg-background px-4 py-3">
              <span className="flex -space-x-2">
                <span className="h-6 w-6 rounded-full border-2 border-border bg-primary" />
                <span className="h-6 w-6 rounded-full border-2 border-border bg-[var(--sun)]" />
                <span className="h-6 w-6 rounded-full border-2 border-border bg-[var(--mint)]" />
              </span>
              <span className="text-sm font-semibold">2.4K finding plans</span>
            </div>
          </div>
          <p className="mt-10 font-mono text-[11px] tracking-[0.22em] uppercase">
            42 plans live · 2.4K city people
          </p>
        </div>
      </section>

      {/* 2 · FOUR THINGS */}
      <section id="do" className="bg-background px-4 py-24 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="eyebrow">Four ways in</p>
          <h2 className="display-caps mt-3 text-6xl sm:text-8xl">
            Things you can <span className="text-primary">do</span>
          </h2>

          <div className="mt-14 grid gap-10 md:grid-cols-2">
            {cards.map((c) => (
              <a
                key={c.n}
                href={MAP_URL}
                className="ink-frame press group block overflow-hidden bg-card"
                style={{ transform: `rotate(${c.tilt})`, background: c.bg }}
              >
                <div className="flex items-start justify-between gap-4 p-6">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] tracking-[0.2em] uppercase">
                      {c.n} / {c.kicker}
                    </p>
                    <h3 className="display-caps mt-2 text-5xl">{c.title}</h3>
                  </div>
                  <span className="ink-frame shrink-0 bg-background px-3 py-1 font-mono text-[10px] tracking-widest uppercase">
                    {c.stat}
                  </span>
                </div>
                <p className="px-6 pb-6 text-[15px] leading-relaxed font-medium">{c.body}</p>
                <div className="relative mx-6 mb-6 h-56 overflow-hidden border-[3px] border-border bg-background">
                  <img
                    src={c.img}
                    alt={`${c.title} screen`}
                    loading="lazy"
                    className="absolute -top-2 left-1/2 w-[112%] max-w-none -translate-x-1/2 transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* 3 · CITY IS WAITING */}
      <section id="crew" className="bg-[var(--sky)] px-4 py-24 sm:px-8">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2">
          <div className="relative">
            <img
              src={walkArt}
              alt="Illustrated walk through the city"
              loading="lazy"
              className="ink-frame-lg w-full -rotate-2 object-cover"
            />
            <span className="ink-frame absolute -bottom-5 right-6 rotate-[-6deg] bg-[var(--sun)] px-5 py-2 font-display text-2xl">
              New crew?
            </span>
          </div>

          <div>
            <p className="eyebrow">Come solo, leave with stories</p>
            <h2 className="display-caps mt-4 text-6xl sm:text-8xl">
              Your next
              <br />
              <span className="text-primary">scene awaits.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed">
              Join a sunset walk, claim a seat at an open mic, or find three strangers who also
              refuse to waste Saturday.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-6">
              {[
                ["42", "live plans"],
                ["2.4K", "city people"],
                ["24/7", "Mumbai energy"],
              ].map(([big, small]) => (
                <div key={small} className="border-t-2 border-border pt-3">
                  <p className="display-caps text-4xl">{big}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{small}</p>
                </div>
              ))}
            </div>
            <a
              href={MAP_URL}
              className="press mt-10 inline-flex items-center gap-3 rounded-full border-[3px] border-border bg-primary px-8 py-4 font-display text-2xl text-primary-foreground uppercase shadow-[6px_6px_0_0_var(--ink)]"
            >
              See who's going
              <Users className="h-5 w-5" strokeWidth={3} />
            </a>
          </div>
        </div>

        {/* marquee */}
        <div className="mt-20 overflow-hidden border-y-[3px] border-border py-5">
          <div className="marquee-track flex gap-4">
            {[...tags, ...tags].map((t, i) => (
              <span
                key={`${t}-${i}`}
                className="ink-frame shrink-0 rounded-full px-6 py-2 font-mono text-xs tracking-[0.2em] whitespace-nowrap uppercase"
                style={{
                  background: i % 3 === 0 ? "var(--sun)" : i % 3 === 1 ? "var(--cream)" : "var(--mint)",
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 3b · rooftop plan strip */}
      <section className="bg-background px-4 py-24 sm:px-8">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="eyebrow">Mumbai after hours</p>
            <h2 className="display-caps mt-4 text-6xl sm:text-8xl">
              Plans look better from up here.
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-6 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" /> Friday · 9 PM
              </span>
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4" /> 16 people joined
              </span>
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Lower Parel rooftop
              </span>
            </div>
          </div>
          <img
            src={rooftopArt}
            alt="Illustrated rooftop scene"
            loading="lazy"
            className="ink-frame-lg w-full rotate-2 object-cover"
          />
        </div>
      </section>

      {/* 4 · CLOSE */}
      <section id="close" className="bg-foreground px-4 py-28 text-center text-background">
        <h2 className="display-caps mx-auto max-w-4xl text-7xl sm:text-9xl">
          Mumbai is <span className="text-primary">outside.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-md text-base opacity-80">
          Have a look. Sign in only when you want to save something.
        </p>
        <div className="mt-10 flex justify-center">
          <ExploreButton className="shadow-[6px_6px_0_0_var(--sky)]" />
        </div>
        <div className="mx-auto mt-20 flex max-w-5xl flex-wrap items-center justify-between gap-4 border-t border-background/25 pt-6 font-mono text-[10px] tracking-[0.2em] uppercase opacity-70">
          <span>Bambai Side Up</span>
          <span className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5" /> Built on OpenStreetMap and the BMC's open
            records
          </span>
        </div>
      </section>
    </main>
  );
}
