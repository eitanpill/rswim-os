// Makes the app's icon and splash sources from one of the options in assets/options, then the native sizes.
// Usage: node scripts/icons.mjs d-swimmer   (then `pnpm assets` writes every iOS and Android size)
import sharp from 'sharp';

const option = process.argv[2] ?? 'd-swimmer';
const svg = new URL(`../assets/options/${option}.svg`, import.meta.url).pathname;
const out = (name) => new URL(`../assets/${name}`, import.meta.url).pathname;

// The stores round the corners themselves: the icon is a full square.
await sharp(svg)
  .resize(1024, 1024)
  .flatten({ background: '#1f7fb8' })
  .png()
  .toFile(out('icon-only.png'));

// Splash: the icon, rounded, in the middle of the brand colour (dark mode: deep water).
const mark = await sharp(svg)
  .resize(640, 640)
  .composite([
    {
      input: Buffer.from(
        '<svg width="640" height="640"><rect width="640" height="640" rx="144" fill="#fff"/></svg>',
      ),
      blend: 'dest-in',
    },
  ])
  .png()
  .toBuffer();
for (const [name, background] of [
  ['splash.png', '#1f7fb8'],
  ['splash-dark.png', '#0b2a3d'],
]) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(out(name));
}
console.log(`icon and splash from ${option}`);
