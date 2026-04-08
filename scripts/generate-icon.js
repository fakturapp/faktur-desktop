'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const SIZE = 512
const OUT_DIR = path.resolve(__dirname, '..', 'build')
const OUT_PNG = path.join(OUT_DIR, 'icon.png')
const OUT_ICO = path.join(OUT_DIR, 'icon.ico')

const PRIMARY = [0x63, 0x66, 0xf1, 0xff]
const DARKER = [0x4f, 0x46, 0xe5, 0xff]
const WHITE = [0xff, 0xff, 0xff, 0xff]
const PUPIL = [0x1e, 0x1b, 0x4b, 0xff]
const SOFT = [0xa5, 0xb4, 0xfc, 0x80]
const TRANSPARENT = [0, 0, 0, 0]

function crc32(buf) {
  let crc = -1 >>> 0
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

function insideCircle(px, py, cx, cy, r) {
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

function insideEllipse(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx
  const dy = (py - cy) / ry
  return dx * dx + dy * dy <= 1
}

function pixel(px, py) {
  const scale = SIZE / 400
  const x = px / scale
  const y = py / scale

  const bodyX = 60
  const bodyY = 20
  const bodyW = 280
  const bodyH = 360
  const radius = 40

  const localX = x - bodyX
  const localY = y - bodyY

  let insideBody = false
  if (localX >= 0 && localX < bodyW && localY >= 0 && localY < bodyH) {
    insideBody = true
    if (localX < radius && localY < radius) {
      insideBody = insideCircle(localX, localY, radius, radius, radius)
    } else if (localX >= bodyW - radius && localY >= bodyH - radius) {
      insideBody = insideCircle(localX, localY, bodyW - radius - 1, bodyH - radius - 1, radius)
    } else if (localX < radius && localY >= bodyH - radius) {
      insideBody = insideCircle(localX, localY, radius, bodyH - radius - 1, radius)
    } else if (localX >= bodyW - radius && localY < 60) {
      const cornerX = bodyW - radius - 1
      const cornerY = radius
      if (localY < radius && localX >= bodyW - radius) {
        insideBody = insideCircle(localX, localY, cornerX, cornerY, radius)
      }
    }
  }

  if (!insideBody) return TRANSPARENT

  if (localX > 190 && localY < 90 && localX - 190 < 90 - localY + 90) {
    if (localX + (90 - localY) > 280) return DARKER
  }
  if (localX >= 190 && localY < 90) {
    const dx = localX - 190
    const dy = 90 - localY
    if (dx < 90 && dy < 90 && dx + (90 - dy) < 90) return DARKER
  }

  if (insideEllipse(localX, localY, 90, 150, 30, 32)) {
    if (insideEllipse(localX, localY, 98, 146, 15, 16)) return PUPIL
    return WHITE
  }
  if (insideEllipse(localX, localY, 190, 150, 30, 32)) {
    if (insideEllipse(localX, localY, 198, 146, 15, 16)) return PUPIL
    return WHITE
  }

  if (insideEllipse(localX, localY, 70, 200, 20, 12)) return SOFT
  if (insideEllipse(localX, localY, 210, 200, 20, 12)) return SOFT

  const smileDx = localX - 140
  const smileDy = localY - 220
  if (smileDx * smileDx + smileDy * smileDy >= 30 * 30 &&
      smileDx * smileDx + smileDy * smileDy <= 45 * 45 &&
      smileDy > 0) {
    return WHITE
  }

  return PRIMARY
}

function createPng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const rowLen = 1 + SIZE * 4
  const raw = Buffer.alloc(rowLen * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * rowLen] = 0
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b, a] = pixel(x, y)
      const off = y * rowLen + 1 + x * 4
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
      raw[off + 3] = a
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 })

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function createIcoFromPng(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry[0] = 0
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12)

  return Buffer.concat([header, entry, png])
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const png = createPng()
  fs.writeFileSync(OUT_PNG, png)
  const ico = createIcoFromPng(png)
  fs.writeFileSync(OUT_ICO, ico)
  console.log(`[generate-icon] wrote ${path.relative(process.cwd(), OUT_PNG)} (${png.length} bytes, ${SIZE}x${SIZE})`)
  console.log(`[generate-icon] wrote ${path.relative(process.cwd(), OUT_ICO)} (${ico.length} bytes)`)
}

main()
