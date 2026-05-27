# SentenceAnki Web

한국어 해석을 보고 영어 문장의 빈칸을 채우며 장기 암기하는 로컬 우선 웹 앱입니다. 기존 `.db` 파일이나 패키징된 실행 파일은 배포물에 포함하지 않고, 사용자가 직접 가져온 Excel/CSV/SQLite DB 데이터만 브라우저 IndexedDB에 저장합니다.

## 주요 기능

- 문장 세트 생성, 이름 수정, 삭제, Excel/CSV/DB/JSON 내보내기
- 문장 직접 추가, 실시간 보조 번역, 태그 입력, 표/카드 보기 전환
- Excel/CSV/SQLite DB import 미리보기, 컬럼 검증, 중복/오류 행 표시
- bulk paste로 여러 문장 빠르게 추가
- 난이도 1-5 빈칸 학습, 순서/랜덤/SRS 학습
- 랜덤/핵심 단어/이전 오답/구문 단위 빈칸 생성 모드
- 정답 diff 표시, 오타 허용 등 채점 옵션
- 학습 기록 저장, 문장별 ReviewState, 오늘 복습/밀린 복습/취약 문장 대시보드
- PWA manifest와 service worker 기반 설치형 앱 shell
- Supabase 환경변수가 있을 때 로그인 후 로컬 데이터를 클라우드 스냅샷으로 업로드

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

## Supabase 동기화 설정

환경변수가 없으면 앱은 자동으로 로컬 IndexedDB 모드로 동작합니다. 클라우드 동기화를 켜려면 배포 환경에 아래 값을 추가하세요.

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

현재 구현은 로컬 데이터를 사용자별 JSON 스냅샷으로 업로드하는 MVP 동기화입니다.

```sql
create table if not exists sentence_anki_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table sentence_anki_snapshots enable row level security;
create policy "own snapshot" on sentence_anki_snapshots
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 배포

```powershell
npm.cmd run build
```

빌드 결과는 `dist`에 생성됩니다. 기존 `.db`, `.exe`, `internal/` 폴더는 이 프로젝트에 포함하지 않는 정책입니다.
