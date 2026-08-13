// 하위 경로(GitHub Pages 등)에 배포돼도 정적 파일을 찾을 수 있도록 base 경로를 붙여줌
export const asset = (path) => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, '')}`;
