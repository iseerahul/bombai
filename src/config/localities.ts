/**
 * Mumbai locality gazetteer, shipped with the app.
 *
 * This exists so that "near Andheri East" resolves ON THE DEVICE. Sending a
 * place name to a geocoding service would leak where the user is asking about,
 * which defeats the point. A few dozen hand-entered centres cost nothing and
 * cover the way people actually name places here.
 *
 * Centres are approximate (locality centroids, ~200-500m). They anchor a search
 * radius, not a precise point, so that accuracy is sufficient.
 */

export interface Locality {
  name: string
  aliases: string[]
  lat: number
  lon: number
  /** Default search radius when the user names this area. */
  radiusM: number
}

export const MUMBAI_CENTER = { lat: 19.076, lon: 72.8777 }

export const LOCALITIES: Locality[] = [
  // --- Western suburbs ---
  { name: 'Andheri East', aliases: ['andheri e', 'andheri-east'], lat: 19.1136, lon: 72.8697, radiusM: 2500 },
  { name: 'Andheri West', aliases: ['andheri w', 'andheri-west'], lat: 19.1364, lon: 72.8296, radiusM: 2500 },
  { name: 'Andheri', aliases: [], lat: 19.1197, lon: 72.8464, radiusM: 3500 },
  { name: 'Bandra East', aliases: ['bandra e'], lat: 19.0607, lon: 72.8446, radiusM: 2000 },
  { name: 'Bandra West', aliases: ['bandra w'], lat: 19.0596, lon: 72.8295, radiusM: 2000 },
  { name: 'Bandra', aliases: ['bandstand'], lat: 19.0596, lon: 72.8365, radiusM: 3000 },
  { name: 'Khar', aliases: ['khar west', 'khar road'], lat: 19.0728, lon: 72.8368, radiusM: 1800 },
  { name: 'Santacruz', aliases: ['santa cruz'], lat: 19.081, lon: 72.8417, radiusM: 2200 },
  { name: 'Vile Parle', aliases: ['ville parle', 'parle'], lat: 19.0995, lon: 72.8443, radiusM: 2000 },
  { name: 'Jogeshwari', aliases: [], lat: 19.1355, lon: 72.8479, radiusM: 2200 },
  { name: 'Goregaon', aliases: [], lat: 19.1663, lon: 72.8526, radiusM: 3000 },
  { name: 'Malad', aliases: [], lat: 19.1864, lon: 72.8484, radiusM: 3000 },
  { name: 'Kandivali', aliases: ['kandivli'], lat: 19.2049, lon: 72.8515, radiusM: 3000 },
  { name: 'Borivali', aliases: ['borivli'], lat: 19.2307, lon: 72.8567, radiusM: 3000 },
  { name: 'Dahisar', aliases: [], lat: 19.2497, lon: 72.8591, radiusM: 2500 },
  { name: 'Juhu', aliases: ['juhu beach'], lat: 19.0968, lon: 72.8267, radiusM: 2000 },
  { name: 'Versova', aliases: [], lat: 19.1317, lon: 72.8134, radiusM: 2000 },
  { name: 'Lokhandwala', aliases: [], lat: 19.1408, lon: 72.8248, radiusM: 1800 },

  // --- Central / island city ---
  { name: 'Dadar', aliases: ['dadar tt', 'dadar west', 'dadar east'], lat: 19.0178, lon: 72.8478, radiusM: 2500 },
  { name: 'Mahim', aliases: [], lat: 19.0411, lon: 72.8409, radiusM: 2000 },
  { name: 'Matunga', aliases: [], lat: 19.0272, lon: 72.8564, radiusM: 1800 },
  { name: 'Sion', aliases: ['sion circle'], lat: 19.0396, lon: 72.8619, radiusM: 2000 },
  { name: 'Wadala', aliases: [], lat: 19.0176, lon: 72.8562, radiusM: 2200 },
  { name: 'Parel', aliases: ['parel tt', 'lower parel'], lat: 18.9989, lon: 72.8368, radiusM: 2000 },
  { name: 'Worli', aliases: ['worli naka'], lat: 19.0088, lon: 72.8175, radiusM: 2200 },
  { name: 'Prabhadevi', aliases: ['elphinstone'], lat: 19.0166, lon: 72.8298, radiusM: 1600 },
  { name: 'Byculla', aliases: [], lat: 18.9755, lon: 72.8324, radiusM: 1800 },
  { name: 'Mumbai Central', aliases: ['bombay central'], lat: 18.9712, lon: 72.8206, radiusM: 1800 },
  { name: 'Tardeo', aliases: [], lat: 18.9686, lon: 72.8106, radiusM: 1500 },
  { name: 'Grant Road', aliases: [], lat: 18.9629, lon: 72.8156, radiusM: 1500 },
  { name: 'Girgaon', aliases: ['girgaum', 'charni road'], lat: 18.9548, lon: 72.8163, radiusM: 1500 },
  { name: 'Marine Lines', aliases: ['marine drive'], lat: 18.9432, lon: 72.8235, radiusM: 1500 },
  { name: 'Churchgate', aliases: [], lat: 18.9322, lon: 72.8264, radiusM: 1200 },
  { name: 'Fort', aliases: ['cst', 'chhatrapati shivaji terminus', 'vt'], lat: 18.9339, lon: 72.8356, radiusM: 1500 },
  { name: 'Colaba', aliases: ['causeway', 'gateway of india'], lat: 18.9067, lon: 72.8147, radiusM: 2000 },
  { name: 'Masjid Bunder', aliases: ['masjid'], lat: 18.9502, lon: 72.8375, radiusM: 1200 },
  { name: 'Dharavi', aliases: [], lat: 19.0404, lon: 72.8505, radiusM: 1800 },

  // --- Eastern suburbs ---
  { name: 'Kurla', aliases: ['kurla east', 'kurla west'], lat: 19.0654, lon: 72.8794, radiusM: 2500 },
  { name: 'Ghatkopar', aliases: [], lat: 19.0857, lon: 72.9081, radiusM: 2500 },
  { name: 'Vikhroli', aliases: [], lat: 19.1075, lon: 72.9256, radiusM: 2200 },
  { name: 'Bhandup', aliases: [], lat: 19.1425, lon: 72.9367, radiusM: 2500 },
  { name: 'Mulund', aliases: [], lat: 19.1726, lon: 72.9425, radiusM: 2500 },
  { name: 'Powai', aliases: ['iit bombay', 'hiranandani'], lat: 19.1176, lon: 72.906, radiusM: 2200 },
  { name: 'Chembur', aliases: [], lat: 19.0623, lon: 72.8997, radiusM: 2500 },
  { name: 'Govandi', aliases: [], lat: 19.0553, lon: 72.9198, radiusM: 2000 },
  { name: 'Mankhurd', aliases: [], lat: 19.0489, lon: 72.9302, radiusM: 2000 },
  { name: 'Sakinaka', aliases: ['saki naka'], lat: 19.1024, lon: 72.888, radiusM: 1800 },
  { name: 'Marol', aliases: [], lat: 19.1131, lon: 72.8797, radiusM: 1800 },
  { name: 'BKC', aliases: ['bandra kurla complex', 'bandra kurla'], lat: 19.0662, lon: 72.8697, radiusM: 2000 },
]

/** Normalise for matching: lowercase, strip punctuation, collapse whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find a locality named anywhere in the text. Longest name wins, so
 * "Andheri East" beats the bare "Andheri" it contains.
 */
export function matchLocality(text: string): Locality | null {
  const haystack = norm(text)
  let best: Locality | null = null
  let bestLen = 0

  for (const loc of LOCALITIES) {
    for (const candidate of [loc.name, ...loc.aliases]) {
      const needle = norm(candidate)
      if (!needle) continue
      // Word-boundary check so "khar" doesn't match inside "kharghar".
      const re = new RegExp(`(^|\\s)${needle.replace(/\s+/g, '\\s+')}($|\\s)`, 'u')
      if (re.test(haystack) && needle.length > bestLen) {
        best = loc
        bestLen = needle.length
      }
    }
  }
  return best
}

/** Resolve a name the LLM returned (which may not be in our list) to a centre. */
export function localityByName(name: string | null): Locality | null {
  if (!name) return null
  return matchLocality(name)
}

/**
 * The closest named locality to a point.
 *
 * Used to label an activity created from someone's current position: "Around
 * Bandra West" is a useful thing to read on a bubble, where a pair of decimal
 * coordinates is not. Brute force over a few dozen centres — a spatial index
 * would be more code than the loop it replaces.
 */
export function nearestLocality(lat: number, lon: number): Locality | null {
  let best: Locality | null = null
  let bestDistance = Infinity
  for (const l of LOCALITIES) {
    // Squared degrees, scaled for longitude convergence. Comparing rather than
    // reporting, so there is no need for a real haversine here.
    const dLat = l.lat - lat
    const dLon = (l.lon - lon) * 0.945
    const d = dLat * dLat + dLon * dLon
    if (d < bestDistance) {
      bestDistance = d
      best = l
    }
  }
  return best
}
