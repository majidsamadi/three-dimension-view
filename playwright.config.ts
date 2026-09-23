import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/e2e', timeout: 60000, expect: { timeout: 10000 },
  fullyParallel: false, forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } },
  ],
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 120000 },
})
