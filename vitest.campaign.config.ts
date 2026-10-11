// Tests for the campaign feature only (kept apart from the app's own test setup):
//   npx vitest run --config vitest.campaign.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/campaign/**/*.test.ts", "src/lib/audio/analyze.test.ts", "src/lib/api/audio-result.test.ts", "supabase/functions/_shared/campaigns.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
