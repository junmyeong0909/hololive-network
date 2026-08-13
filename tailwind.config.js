/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        stage: {
          900: '#eaf6fd',
          800: '#e1f2fc',
          700: '#d3ecfa',
          600: '#c2e4f6',
          border: '#b7ddf1',
        },
        ink: {
          100: '#173247',
          300: '#4d7085',
          500: '#7c98aa',
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
