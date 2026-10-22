export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        nexora: { ink: '#202632', violet: '#7061d8', green: '#388c70', canvas: '#f6f7f8' },
      },
      fontFamily: { sans: ['DM Sans', 'sans-serif'], heading: ['Manrope', 'sans-serif'] },
    },
  },
  plugins: [],
}
