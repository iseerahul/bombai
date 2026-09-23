import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownRight, Bookmark, CalendarDays, Clock3, MapPin, Menu, Sparkles, Users, X } from "lucide-react";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import natureArtwork from "@/assets/nature-in-city.jpg.asset.json";
import dreamerArtwork from "@/assets/city-dreamer.jpg.asset.json";
import mumbaiMap from "@/assets/mumbai-map-editorial.jpg";
import skyline from "@/assets/mumbai-skyline-editorial.jpg";
import autoSticker from "@/assets/auto-editorial.png";
import vadaPavSticker from "@/assets/vada-pav-editorial.png";
import chaiSticker from "@/assets/chai-editorial.png";
import friendsSticker from "@/assets/friends-editorial.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bambai Side Up — Find Mumbai Events & Hangouts" },
      { name: "description", content: "Explore Mumbai events, neighborhood hangouts, new people, sea views, art walks, and late-night plans on one visual city map." },
      { property: "og:title", content: "Bambai Side Up — Find Mumbai Events & Hangouts" },
      { property: "og:description", content: "Your visual map to events, people, and plans across Mumbai." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/**
 * Where "Explore Bambai" goes: the map app.
 *
 * In production both apps are served from one Cloudflare origin — this landing
 * at / and the map at /app — so this is a same-origin navigation and the plain
 * path is right. In development they are two Vite servers on two ports, so
 * `VITE_MAP_URL` in .env points at the other one.
 */
const MAP_URL = import.meta.env.VITE_MAP_URL ?? "/app/";

const moods = ["All scenes", "Sea breeze", "Art crawl", "After dark", "Chill eats"];
const spots = [
  { name: "Carter Road", area: "Bandra West", mood: "Sea breeze", tag: "Sunset circle", code: "01", people: "18 going", time: "Sat · 6:30 PM", tone: "coral" },
  { name: "Kala Ghoda", area: "Fort", mood: "Art crawl", tag: "Gallery hop", code: "02", people: "11 going", time: "Sun · 11 AM", tone: "blue" },
  { name: "Marine Drive", area: "Churchgate", mood: "After dark", tag: "Midnight walk", code: "03", people: "24 going", time: "Fri · 10 PM", tone: "lime" },
  { name: "Versova Social", area: "Andheri West", mood: "Chill eats", tag: "Open-mic table", code: "04", people: "8 spots left", time: "Thu · 8 PM", tone: "yellow" },
];

const cityPins = [
  { name: "Bandra", note: "12 plans", position: "left-[31%] top-[28%]" },
  { name: "Juhu", note: "Sunset crew", position: "left-[35%] top-[48%]" },
  { name: "Worli", note: "7 events", position: "left-[41%] top-[62%]" },
  { name: "Colaba", note: "Art walk", position: "left-[45%] top-[82%]" },
];

function Index() {
  const [activeMood, setActiveMood] = useState("All scenes");
  const [saved, setSaved] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleSpots = activeMood === "All scenes" ? spots : spots.filter((spot) => spot.mood === activeMood);
  const scrollToScenes = () => document.querySelector("#scenes")?.scrollIntoView({ behavior: "smooth" });

  const toggleSaved = (name: string) => {
    setSaved((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 md:px-8">
        <nav className="mx-auto flex max-w-7xl items-center justify-between border-2 border-foreground bg-glass px-4 py-3 shadow-pop backdrop-blur-xl md:px-6" aria-label="Main navigation">
          <a href="#top" className="font-display text-xl font-black uppercase">Bambai <span className="text-primary">Side Up</span></a>
          <div className="hidden items-center gap-7 text-sm font-black uppercase md:flex">
            <a href="#scenes" className="transition-colors hover:text-primary">Events</a>
            <a href="#people" className="transition-colors hover:text-primary">Find your people</a>
            <a href="#guide" className="transition-colors hover:text-primary">City line</a>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-bold sm:block">{saved.length} saved</span>
            <Button variant="icon" size="icon" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close menu" : "Open menu"} className="md:hidden">
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </Button>
            <a href={MAP_URL} className={cn(buttonVariants(), "hidden uppercase md:inline-flex")}>Explore Bambai <ArrowDownRight size={16} /></a>
          </div>
        </nav>
        {menuOpen && (
          <div className="mx-auto mt-2 flex max-w-7xl flex-col gap-1 border-2 border-foreground bg-background p-3 shadow-pop md:hidden">
            {[{ label: "Events", id: "scenes" }, { label: "Find your people", id: "people" }, { label: "City line", id: "guide" }].map((item) => <a key={item.id} href={`#${item.id}`} onClick={() => setMenuOpen(false)} className="px-4 py-3 text-sm font-bold uppercase hover:bg-accent">{item.label}</a>)}
          </div>
        )}
      </header>

      <section id="top" className="relative min-h-[96svh] overflow-hidden border-b-4 border-foreground">
        <img src={mumbaiMap} alt="Illustrated map of Mumbai from the northern suburbs to Colaba" className="absolute inset-0 size-full object-cover object-[48%_center]" width={1920} height={1080} />
        <div className="map-wash absolute inset-0" />
        <div className="absolute inset-0 hidden md:block" aria-hidden="true">
          {cityPins.map((pin) => (
            <div key={pin.name} className={`map-pin absolute ${pin.position}`}>
              <span className="size-3 rounded-full bg-primary ring-4 ring-background" />
              <span><b>{pin.name}</b><small>{pin.note}</small></span>
            </div>
          ))}
        </div>

        <img src={autoSticker} alt="Editorial cutout of a Mumbai auto-rickshaw" className="sticker-float absolute -left-14 bottom-[7%] z-10 w-56 -rotate-6 md:left-[3%] md:w-80" width={615} height={495} />
        <img src={vadaPavSticker} alt="Editorial cutout of Mumbai vada pav" className="sticker-float absolute -right-20 top-[14%] z-10 w-60 rotate-6 md:right-[3%] md:w-80" width={855} height={460} />
        <img src={friendsSticker} alt="Two friends cheering together in Mumbai" className="sticker-float absolute -right-24 bottom-[-2%] z-10 w-80 md:right-[4%] md:w-[28rem]" width={935} height={670} />
        <img src={chaiSticker} alt="Editorial cutout of cutting chai" className="sticker-float absolute left-[8%] top-[13%] z-10 hidden w-44 rotate-6 lg:block" width={605} height={580} />

        <div className="relative z-20 mx-auto flex min-h-[96svh] max-w-7xl flex-col items-center justify-center px-5 pb-24 pt-32 text-center">
          <div className="-rotate-2 bg-foreground px-4 py-2 font-mono text-xs font-bold uppercase text-background shadow-pop md:text-sm">Mumbai is outside · 42 plans live</div>
          <h1 className="mt-6 select-none font-display text-[4.7rem] font-black uppercase leading-[0.75] md:text-[9rem] lg:text-[11rem]">
            Bambai<br /><span className="headline-outline">Side Up</span>
          </h1>
          <p className="mt-7 max-w-xl bg-glass px-4 py-2 text-base font-extrabold backdrop-blur-md md:text-xl">Find the event. Meet the crew. Make the city yours.</p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row">
            <a href={MAP_URL} className={cn(buttonVariants({ size: "lg" }), "h-16 border-2 border-foreground px-9 text-base uppercase md:text-lg")}>Explore Bambai <MapPin size={20} /></a>
            <div className="flex items-center gap-3 border-2 border-foreground bg-glass px-4 py-3 font-bold backdrop-blur-md">
              <span className="flex -space-x-2" aria-hidden="true">{["bg-primary", "bg-secondary", "bg-tertiary"].map((color) => <i key={color} className={`size-8 rounded-full border-2 border-foreground ${color}`} />)}</span>
              <span className="text-xs">2.4K finding plans</span>
            </div>
          </div>
        </div>
        <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap font-mono text-xs font-bold uppercase"><span className="size-2 animate-pulse rounded-full bg-tertiary" /> The city is the group chat</div>
      </section>

      <section id="scenes" className="border-b-4 border-foreground bg-surface py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-5 md:px-10">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div><p className="section-kicker">Happening around you</p><h2 className="section-title">Pick a plan.<br /><span className="text-primary">Bring your people.</span></h2></div>
            <div className="max-w-sm border-l-4 border-primary pl-4"><p className="font-bold">Events, casual meetups and tiny adventures worth leaving the house for.</p><p className="mt-2 text-sm text-muted-foreground">Updated for this weekend.</p></div>
          </div>
          <div className="hide-scrollbar mt-10 flex gap-2 overflow-x-auto pb-3">
            {moods.map((mood) => <Button key={mood} variant={activeMood === mood ? "primary" : "outline"} onClick={() => setActiveMood(mood)} aria-pressed={activeMood === mood}>{mood}</Button>)}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {visibleSpots.map((spot) => {
              const isSaved = saved.includes(spot.name);
              return (
                <article key={spot.name} className={`spot-card ${spot.tone === "coral" ? "spot-coral" : spot.tone === "blue" ? "spot-blue" : spot.tone === "lime" ? "spot-lime" : "spot-yellow"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <span className="font-mono text-xs font-bold">{spot.code} / LIVE PLAN</span>
                    <Button variant="icon" size="icon" aria-label={`${isSaved ? "Remove" : "Save"} ${spot.name}`} aria-pressed={isSaved} onClick={() => toggleSaved(spot.name)} className={isSaved ? "bg-primary text-primary-foreground" : ""}><Bookmark size={17} fill={isSaved ? "currentColor" : "none"} /></Button>
                  </div>
                  <div className="mt-14 md:mt-20">
                    <span className="mb-3 inline-flex border-2 border-foreground bg-background/80 px-3 py-1 font-mono text-xs font-bold">{spot.tag}</span>
                    <h3 className="font-display text-4xl font-black uppercase md:text-5xl">{spot.name}</h3>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold"><span className="flex items-center gap-2"><MapPin size={15} /> {spot.area}</span><span className="flex items-center gap-2"><CalendarDays size={15} /> {spot.time}</span><span className="flex items-center gap-2"><Users size={15} /> {spot.people}</span></div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="people" className="relative py-20 md:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 md:grid-cols-2 md:px-10">
          <div className="relative min-h-[520px]">
            <div className="absolute inset-x-[6%] top-0 h-[88%] -rotate-2 overflow-hidden border-[6px] border-foreground shadow-pop">
              <img src={natureArtwork.url} alt="Colorful illustrated city walker artwork" className="size-full object-cover" loading="lazy" />
            </div>
            <span className="absolute bottom-[2%] right-[2%] rotate-3 bg-secondary px-5 py-3 font-display text-2xl font-black shadow-pop">NEW CREW?</span>
          </div>
          <div className="flex flex-col justify-center">
            <p className="section-kicker">Come solo, leave with stories</p>
            <h2 className="section-title">Your next<br /><span className="text-primary">scene awaits.</span></h2>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">Join a sunset walk, claim a seat at an open mic, or find three strangers who also refuse to waste Saturday.</p>
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[{ value: "42", label: "live plans" }, { value: "2.4K", label: "city people" }, { value: "24/7", label: "Mumbai energy" }].map((stat) => <div key={stat.label} className="border-t-4 border-foreground pt-4"><p className="font-display text-3xl font-black">{stat.value}</p><p className="mt-1 text-xs font-bold text-muted-foreground">{stat.label}</p></div>)}
            </div>
            <Button size="lg" className="mt-9 self-start uppercase" onClick={scrollToScenes}>See who's going <Users size={17} /></Button>
          </div>
        </div>
      </section>

      <section className="border-y-4 border-foreground bg-accent py-16 md:py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 md:grid-cols-[1.15fr_.85fr] md:px-10">
          <div><p className="section-kicker">Mumbai after hours</p><h2 className="section-title">Plans look better<br />from up here.</h2><div className="mt-6 flex flex-wrap gap-3 text-sm font-bold"><span className="flex items-center gap-2"><Clock3 size={16} /> Friday · 9 PM</span><span className="flex items-center gap-2"><Users size={16} /> 16 people joined</span></div></div>
          <div className="rotate-2 overflow-hidden border-[6px] border-foreground shadow-pop"><img src={dreamerArtwork.url} alt="Illustrated city photographer above Mumbai buildings" className="aspect-square size-full object-cover" loading="lazy" /></div>
        </div>
      </section>

      <section id="guide" className="relative bg-background pb-8 pt-20 md:pt-28">
        <div className="mx-auto max-w-7xl px-5 text-center md:px-10"><p className="section-kicker">One city · endless scenes</p><h2 className="section-title mx-auto">Meet you somewhere<br /><span className="text-primary">in between.</span></h2></div>
        <div className="mt-10 w-full overflow-hidden border-b-4 border-foreground">
          <img src={skyline} alt="A continuous illustrated line of Mumbai landmarks including Gateway of India, Taj Mahal Palace, CST, Rajabai Clock Tower, Haji Ali, Asiatic Library, Sea Link, a BEST bus and local train" className="mx-auto h-auto min-w-[1050px] max-w-[1920px] translate-x-[-27%] md:min-w-full md:translate-x-0" loading="lazy" width={1920} height={768} />
        </div>
      </section>

      <footer className="bg-primary px-5 py-10 text-primary-foreground md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-end">
          <div><div className="flex items-center gap-2 text-xs font-bold uppercase"><Sparkles size={14} /> Find a plan. Find your people.</div><p className="mt-3 font-display text-4xl font-black uppercase">Bambai Side Up</p></div>
          <div className="flex gap-6 text-sm font-bold"><a href="#top">Map</a><a href="#scenes">Events</a><span>© 2026</span></div>
        </div>
      </footer>
    </main>
  );
}