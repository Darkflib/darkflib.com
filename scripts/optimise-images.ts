// Regenerates public/images from the PNG masters in assets/source. Run with `npm run images`.
import { mkdir, readdir, rm } from 'node:fs/promises'
import sharp, { type Sharp } from 'sharp'

const SOURCE = new URL('../assets/source/', import.meta.url)
const OUT = new URL('../public/images/', import.meta.url)

const AVIF = { quality: 52, effort: 6 }
const WEBP = { quality: 80, effort: 6 }

async function emit(image: Sharp, name: string, widths: number[]) {
  for (const width of widths) {
    const resized = image.clone().resize({ width, withoutEnlargement: true })
    const avif = await resized
      .clone()
      .avif(AVIF)
      .toFile(new URL(`${name}-${width}.avif`, OUT).pathname)
    const webp = await resized
      .clone()
      .webp(WEBP)
      .toFile(new URL(`${name}-${width}.webp`, OUT).pathname)
    console.log(`${name}-${width}: ${avif.width}x${avif.height} avif ${kb(avif.size)} webp ${kb(webp.size)}`)
  }
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)}KB`

await rm(OUT, { recursive: true, force: true })
await mkdir(new URL('projects/', OUT), { recursive: true })

await emit(sharp(new URL('hero-city.png', SOURCE).pathname), 'hero-city', [800, 1280, 1672])

// Link-preview card (og:image): 1200x630, JPEG because not every unfurler reads AVIF or WebP.
const og = await sharp(new URL('hero-city.png', SOURCE).pathname)
  .resize({ width: 1200, height: 630, fit: 'cover' })
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(new URL('og-card.jpg', OUT).pathname)
console.log(`og-card: ${og.width}x${og.height} jpeg ${kb(og.size)}`)

// Project cards: square masters cropped from screenshots of each project.
for (const file of (await readdir(new URL('projects/', SOURCE))).filter((name) => name.endsWith('.png'))) {
  await emit(sharp(new URL(`projects/${file}`, SOURCE).pathname), `projects/${file.replace(/\.png$/, '')}`, [400, 800])
}
