/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#C15F3C",
        secondary: "#3b82f6",
        /*
         * Semantic tokens, so one class works in both themes.
         *
         * The UI was written against `white` at a dozen opacities, which only
         * reads on a dark surface. Defining the channels as a variable and
         * letting Tailwind supply the alpha keeps every one of those opacities
         * intact while making light mode a matter of swapping three lines in
         * index.css, rather than adding a `dark:` twin to every utility.
         */
        fg: "rgb(var(--fg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        sunken: "rgb(var(--sunken) / <alpha-value>)",
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
      },
    },
  },
  plugins: [],
};
