#!/usr/bin/env node
/**
 * 멤버별 최신 커버/오리지널 곡을 5개씩 받아 src/data/memberSongs.json에 저장한다.
 *
 * 실시간 피드(Worker)는 최근 활동만 담기 때문에, 요즘 활동이 뜸한 멤버의 노드를
 * 클릭하면 알림 피드가 비어 버린다. 이 정적 아카이브를 함께 병합해 빈 화면을 없앤다.
 *
 * 사용법:
 *   npm run setup:songs
 *   → 키를 물어본다. 환경변수 HOLODEX_API_KEY가 있으면 그걸 쓴다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHANNELS_PATH = resolve(ROOT, 'src/data/channelIds.json');
const OUT_PATH = resolve(ROOT, 'src/data/memberSongs.json');

const API = 'https://holodex.net/api/v2';
const PER_MEMBER = 5;

/*
 * 음악 탭에는 "동영상으로 올라온 곡"만 넣는다.
 * 가창 방송(歌枠)은 곡이 아니라 방송이므로 stream으로 따로 분류한다.
 * 곡이 5개가 안 되는 멤버는 가창 방송으로 채워 피드가 비지 않게 한다.
 */
const SONG_TOPICS = ['Music_Cover', 'Original_Song'];
const SINGING_TOPICS = ['singing', 'karaoke'];

// 인스트루멘털(반주) 버전 제외
const INSTRUMENTAL = /instrumental|off\s*vocal|inst\.?\s*ver|카라오케\s*ver/i;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (chunk) {
      if (rl.stdoutMuted && chunk !== question) rl.output.write('*');
      else rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.stdoutMuted = false;
      rl.output.write('\n');
      rl.close();
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
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOPIC_LABEL = {
  music_cover: '커버',
  original_song: '오리지널 곡',
  singing: '노래 방송',
  karaoke: '노래방',
};

/** Holodex 영상 → 우리 알림 스키마 (Worker의 변환과 동일한 형태) */
function toItem(v, memberId, type) {
  const topic = String(v.topic_id ?? '').toLowerCase();
  return {
    id: `yt:${v.id}`,
    memberId,
    type, // 'music'(곡 영상) 또는 'stream'(가창 방송)
    status: 'past',
    title: v.title ?? '',
    snippet: TOPIC_LABEL[topic] ?? (type === 'music' ? '음악' : '방송'),
    timestamp: v.available_at ?? v.published_at,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
  };
}

const byDateDesc = (a, b) =>
  String(b.available_at ?? b.published_at ?? '').localeCompare(
    String(a.available_at ?? a.published_at ?? '')
  );

async function main() {
  if (!KEY) KEY = await askHidden('Holodex API 키를 붙여넣고 Enter: ');
  if (!KEY) {
    console.error('키가 입력되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  const channels = JSON.parse(readFileSync(CHANNELS_PATH, 'utf-8'));
  const entries = Object.entries(channels);
  console.log(`멤버 ${entries.length}명의 음악 영상을 조회합니다...\n`);

  const songs = [];
  const noMusic = [];

  const fetchTopics = async (channelId, topics) => {
    const byId = new Map();
    const lists = await Promise.all(
      topics.map((topic) =>
        api(
          `/videos?channel_id=${channelId}&topic=${topic}&status=past&limit=${PER_MEMBER}&sort=available_at&order=desc`
        ).catch(() => [])
      )
    );
    for (const list of lists) for (const v of Array.isArray(list) ? list : []) byId.set(v.id, v);
    return [...byId.values()];
  };

  for (const [memberId, channelId] of entries) {
    try {
      // 곡 영상 (커버 + 오리지널, 인스트루멘털 제외)
      const picked = (await fetchTopics(channelId, SONG_TOPICS))
        .filter((v) => !INSTRUMENTAL.test(v.title ?? ''))
        .sort(byDateDesc)
        .slice(0, PER_MEMBER)
        .map((v) => toItem(v, memberId, 'music'));

      // 곡이 모자라면 가창 방송으로 채운다 (음악 탭이 아닌 방송으로 들어감)
      let streams = [];
      if (picked.length < PER_MEMBER) {
        const have = new Set(picked.map((s) => s.id));
        streams = (await fetchTopics(channelId, SINGING_TOPICS))
          .sort(byDateDesc)
          .map((v) => toItem(v, memberId, 'stream'))
          .filter((s) => !have.has(s.id))
          .slice(0, PER_MEMBER - picked.length);
      }

      songs.push(...picked, ...streams);

      const total = picked.length + streams.length;
      const extra = streams.length ? ` + 노래방송 ${streams.length}` : '';
      const mark = total < PER_MEMBER ? `  ← ${total}건뿐` : '';
      console.log(`  ${memberId.padEnd(10)} 곡 ${picked.length}${extra}${mark}`);
      if (total === 0) noMusic.push(memberId);
    } catch (e) {
      console.log(`  ${memberId.padEnd(10)} 실패: ${e.message}`);
      noMusic.push(memberId);
    }

    await sleep(100); // API에 부담 주지 않도록
  }

  // id 중복 제거 (여러 멤버가 참여한 합동 곡 등)
  const seen = new Set();
  const unique = songs.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  writeFileSync(OUT_PATH, JSON.stringify(unique, null, 2) + '\n', 'utf-8');

  console.log(`\n총 ${unique.length}곡 저장 (중복 ${songs.length - unique.length}건 제거)`);
  console.log(`저장: ${OUT_PATH}`);
  if (noMusic.length) {
    console.log(`\n음악을 못 찾은 멤버 ${noMusic.length}명: ${noMusic.join(', ')}`);
  }
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exitCode = 1;
});
