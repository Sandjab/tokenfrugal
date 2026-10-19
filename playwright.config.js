// playwright.config.js — tests de la page générée, ouverte en file:// (aucun serveur).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: { timezoneId: 'Europe/Paris', locale: 'fr-FR', colorScheme: 'light' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
