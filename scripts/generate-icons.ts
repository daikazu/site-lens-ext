import sharp from 'sharp';
import { mkdirSync } from 'fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="16" fill="#1e1e1e"/>
  <text x="64" y="72" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="40" fill="#4fc1ff" text-anchor="middle">SEO</text>
</svg>`;

const sizes = [16, 48, 128];

async function generate() {
  mkdirSync('public/icons', { recursive: true });
  for (const size of sizes) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`public/icons/icon${size}.png`);
  }
  console.log('Icons generated successfully');
}

generate();
