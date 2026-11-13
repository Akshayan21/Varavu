import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e', timeout:30000,
  use:{baseURL:'http://localhost:5179'},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'pnpm --filter @billing/web exec vite --port 5179',url:'http://localhost:5179',env:{VITE_DATA_MODE:'mock'}},
});
