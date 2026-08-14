#!/usr/bin/env node
/**
 * 팔레트 PNG의 흰 배경을 투명하게 만든다 (누끼).
 *
 * imgs/background/images.png 는 colorType 3(팔레트)에 tRNS 청크가 없어서
 * 흰 배경이 그대로 사각형으로 보인다. 팔레트에서 흰색에 가까운 항목을 찾아
 * alpha=0으로 지정하는 tRNS 청크를 넣어준다. 원본은 건드리지 않는다.
 *
 * 사용법: node scripts/make-logo-transparent.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'imgs/background/images.png');
const OUT = resolve(ROOT, 'public/bg/hololive-mark.png');

// 이 값 이상으로 밝고 무채색이면 배경으로 간주
const WHITE_MIN = 246;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** PNG를 청크 배열로 분해 */
function parseChunks(buf) {
  const chunks = [];
  let off = 8; // 시그니처
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

const src = readFileSync(SRC);
if (src.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG가 아닙니다');

const colorType = src[25];
if (colorType !== 3) {
  throw new Error(`팔레트 PNG(colorType 3)가 아닙니다. 실제: ${colorType}`);
}

const chunks = parseChunks(src);
const plte = chunks.find((c) => c.type === 'PLTE');
if (!plte) throw new Error('PLTE 청크가 없습니다');

const entryCount = plte.data.length / 3;
const alpha = Buffer.alloc(entryCount, 255);

let transparentCount = 0;
for (let i = 0; i < entryCount; i++) {
  const r = plte.data[i * 3];
  const g = plte.data[i * 3 + 1];
  const b = plte.data[i * 3 + 2];
  if (r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN) {
    alpha[i] = 0;
    transparentCount++;
  }
}

if (transparentCount === 0) {
  console.warn('흰색 팔레트 항목을 못 찾았습니다. WHITE_MIN을 낮춰보세요.');
}

// 기존 tRNS는 버리고 새로 만든다. tRNS는 PLTE 뒤, IDAT 앞에 와야 한다.
const out = [Buffer.from(src.subarray(0, 8))];
for (const c of chunks) {
  if (c.type === 'tRNS') continue;
  out.push(makeChunk(c.type, c.data));
  if (c.type === 'PLTE') out.push(makeChunk('tRNS', alpha));
}

writeFileSync(OUT, Buffer.concat(out));

console.log(`팔레트 ${entryCount}개 중 ${transparentCount}개를 투명 처리`);
console.log(`저장: ${OUT}`);
