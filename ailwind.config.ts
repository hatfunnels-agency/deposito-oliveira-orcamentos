import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0fdf4',
                      500: '#22c55e',
                      600: '#16a34a',
                      700: '#15803d',
            },
                    orange: {
          500: '#f97316',
                      600: '#ea580c',
            }
      },
},
},
  plugins: [],
    };
export default config;
