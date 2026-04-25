import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:   'com.ngames.nstreams',
  appName: 'N Streams',
  webDir:  'dist',

  android: {
    backgroundColor: '#070714',
    // Allow the WebView to reach Railway API (HTTPS) and streaming sites
    allowMixedContent: false,
  },

  plugins: {
    Browser: {},
  },
};

export default config;
