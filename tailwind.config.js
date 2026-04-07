/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rose: {
          DEFAULT: '#ff3d78',
          lt: '#ff7aaa',
        },
        gold: '#f5c842',
        bg: '#08080f',
        card: '#11111e',
        muted: 'rgba(240,238,255,0.35)',
        text: '#f0eeff',
      },
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['DM Sans', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
