/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0b0b12',
        ink: '#ffffff',
        cream: {
          50: '#fdfcf9',
          100: '#faf7f0',
          200: '#f3ecdb',
          300: '#ebe0c5',
          400: '#e2d4b0',
          500: '#d9c89b',
          600: '#b7a679',
          700: '#948357',
          800: '#6f6040',
          900: '#4b3e29',
          950: '#291f14',
        },
        pistachio: {
          50: '#f5fbf5',
          100: '#e6f6e6',
          200: '#c8ecc9',
          300: '#a5e0a8',
          400: '#7dd486',
          500: '#55c966',
          600: '#37a749',
          700: '#2a7c37',
          800: '#1d5525',
          900: '#112f15',
          950: '#081a0b',
        },
        accent: {
          DEFAULT: '#55c966',
          foreground: '#0b0b12',
        },
        surface: {
          100: '#13131b',
          200: '#181823',
          300: '#1f202c',
          400: '#262733',
          500: '#2d2f3c',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
