/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#080810',
        bg2: '#0f0f1a',
        bg3: '#16162a',
        bg4: '#1e1e35',
        accent: '#6366f1',
        accent2: '#818cf8',
        accent3: '#4f46e5',
        gold: '#f59e0b',
        green: '#10b981',
        red: '#ef4444',
        blue: '#3b82f6',
        muted: '#64748b',
        border: '#1e1e35',
        keshawn: '#FF69B4',
        sean: '#2E8B57',
        amari: '#FFD700',
        dart: '#722F37'
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        display: ['"Bebas Neue"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
