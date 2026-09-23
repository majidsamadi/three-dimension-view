import type { CapacitorConfig } from '@capacitor/cli'
const config: CapacitorConfig = {
  appId: 'com.wisestay.threedimensionview', appName: 'Three Dimension View', webDir: 'dist',
  backgroundColor: '#f5f8f7',
  // No remote server.url: the Vue application is bundled and runs on the phone.
  server: { androidScheme: 'https', iosScheme: 'capacitor' },
  ios: { contentInset: 'never', scrollEnabled: false },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
}
export default config
