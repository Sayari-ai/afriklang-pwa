// Tests for the campaign feature only (kept apart from the app's own test setup):
//   npx vitest run --config vitest.campaign.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/campaign/**/*.test.ts", "src/lib/security/**/*.test.ts", "src/lib/server/**/*.test.ts", "src/app/api/audio-upload/*.test.ts", "src/lib/audio/*.test.ts", "src/lib/api/audio-result.test.ts", "supabase/functions/_shared/campaigns.test.ts", "supabase/functions/campaigns/index.test.ts", "supabase/functions/campaigns/single-file.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
