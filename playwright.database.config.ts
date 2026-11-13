import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/database-browser',timeout:30000,
  use:{baseURL:'http://localhost:5180'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'pnpm --filter @billing/web exec vite --port 5180',url:'http://localhost:5180',
    env:{VITE_DATA_MODE:'database',VITE_API_URL:'http://localhost:5180/api/v1',VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''}},
});
