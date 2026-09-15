// Regenerates public/images from the PNG masters in assets/source. Run with `npm run images`.
import { mkdir, rm } from 'node:fs/promises'
import sharp from 'sharp'

const SOURCE = new URL('../assets/source/', import.meta.url)
const OUT = new URL('../public/images/', import.meta.url)

const AVIF = { quality: 52, effort: 6 }
const WEBP = { quality: 80, effort: 6 }

async function emit(image: sharp.Sharp, name: string, widths: number[]) {
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

// The triptych is three equal-width panels, one per placeholder project.
const triptych = sharp(new URL('projects-triptych.png', SOURCE).pathname)
const { width = 0, height = 0 } = await triptych.metadata()
const panelWidth = Math.floor(width / 3)
for (const [index, slug] of ['neon-district', 'echo', 'horizon'].entries()) {
  const panel = sharp(
    await triptych
      .clone()
      .extract({ left: index * panelWidth, top: 0, width: panelWidth, height })
      .toBuffer(),
  )
  await emit(panel, `projects/${slug}`, [400, panelWidth])
}
