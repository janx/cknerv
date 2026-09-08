import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A preview crawler reads HTML without running React or connecting to a node.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');

function content(attribute: 'name' | 'property', key: string): string {
  const tags = page.head.querySelectorAll(`meta[${attribute}="${key}"]`);
  expect(tags, `${key} must occur exactly once in the static head`).toHaveLength(1);
  const value = tags[0].getAttribute('content')?.trim() ?? '';
  expect(value, `${key} must not be empty`).not.toBe('');
  return value;
}

describe('share previews without JavaScript', () => {
  it('provides a consistent title and description to HTML, Open Graph and Twitter consumers', () => {
    const description = content('name', 'description');
    const title = content('property', 'og:title');
    expect(title).toContain(page.title);
    expect(content('property', 'og:description')).toBe(description);
    expect(content('name', 'twitter:title')).toBe(title);
    expect(content('name', 'twitter:description')).toBe(description);
    expect(content('property', 'og:type')).toBe('website');
    expect(content('property', 'og:site_name')).toBe(page.title);
    expect(content('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('uses absolute public URLs and a bundled PNG with matching dimensions', () => {
    const site = new URL(content('property', 'og:url'));
    const imageUrl = new URL(content('property', 'og:image'));
    expect(site.protocol).toBe('https:');
    expect(imageUrl.origin).toBe(site.origin);
    expect(content('name', 'twitter:image')).toBe(imageUrl.href);
    expect(content('property', 'og:image:type')).toBe('image/png');
    expect(content('name', 'twitter:image:alt')).toBe(content('property', 'og:image:alt'));

    // Vite copies public/ into dist, which the CLI embeds. Validate the bytes,
    // so a missing file, an SVG renamed to .png, or stale size tags fail here.
    const png = readFileSync(resolve(process.cwd(), 'public', imageUrl.pathname.slice(1)));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(Number(content('property', 'og:image:width')));
    expect(png.readUInt32BE(20)).toBe(Number(content('property', 'og:image:height')));
  });
});
