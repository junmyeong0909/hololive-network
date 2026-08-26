#!/usr/bin/env node
/**
 * 멤버 29명의 YouTube 채널 ID를 Holodex에서 가져와 src/data/channelIds.json에 저장한다.
 * 동시에 Worker가 쓸 엔드포인트들의 응답 형태를 검증해서 출력한다.
 *
 * 사용법:
 *   npm run setup:channels
 *   → 키를 물어본다. 환경변수 HOLODEX_API_KEY가 있으면 그걸 쓴다.
 *
 * 키는 저장되지 않는다. 결과 JSON에는 공개 채널 ID만 들어간다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_PATH = resolve(ROOT, 'src/data/hololiveData.json');
const OUT_PATH = resolve(ROOT, 'src/data/channelIds.json');

const API = 'https://holodex.net/api/v2';

/** 입력이 화면에 보이지 않게 키를 물어본다. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // 입력한 글자를 * 로 가린다
    rl._writeToOutput = function (chunk) {
      if (rl.stdoutMuted && chunk !== question) rl.output.write('*');
      else rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.stdoutMuted = false;
      rl.output.write('\n');
      rl.close();
      // Windows에서 stdin이 열린 채로 종료하면 libuv 어설션이 발생한다
      process.stdin.pause();
      resolve(answer.trim());
    });
    rl.stdoutMuted = true;
  });
}

let KEY = process.env.HOLODEX_API_KEY;

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
  if (!KEY) {
    KEY = await askHidden('Holodex API 키를 붙여넣고 Enter: ');
  }
  if (!KEY) {
    console.error('키가 입력되지 않았습니다.');
    process.exit(1);
  }

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
    console.log(`\n매칭 실패 ${unmatched.length}명 — 이름이 정확히 안 맞는 경우다`);
    console.log('(예: FUWAMOCO처럼 두 사람이 채널 하나를 공유하면 표기가 달라 자동 매칭이 안 될 수 있다)\n');
    for (const m of unmatched) {
      console.log(`  - ${m.id} (${m.nameEn})`);
      // 이름의 앞 4글자를 포함하는 후보를 찾아 같이 보여준다 (수동 확인용)
      const needle = norm(m.nameEn).slice(0, 4);
      const guesses = channels.filter((ch) => {
        const n = norm(ch.english_name ?? '');
        const n2 = norm(ch.name ?? '');
        return needle.length >= 3 && (n.includes(needle) || n2.includes(needle));
      });
      if (guesses.length) {
        console.log('      후보:');
        for (const g of guesses.slice(0, 5)) console.log(`        ${g.english_name ?? g.name}  →  ${g.id}`);
      }
    }
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
  if (String(e.message).includes('403')) {
    console.error('키가 올바른지 확인하세요. holodex.net → Account Settings에서 재발급할 수 있습니다.');
  }
  // process.exit()를 쓰면 Windows에서 stdin 정리 전에 종료돼 크래시가 난다
  process.exitCode = 1;
});
