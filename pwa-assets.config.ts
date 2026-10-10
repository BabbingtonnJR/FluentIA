import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // icon.svg already has its own margin around the kanji.
    maskable: { ...minimal2023Preset.maskable, padding: 0.15, resizeOptions: { background: '#c8402f' } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: '#c8402f' } },
  },
  images: ['public/icon.svg'],
});
