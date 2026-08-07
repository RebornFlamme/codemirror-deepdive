import { defineConfig } from "vitest/config"

export default defineConfig({
  // La démo navigateur arrive à l'étape 5 ; on ajoutera `root: "demo"` ici.
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
})
