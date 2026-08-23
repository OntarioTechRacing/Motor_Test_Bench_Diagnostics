#!/usr/bin/env node
/** Crop OTR logo to a square favicon set (left-aligned OTR text). */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const source = resolve(root, '..', 'otrLogo-4.png')
const outDir = join(root, 'public')

const meta = await sharp(source).metadata()
const size = Math.min(meta.width, meta.height)
const left = 0
const top = Math.floor((meta.height - size) / 2)

const square = sharp(source).extract({ left, top, width: size, height: size })

const outputs = [
  { file: 'favicon-32.png', w: 32, h: 32 },
  { file: 'favicon-192.png', w: 192, h: 192 },
  { file: 'apple-touch-icon.png', w: 180, h: 180 },
  { file: 'favicon.png', w: 32, h: 32 },
]

for (const { file, w, h } of outputs) {
  const dest = join(outDir, file)
  await square.clone().resize(w, h).png().toFile(dest)
  console.log('wrote', dest)
}
