/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#050510',
        'surface-1': '#050510',
        'surface-2': '#0e0e1a',
        'surface-3': '#17172a',
        'surface-4': '#22223b',
        bg2: '#0e0e1a',
        bg3: '#17172a',
        bg4: '#22223b',
        accent: '#6366f1',
        accent2: '#818cf8',
        accent3: '#4f46e5',
        'accent-hot': '#a78bfa',
        gold: '#f59e0b',
        green: '#10b981',
        red: '#ef4444',
        blue: '#3b82f6',
        muted: '#64748b',
        'text-dim': '#cbd5e1',
        border: '#1e1e35',
        keshawn: '#FF69B4',
        sean: '#2E8B57',
        amari: '#FFD700',
        dart: '#722F37'
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        'sm': '4px',
        DEFAULT: '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px'
      },
      boxShadow: {
        'sm': '0 2px 8px rgba(0, 0, 0, 0.3)',
        'md': '0 8px 24px rgba(0, 0, 0, 0.45)',
        'lg': '0 24px 60px rgba(0, 0, 0, 0.6)',
        'glow': '0 0 40px rgba(99, 102, 241, 0.35)',
        'glow-strong': '0 0 60px rgba(99, 102, 241, 0.55)'
      }
    }
  },
  plugins: []
};
