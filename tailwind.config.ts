import type { Config } from "tailwindcss";

// Starting tokens from 00-MASTER-README; refined in Tahap 3.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#2563EB",
        secondary: "#7C3AED",
        background: "#F8FAFC",
        surface: "#FFFFFF",
        ink: "#0F172A",
        muted: "#64748B",
      },
    },
  },
  plugins: [],
};
export default config;
