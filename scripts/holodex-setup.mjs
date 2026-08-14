#!/usr/bin/env node
/**
 * 멤버 29명의 YouTube 채널 ID를 Holodex에서 가져와 src/data/channelIds.json에 저장한다.
 * 동시에 Worker가 쓸 엔드포인트들의 응답 형태를 검증해서 출력한다.
 *
 * 사용법:
 *   HOLODEX_API_KEY=xxxxx node scripts/holodex-setup.mjs
 *
 * 키는 저장되지 않는다. 결과 JSON에는 공개 채널 ID만 들어간다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_PATH = resolve(ROOT, 'src/data/hololiveData.json');
const OUT_PATH = resolve(ROOT, 'src/data/channelIds.json');

const API = 'https://holodex.net/api/v2';
const KEY = process.env.HOLODEX_API_KEY;

if (!KEY) {
  console.error('HOLODEX_API_KEY 환경변수가 없습니다.\n예) HOLODEX_API_KEY=xxxxx node scripts/holodex-setup.mjs');
  process.exit(1);
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-APIKEY': KEY } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// 이름 표기 차이를 흡수 ("Roboco San" vs "Robocosan")
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function fetchAllHololiveChannels() {
  const all = [];
  const limit = 100;
  for (let offset = 0; offset < 500; offset += limit) {
    const page = await api(`/channels?org=Hololive&type=vtuber&limit=${limit}&offset=${offset}`);
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    if (page.length < limit) break;
  }
  return all;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const members = data.members;

  console.log(`멤버 ${members.length}명 / Holodex 채널 목록 조회 중...`);
  const channels = await fetchAllHololiveChannels();
  console.log(`Holodex에서 홀로라이브 채널 ${channels.length}개 수신\n`);

  const byName = new Map();
  for (const ch of channels) {
    if (ch.english_name) byName.set(norm(ch.english_name), ch);
    if (ch.name) byName.set(norm(ch.name), ch);
  }

  const mapping = {};
  const unmatched = [];

  for (const m of members) {
    const hit = byName.get(norm(m.nameEn)) ?? byName.get(norm(m.name));
    if (hit) {
      mapping[m.id] = hit.id;
    } else {
      unmatched.push(m);
    }
  }

  console.log(`매칭 성공 ${Object.keys(mapping).length}명`);
  if (unmatched.length) {
    console.log(`\n매칭 실패 ${unmatched.length}명 — 수동으로 채워야 합니다:`);
    for (const m of unmatched) console.log(`  - ${m.id} (${m.nameEn})`);
    console.log('\n참고: Holodex에 있는 이름 목록 일부');
    for (const ch of channels.slice(0, 40)) console.log(`  ${ch.english_name ?? ch.name}  →  ${ch.id}`);
  }

  writeFileSync(OUT_PATH, JSON.stringify(mapping, null, 2) + '\n', 'utf-8');
  console.log(`\n저장: ${OUT_PATH}`);

  // ---- Worker가 쓸 엔드포인트 응답 형태 검증 ----
  const ids = Object.values(mapping);
  if (ids.length === 0) {
    console.log('\n채널 ID가 없어 엔드포인트 검증을 건너뜁니다.');
    return;
  }

  console.log('\n=== 엔드포인트 검증 ===');

  try {
    const live = await api(`/users/live?channels=${ids.join(',')}`);
    console.log(`/users/live → ${Array.isArray(live) ? live.length : '?'}건`);
    if (Array.isArray(live) && live.length) {
      const s = live[0];
      console.log('  샘플 필드:', Object.keys(s).join(', '));
      console.log('  status:', s.status, '| topic_id:', s.topic_id, '| live_viewers:', s.live_viewers);
      console.log('  channel 필드:', s.channel ? Object.keys(s.channel).join(', ') : '(없음)');
    } else {
      console.log('  (지금 라이브/예정인 멤버가 없어 샘플 없음 — 정상)');
    }
  } catch (e) {
    console.log('/users/live 실패:', e.message);
  }

  try {
    const vids = await api('/videos?org=Hololive&status=past&type=stream&limit=5&sort=available_at&order=desc');
    console.log(`/videos → ${Array.isArray(vids) ? vids.length : '?'}건`);
    if (Array.isArray(vids) && vids.length) {
      const v = vids[0];
      console.log('  샘플 필드:', Object.keys(v).join(', '));
      console.log('  topic_id:', v.topic_id, '| available_at:', v.available_at);
      console.log('  channel 필드:', v.channel ? Object.keys(v.channel).join(', ') : '(없음)');
    }
  } catch (e) {
    console.log('/videos 실패:', e.message);
  }

  console.log('\n완료. 위 출력을 그대로 복사해서 알려주시면 Worker를 맞춰 조정합니다.');
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exit(1);
});
