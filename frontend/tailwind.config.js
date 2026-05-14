
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:       "#0d0d14",
        surface:  "#14141f",
        border:   "#1f1f30",
        accent:   "#7c3aed",
        accentLt: "#a78bfa",
        fetch:    "#0ea5e9",
        issue:    "#f59e0b",
        execute:  "#10b981",
        retire:   "#6366f1",
        waste:    "#ef4444",
        fwd:      "#ec4899",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};