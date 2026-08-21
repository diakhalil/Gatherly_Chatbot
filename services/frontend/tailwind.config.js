module.exports = {
  content: [
    "./src/**/*.{js,jsx}",
    "./app/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        // These reference CSS variables from colors.css
        // Change the values in colors.css to update the entire app
        'warm-beige': 'var(--color-warm-beige)',
        'cream': 'var(--color-cream)',
        'blush': 'var(--color-blush)',
        'rose': 'var(--color-rose)',
        'mint': 'var(--color-mint)',
        'sage': 'var(--color-sage)',
        'pearl': 'var(--color-pearl)',
        'mist': 'var(--color-mist)',
        'sky': 'var(--color-sky)',
        'ocean': 'var(--color-ocean)',
      },
    },
  },
  plugins: [],
};
