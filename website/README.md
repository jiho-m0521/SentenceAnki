# SentenceAnki Web

한국어 해석을 보고 영어 문장의 빈칸을 채우며 암기하는 웹 앱입니다. 기존 실행 파일과 DB 파일을 배포물에 포함하지 않고, 사용자가 직접 업로드한 엑셀/CSV/SQLite DB 데이터를 브라우저 IndexedDB에 저장합니다.

## 주요 기능

- 문장 세트 생성, 이름 변경, 삭제
- 문장 직접 추가, 수정, 선택 삭제, 전체 삭제
- 엑셀/CSV 가져오기: `ID`, `English`, `Korean` 컬럼 지원
- 기존 SQLite DB 가져오기: `sentences(id, eng, kor)` 테이블 지원
- JSON 백업 내보내기/가져오기
- 난이도 1-5 빈칸 학습
- 순서대로/랜덤 학습, 선택 문장만 학습
- 오답 표시, 정답 처리, 오답만 재학습

## 개발

```bash
npm install
npm run dev
```

PowerShell 실행 정책 때문에 `npm`이 막히는 환경에서는 `npm.cmd`를 사용하세요.

```powershell
npm.cmd install
npm.cmd run dev
```

## 배포

정적 사이트로 배포할 수 있습니다.

```powershell
npm.cmd run build
```

빌드 결과는 `dist`에 생성됩니다. 기존 `.db` 파일은 `website` 안에 넣지 않아도 되며, 넣지 않는 것을 전제로 설계했습니다.

## 데이터 저장

학습 데이터는 사용자의 브라우저 IndexedDB에 저장됩니다. 다른 기기와 자동 동기화되지 않으므로 중요한 데이터는 JSON 백업으로 내보내세요.
