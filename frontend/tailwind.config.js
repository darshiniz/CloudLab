/** Design system from the Build Guide, Prompt 0. Change tokens here, never in components. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0E1A',
        card: '#111827',
        line: 'rgba(255,255,255,0.10)',
        brand: { from: '#3B82F6', to: '#8B5CF6' },
        role: { student: '#3B82F6', faculty: '#14B8A6', admin: '#8B5CF6' },
        // Accent follows the logged-in role (set as a CSS variable on the layout)
        accent: 'rgb(var(--accent) / <alpha-value>)',
        status: {
          requested: '#94A3B8',
          queued: '#EAB308',
          provisioning: '#06B6D4',
          running: '#22C55E',
          inactive: '#F97316',
          stopped: '#64748B',
          failed: '#EF4444',
          terminated: '#475569',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      maxWidth: { content: '1280px' },
      boxShadow: {
        glow: '0 0 0 1px rgba(59,130,246,.35), 0 8px 30px -6px rgba(59,130,246,.35)',
        'glow-accent': '0 0 0 1px rgb(var(--accent) / .35), 0 8px 30px -6px rgb(var(--accent) / .35)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #3B82F6, #8B5CF6)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        blink: { '50%': { opacity: 0 } },
      },
      animation: {
        shimmer: 'shimmer 1.4s infinite',
        blink: 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
};
