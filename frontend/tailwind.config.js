/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#0D0D0D',
        accent: '#E31B23',
        surface: '#1A1A1A',
        highlight: '#2A2A2A',
        'light-gray': '#B0B0B0'
      },
      fontFamily: {
        heading: ['"Exo 2"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
