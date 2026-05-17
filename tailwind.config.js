/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
      },
      colors: {
        ink: '#1a1410',
        bone: '#f5efe6',
        jade: '#0a6e54',
        cinnabar: '#c8412e',
        gold: '#c9a449',
        bamboo: '#3d5a3d',
      },
    },
  },
  plugins: [],
};
