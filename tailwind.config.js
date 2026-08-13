/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        stage: {
          900: '#0b0a14',
          800: '#12101f',
          700: '#1a1730',
          600: '#242040',
          border: '#2c2748',
        },
        ink: {
          100: '#f4f2ff',
          300: '#c7c2e0',
          500: '#8d87ad',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 24px -4px var(--tw-shadow-color)',
      },
    },
  },
  plugins: [],
};
