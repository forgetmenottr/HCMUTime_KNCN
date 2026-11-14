/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // The solver worker is created with { type: "module" }.
    format: 'es',
  },
  test: {
    // Library and model code is DOM-free, so plain Node is the default.
    // A UI test (tests/*.test.tsx) opts into the DOM with a first-line comment:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
