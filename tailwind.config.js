/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(11 14 18 / <alpha-value>)',
        surface: 'rgb(18 23 29 / <alpha-value>)',
        line: 'rgb(34 42 51 / <alpha-value>)',
        ink: 'rgb(233 237 242 / <alpha-value>)',
        mute: 'rgb(138 149 163 / <alpha-value>)',
        accent: 'rgb(242 184 75 / <alpha-value>)',
        good: 'rgb(95 208 138 / <alpha-value>)',
        bad: 'rgb(240 112 126 / <alpha-value>)',
        warn: 'rgb(227 169 77 / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
