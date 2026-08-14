/** @type {import('tailwindcss').Config} */

// 색은 index.css의 CSS 변수로 정의하고 여기서는 참조만 한다.
// 그래야 .dark 클래스 하나로 전체 테마가 바뀌고, 컴포넌트의
// stage-*/ink-* 클래스를 손대지 않아도 된다.
// <alpha-value>를 쓰려면 변수 값이 "R G B" 형태여야 한다 (bg-stage-700/60 등).
const withAlpha = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        stage: {
          900: withAlpha('--stage-900'),
          800: withAlpha('--stage-800'),
          700: withAlpha('--stage-700'),
          600: withAlpha('--stage-600'),
          border: withAlpha('--stage-border'),
        },
        ink: {
          100: withAlpha('--ink-100'),
          300: withAlpha('--ink-300'),
          500: withAlpha('--ink-500'),
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
