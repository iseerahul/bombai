/** @type {import('tailwindcss').Config} */

/*
 * Every colour here resolves to a CSS variable defined in src/index.css, in
 * `R G B` channel form so Tailwind's opacity modifiers (`bg-surface/80`) keep
 * working. That indirection is what lets one set of class names render both
 * the light and the dark theme — no `dark:` variant repeated on every element.
 *
 * Names are semantic (surface, border, accent) rather than literal (white,
 * slate-200) so a palette change happens in one file instead of forty.
 */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`

export default {
  // Light only. `dark:` variants stay in the source but never match, because
  // nothing ever puts a `.dark` class on the tree — see the note in index.css.
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds, in increasing prominence.
        canvas: token('--c-canvas'),
        surface: token('--c-surface'),
        raised: token('--c-raised'),
        sunken: token('--c-sunken'),
        hover: token('--c-hover'),

        // Text, in decreasing prominence.
        ink: token('--c-ink'),
        muted: token('--c-muted'),
        subtle: token('--c-subtle'),

        line: token('--c-line'),
        'line-strong': token('--c-line-strong'),

        // One accent, used for focus, links and active state — never for
        // status, so "coloured" never accidentally reads as "warning".
        accent: token('--c-accent'),
        'accent-ink': token('--c-accent-ink'),
        'accent-soft': token('--c-accent-soft'),

        // Status colours carry meaning; each has a fill and a readable ink.
        positive: token('--c-positive'),
        'positive-soft': token('--c-positive-soft'),
        'positive-ink': token('--c-positive-ink'),
        caution: token('--c-caution'),
        'caution-soft': token('--c-caution-soft'),
        'caution-ink': token('--c-caution-ink'),
        critical: token('--c-critical'),
        'critical-soft': token('--c-critical-soft'),
        'critical-ink': token('--c-critical-ink'),
        info: token('--c-info'),
        'info-soft': token('--c-info-soft'),
        'info-ink': token('--c-info-ink'),

        // Inverted surface — used by the user's own chat bubbles and primary
        // buttons, which must stay high-contrast in both themes.
        inverse: token('--c-inverse'),
        'inverse-ink': token('--c-inverse-ink'),
      },

      // A deliberately short scale. Every size below has a matching line-height
      // and tracking, so vertical rhythm doesn't drift between components.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.4rem' }],
        lg: ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }],
        xl: ['1.3125rem', { lineHeight: '1.75rem', letterSpacing: '-0.02em' }],
        '2xl': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
      },

      borderRadius: {
        card: '0.875rem',
        sheet: '1.25rem',
      },

      boxShadow: {
        // Three levels, no more. Ambient + direct in each, so edges read as
        // lifted rather than outlined-in-grey.
        low: '0 1px 2px rgb(var(--c-shadow) / 0.06), 0 1px 1px rgb(var(--c-shadow) / 0.04)',
        mid: '0 4px 12px -2px rgb(var(--c-shadow) / 0.10), 0 2px 4px -2px rgb(var(--c-shadow) / 0.06)',
        high: '0 16px 40px -12px rgb(var(--c-shadow) / 0.22), 0 4px 12px -4px rgb(var(--c-shadow) / 0.10)',
        sheet: '0 -12px 40px -12px rgb(var(--c-shadow) / 0.18)',
      },

      transitionTimingFunction: {
        // Slight overshoot-free ease used everywhere, so motion feels like one
        // system rather than each component picking its own curve.
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },

      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'sheet-in': {
          from: { transform: 'translateY(16px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        // The ring that leaves the current-location dot, as Google's does.
        // It starts a touch larger than the dot rather than at zero, so the
        // ring reads as leaving the dot instead of being born inside it.
        'locate-ping': {
          '0%': { transform: 'scale(0.35)', opacity: '0.55' },
          '70%': { opacity: '0' },
          '100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        // A small sympathetic breath on the dot itself. Without it the dot
        // sits dead still while rings fly off it, which looks like two
        // unrelated things stacked.
        'locate-breathe': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.12)' },
        },
      },

      animation: {
        'slide-up': 'slide-up 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 160ms ease-out both',
        'sheet-in': 'sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-soft': 'pulse-soft 1.4s ease-in-out infinite',
        'locate-ping': 'locate-ping 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
        'locate-breathe': 'locate-breathe 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
