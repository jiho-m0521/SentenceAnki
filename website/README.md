# SentenceAnki Web

한국어 해석을 보고 영어 문장의 빈칸을 채우며 장기 암기하는 로컬 우선 웹 앱입니다. 기존 `.db` 파일이나 패키징된 실행 파일은 배포물에 포함하지 않고, 사용자가 직접 가져온 Excel/CSV/SQLite DB 데이터만 브라우저 IndexedDB에 저장합니다.

## 주요 기능

- 세련된 스크롤형 랜딩 페이지와 문의 이메일 링크
- 학습 대시보드 전용 iPhone 스타일 glass 하단 내비게이션
- 빠른 학습 시작을 중심으로 재구성한 대시보드
- 문장 세트 생성, 이름 수정, 삭제, Excel/CSV/DB/JSON 내보내기
- 문장 직접 추가, 실시간 보조 번역, 태그 입력, 표/카드 보기 전환
- Excel/CSV/SQLite DB import 미리보기, 컬럼 검증, 중복/오류 행 표시
- bulk paste로 여러 문장 빠르게 추가
- 난이도 1-5 빈칸 학습, 순서/랜덤/SRS 학습
- 랜덤/핵심 단어/이전 오답/구문 단위 빈칸 생성 모드
- 정답 diff 표시, 오타 허용 등 채점 옵션
- 학습 기록 저장, 문장별 ReviewState, 오늘 복습/밀린 복습/취약 문장 대시보드
- PWA manifest와 service worker 기반 설치형 앱 shell
- 로그인/기기 간 동기화는 Coming Soon 상태로 잠금

## 개발

```powershell
npm.cmd install
npm.cmd run dev
```

Google Drive 동기화 폴더에서 `node_modules` 파일 잠금 문제가 생기면 임시 폴더에서 설치/빌드하는 편이 안정적입니다.

## 검증

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

`xlsx`, `sql.js`, `@supabase/supabase-js` 때문에 번들 크기 경고가 날 수 있습니다. 경고만으로 빌드 실패는 아닙니다.

## 배포

```powershell
npm.cmd run build
```

빌드 결과는 `dist`에 생성됩니다. 기존 `.db`, `.exe`, `internal/` 폴더는 이 프로젝트에 포함하지 않는 정책입니다.

## 문의

앱 관련 문의는 `jiho@mjiho.com`으로 보낼 수 있습니다.
