import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'holonet-theme';

/** 저장된 선택 > OS 설정 순으로 초기 테마를 정한다. */
function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;

    // 테마 전환 동안에는 트랜지션을 끈다.
    // transition-colors가 걸린 요소는 CSS 변수가 바뀌어도 트랜지션이 재시작되지
    // 않아 이전 테마 색에 고착된다(카드 배경이 안 바뀌는 현상).
    root.classList.add('theme-switching');
    root.classList.toggle('dark', theme === 'dark');
    void root.offsetHeight; // 스타일 즉시 반영

    const timer = setTimeout(() => root.classList.remove('theme-switching'), 60);
    window.localStorage.setItem(STORAGE_KEY, theme);
    return () => clearTimeout(timer);
  }, [theme]);

  // 사용자가 직접 고른 적이 없다면 OS 설정 변경을 따라간다
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
      setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return { theme, toggle };
}
