import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'/tmp/spn128-review-a-d22b-probes',testMatch:['trace-ownership.spec.ts','attachments.spec.ts'],outputDir:'/tmp/spn128-review-a-d22b-probes/results',workers:1,retries:0,timeout:30000,reporter:[['list'],['json',{outputFile:'/tmp/spn128-review-a-d22b-probes/results.json'}]],use:{headless:true}});
