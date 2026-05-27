import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  GraduationCap,
  Import,
  Keyboard,
  Languages,
  Layers3,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  addImportedSentences,
  clearDeckSentences,
  createDeck,
  deleteDeck,
  deleteSentences,
  exportBackup,
  importBackup,
  listDecks,
  listSentences,
  setSentenceSelected,
  touchDeck,
  updateDeck,
  upsertSentence,
} from "./storage";
import { formatDateTime, downloadJson } from "./utils";
import { getCorrectAnswer, gradePrompt, makePrompt, orderSentences } from "./study";
import { parseBackup, parseSpreadsheet, parseSqliteDb } from "./importers";
import { exportDeckFile, type ExportFormat } from "./exporters";
import { translateEnglishToKorean } from "./translator";
import type { Deck, Sentence, StudyMode, StudyPrompt, StudyResult } from "./types";

type View = "dashboard" | "manage" | "study" | "result";
type Notice = { type: "success" | "error"; message: string } | null;

function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [studyMode, setStudyMode] = useState<StudyMode>("ordered");
  const [studySource, setStudySource] = useState<Sentence[]>([]);
  const [prompts, setPrompts] = useState<StudyPrompt[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentResult, setCurrentResult] = useState<StudyResult | null>(null);
  const [results, setResults] = useState<StudyResult[]>([]);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renamingDeckName, setRenamingDeckName] = useState("");
  const [exportMenuDeckId, setExportMenuDeckId] = useState<string | null>(null);
  const [sentenceForm, setSentenceForm] = useState({ id: "", english: "", korean: "", translateMode: "manual" });
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const [autoKoreanDirty, setAutoKoreanDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const blankRefs = useRef<Array<HTMLInputElement | null>>([]);
  const latestTranslationRequest = useRef(0);

  const activeDeck = decks.find((deck) => deck.id === activeDeckId) ?? null;
  const selectedCount = sentences.filter((sentence) => sentence.selected).length;
  const filteredSentences = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return sentences;
    return sentences.filter(
      (sentence) =>
        sentence.english.toLocaleLowerCase().includes(keyword) ||
        sentence.korean.toLocaleLowerCase().includes(keyword),
    );
  }, [query, sentences]);

  const currentPrompt = prompts[currentIndex] ?? null;
  const correctCount = results.filter((result) => result.isCorrect).length;
  const wrongResults = results.filter((result) => !result.isCorrect);

  useEffect(() => {
    void refreshDecks();
  }, []);

  useEffect(() => {
    resetEditorState();
    if (!activeDeckId) {
      setSentences([]);
      return;
    }
    void refreshSentences(activeDeckId);
  }, [activeDeckId]);

  useEffect(() => {
    if (view === "study" && currentPrompt) {
      setAnswers(currentPrompt.blanks.map(() => ""));
      setCurrentResult(null);
      window.setTimeout(() => blankRefs.current[0]?.focus(), 50);
    }
  }, [view, currentIndex, currentPrompt]);

  useEffect(() => {
    if (sentenceForm.translateMode !== "auto") return;

    const source = sentenceForm.english.trim();
    if (!source) {
      setIsTranslating(false);
      setTranslationStatus("");
      return;
    }

    if (autoKoreanDirty) {
      setTranslationStatus("해석을 직접 수정 중이라 자동 덮어쓰기를 멈췄습니다.");
      return;
    }

    const requestId = latestTranslationRequest.current + 1;
    latestTranslationRequest.current = requestId;
    setTranslationStatus("입력을 멈추면 자동으로 번역합니다.");

    const timerId = window.setTimeout(() => {
      setIsTranslating(true);
      setTranslationStatus("자동 번역 중입니다.");
      translateEnglishToKorean(source)
        .then((korean) => {
          if (latestTranslationRequest.current !== requestId) return;
          setSentenceForm((form) => {
            if (form.translateMode !== "auto" || form.english.trim() !== source || autoKoreanDirty) return form;
            return { ...form, korean };
          });
          setTranslationStatus("자동 번역 완료. 저장 전에 수정할 수 있습니다.");
        })
        .catch((error: unknown) => {
          if (latestTranslationRequest.current !== requestId) return;
          setTranslationStatus(error instanceof Error ? error.message : "자동 번역에 실패했습니다.");
        })
        .finally(() => {
          if (latestTranslationRequest.current === requestId) setIsTranslating(false);
        });
    }, 800);

    return () => window.clearTimeout(timerId);
  }, [sentenceForm.english, sentenceForm.translateMode, autoKoreanDirty]);

  async function refreshDecks() {
    const items = await listDecks();
    setDecks(items);
    if (!activeDeckId && items[0]) setActiveDeckId(items[0].id);
  }

  async function refreshSentences(deckId = activeDeckId) {
    if (!deckId) return;
    setSentences(await listSentences(deckId));
  }

  function showNotice(type: "success" | "error", message: string) {
    setNotice({ type, message });
    window.setTimeout(() => setNotice(null), 4200);
  }

  function resetEditorState() {
    setSentenceForm({ id: "", english: "", korean: "", translateMode: "manual" });
    setRenamingDeckId(null);
    setRenamingDeckName("");
    setExportMenuDeckId(null);
    setIsTranslating(false);
    setTranslationStatus("");
    setAutoKoreanDirty(false);
  }

  async function runTask(task: () => Promise<void>) {
    try {
      setBusy(true);
      await task();
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDeck() {
    await runTask(async () => {
      const deck = await createDeck("새 문장 세트");
      resetEditorState();
      setActiveDeckId(deck.id);
      setEditingDeckName(deck.name);
      await refreshDecks();
      setView("manage");
      showNotice("success", "새 문장 세트를 만들었습니다.");
    });
  }

  async function handleSaveDeckName() {
    if (!activeDeck) return;
    await runTask(async () => {
      await updateDeck({ ...activeDeck, name: editingDeckName || activeDeck.name });
      await refreshDecks();
      showNotice("success", "문장 세트 이름을 변경했습니다.");
    });
  }

  async function handleDeleteDeck() {
    if (!activeDeck) return;
    await handleDeleteDeckById(activeDeck);
  }

  async function handleDeleteDeckById(deck: Deck) {
    if (!confirm(`"${deck.name}" 세트를 삭제할까요? 저장된 문장도 함께 삭제됩니다.`)) return;
    await runTask(async () => {
      await deleteDeck(deck.id);
      resetEditorState();
      const nextDecks = await listDecks();
      setDecks(nextDecks);
      setActiveDeckId((currentId) => (currentId === deck.id ? (nextDecks[0]?.id ?? null) : currentId));
      setView("dashboard");
      showNotice("success", "문장 세트를 삭제했습니다.");
    });
  }

  function startRenameDeck(deck: Deck) {
    setRenamingDeckId(deck.id);
    setRenamingDeckName(deck.name);
  }

  async function saveRenamedDeck(deck: Deck) {
    const nextName = renamingDeckName.trim();
    if (!nextName) {
      setRenamingDeckId(null);
      setRenamingDeckName("");
      return;
    }

    if (nextName === deck.name) {
      setRenamingDeckId(null);
      setRenamingDeckName("");
      return;
    }

    await runTask(async () => {
      await updateDeck({ ...deck, name: nextName });
      if (activeDeckId === deck.id) setEditingDeckName(nextName);
      await refreshDecks();
      setRenamingDeckId(null);
      setRenamingDeckName("");
      showNotice("success", "문장 세트 이름을 변경했습니다.");
    });
  }

  async function handleExportDeck(deck: Deck, format: ExportFormat) {
    await runTask(async () => {
      const deckSentences = await listSentences(deck.id);
      await exportDeckFile(deck, deckSentences, format);
      setExportMenuDeckId(null);
      showNotice("success", "문장 세트를 파일로 내보냈습니다.");
    });
  }

  async function handleSaveSentence(event: FormEvent) {
    event.preventDefault();
    if (!activeDeckId) return;
    if (!sentenceForm.english.trim() || !sentenceForm.korean.trim()) {
      showNotice("error", "영어 문장과 한국어 해석을 모두 입력하세요.");
      return;
    }

    await runTask(async () => {
      const existing = sentences.find((sentence) => sentence.id === sentenceForm.id);
      await upsertSentence({
        id: existing?.id,
        createdAt: existing?.createdAt,
        deckId: activeDeckId,
        english: sentenceForm.english,
        korean: sentenceForm.korean,
        selected: existing?.selected ?? false,
      });
      setSentenceForm({ id: "", english: "", korean: "", translateMode: sentenceForm.translateMode });
      await refreshSentences();
      await refreshDecks();
      showNotice("success", existing ? "문장을 수정했습니다." : "문장을 추가했습니다.");
    });
  }

  async function handleDeleteSelected() {
    const ids = sentences.filter((sentence) => sentence.selected).map((sentence) => sentence.id);
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}개 문장을 삭제할까요?`)) return;
    await runTask(async () => {
      await deleteSentences(ids);
      await refreshSentences();
      showNotice("success", "선택한 문장을 삭제했습니다.");
    });
  }

  async function handleClearDeck() {
    if (!activeDeckId || sentences.length === 0 || !confirm("현재 세트의 모든 문장을 삭제할까요?")) return;
    await runTask(async () => {
      await clearDeckSentences(activeDeckId);
      await refreshSentences();
      showNotice("success", "모든 문장을 삭제했습니다.");
    });
  }

  async function handleFileImport(file: File | null) {
    if (!file) return;
    await runTask(async () => {
      const lower = file.name.toLocaleLowerCase();
      const parsed = lower.endsWith(".db") ? await parseSqliteDb(file) : await parseSpreadsheet(file);
      if (parsed.rows.length === 0) throw new Error("가져올 문장이 없습니다.");
      const deck = await createDeck(parsed.deckName);
      await addImportedSentences(deck.id, parsed.rows);
      setActiveDeckId(deck.id);
      await refreshDecks();
      await refreshSentences(deck.id);
      setView("manage");
      showNotice("success", `${parsed.rows.length}개 문장을 가져왔습니다.`);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleBackupImport(file: File | null) {
    if (!file) return;
    await runTask(async () => {
      await importBackup(await parseBackup(file));
      await refreshDecks();
      showNotice("success", "백업을 가져왔습니다.");
    });
    if (backupInputRef.current) backupInputRef.current.value = "";
  }

  async function handleBackupExport() {
    await runTask(async () => {
      const backup = await exportBackup();
      downloadJson(`sentence-anki-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      showNotice("success", "백업 파일을 내보냈습니다.");
    });
  }

  function startStudy(source: "all" | "selected" | "wrong" = "all") {
    const base =
      source === "wrong"
        ? wrongResults
            .map((result) => studySource.find((sentence) => sentence.id === result.sentenceId))
            .filter((sentence): sentence is Sentence => Boolean(sentence))
        : source === "selected"
          ? sentences.filter((sentence) => sentence.selected)
          : sentences;

    if (base.length === 0) {
      showNotice("error", source === "selected" ? "선택된 문장이 없습니다." : "학습할 문장이 없습니다.");
      return;
    }

    const ordered = orderSentences(base, studyMode);
    setStudySource(ordered);
    setPrompts(ordered.map((sentence) => makePrompt(sentence, difficulty)));
    setCurrentIndex(0);
    setResults([]);
    setCurrentResult(null);
    setView("study");
  }

  async function submitAnswer(event?: FormEvent) {
    event?.preventDefault();
    if (!currentPrompt) return;
    const result = gradePrompt(currentPrompt, answers);
    setCurrentResult(result);
    if (result.isCorrect) {
      await moveNext(result);
    }
  }

  async function moveNext(result = currentResult) {
    if (!result || !currentPrompt) return;
    const nextResults = [...results.filter((item) => item.sentenceId !== result.sentenceId), result];
    setResults(nextResults);

    if (currentIndex + 1 >= prompts.length) {
      if (activeDeckId) await touchDeck(activeDeckId);
      await refreshDecks();
      setView("result");
      return;
    }

    setCurrentIndex((index) => index + 1);
  }

  async function forceCorrect() {
    if (!currentResult) return;
    await moveNext({ ...currentResult, isCorrect: true, forcedCorrect: true });
  }

  function renderDashboard() {
    return (
      <main className="shell">
        <section className="topbar">
          <div>
            <p className="eyebrow">SentenceAnki Web</p>
            <h1>문장 빈칸 학습을 바로 시작하세요</h1>
          </div>
          <div className="topbarActions">
            <button className="button ghost" onClick={() => backupInputRef.current?.click()}>
              <FileJson size={18} /> 백업 가져오기
            </button>
            <button className="button ghost" onClick={handleBackupExport} disabled={decks.length === 0}>
              <Download size={18} /> 백업 내보내기
            </button>
            <button className="button primary" onClick={handleCreateDeck}>
              <Plus size={18} /> 새 세트
            </button>
          </div>
        </section>

        <section className="dashboardGrid">
          <div className="panel importPanel">
            <div className="panelHeader">
              <div>
                <h2>자료 가져오기</h2>
                <p>엑셀, CSV, 기존 SQLite DB 파일을 업로드하면 브라우저에 저장됩니다.</p>
              </div>
              <Upload size={22} />
            </div>
            <button className="uploadBox" onClick={() => fileInputRef.current?.click()}>
              <Import size={28} />
              <span>파일 선택</span>
              <small>지원 형식: .xlsx, .xls, .csv, .db</small>
            </button>
          </div>

          <div className="panel statsPanel">
            <div className="stat">
              <Layers3 size={20} />
              <span>{decks.length}</span>
              <small>문장 세트</small>
            </div>
            <div className="stat">
              <GraduationCap size={20} />
              <span>{sentences.length}</span>
              <small>현재 세트 문장</small>
            </div>
            <div className="stat wide">
              <Keyboard size={20} />
              <span>{activeDeck ? formatDateTime(activeDeck.lastStudiedAt) : "아직 없음"}</span>
              <small>최근 학습</small>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>문장 세트</h2>
              <p>세트를 선택하면 문장 관리와 학습 설정을 이어서 조정할 수 있습니다.</p>
            </div>
          </div>
          {decks.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="deckGrid">
              {decks.map((deck) => (
                <article
                  className={`deckCard ${deck.id === activeDeckId ? "active" : ""}`}
                  key={deck.id}
                >
                  {renamingDeckId === deck.id ? (
                    <form
                      className="deckRenameForm"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveRenamedDeck(deck);
                      }}
                    >
                      <input
                        value={renamingDeckName}
                        autoFocus
                        onChange={(event) => setRenamingDeckName(event.target.value)}
                        onBlur={() => void saveRenamedDeck(deck)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setRenamingDeckId(null);
                            setRenamingDeckName("");
                          }
                        }}
                      />
                      <small>Enter로 저장, Esc로 취소</small>
                    </form>
                  ) : (
                    <button
                      className="deckOpenButton"
                      onClick={() => {
                        setActiveDeckId(deck.id);
                        setEditingDeckName(deck.name);
                        setView("manage");
                      }}
                    >
                      <span>{deck.name}</span>
                      <small>수정 {formatDateTime(deck.updatedAt)}</small>
                    </button>
                  )}
                  <div className="deckIconActions" aria-label={`${deck.name} 작업`}>
                    <button className="iconButton small" aria-label={`${deck.name} 이름 수정`} onClick={() => startRenameDeck(deck)}>
                      <Pencil size={16} />
                    </button>
                    <button
                      className="iconButton small"
                      aria-label={`${deck.name} 파일로 내보내기`}
                      onClick={() => setExportMenuDeckId((currentId) => (currentId === deck.id ? null : deck.id))}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="iconButton small dangerIcon"
                      aria-label={`${deck.name} 삭제`}
                      onClick={() => handleDeleteDeckById(deck)}
                    >
                      <Trash2 size={16} />
                    </button>
                    {exportMenuDeckId === deck.id && (
                      <div className="exportMenu">
                        <button onClick={() => handleExportDeck(deck, "xlsx")}>Excel</button>
                        <button onClick={() => handleExportDeck(deck, "csv")}>CSV</button>
                        <button onClick={() => handleExportDeck(deck, "db")}>DB</button>
                        <button onClick={() => handleExportDeck(deck, "json")}>JSON</button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  }

  function renderManage() {
    return (
      <main className="shell">
        <section className="topbar compact">
          <button className="iconButton" aria-label="대시보드로 이동" onClick={() => setView("dashboard")}>
            <ArrowLeft size={20} />
          </button>
          <div className="deckTitleBlock">
            <input
              className="deckTitleInput"
              value={editingDeckName || activeDeck?.name || ""}
              onChange={(event) => setEditingDeckName(event.target.value)}
              onBlur={handleSaveDeckName}
            />
            <p>{sentences.length}개 문장 · 선택 {selectedCount}개</p>
          </div>
          <div className="topbarActions">
            <button className="button ghost dangerText" onClick={handleDeleteDeck}>
              <Trash2 size={18} /> 세트 삭제
            </button>
            <button className="button primary" onClick={() => startStudy("all")} disabled={sentences.length === 0}>
              <Play size={18} /> 학습 시작
            </button>
          </div>
        </section>

        <section className="manageGrid">
          <aside className="panel settingsPanel">
            <h2>학습 설정</h2>
            <label className="field">
              <span>난이도 {difficulty}</span>
              <input
                type="range"
                min={1}
                max={5}
                value={difficulty}
                onChange={(event) => setDifficulty(Number(event.target.value))}
              />
            </label>
            <div className="segmented">
              <button className={studyMode === "ordered" ? "active" : ""} onClick={() => setStudyMode("ordered")}>
                순서대로
              </button>
              <button className={studyMode === "random" ? "active" : ""} onClick={() => setStudyMode("random")}>
                랜덤
              </button>
            </div>
            <button className="button full" onClick={() => startStudy("selected")} disabled={selectedCount === 0}>
              <CheckCircle2 size={18} /> 선택 문장 학습
            </button>
            <button className="button full ghost" onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet size={18} /> 파일 더 가져오기
            </button>
          </aside>

          <section className="panel editorPanel">
            <div className="panelHeader">
              <div>
                <h2>{sentenceForm.id ? "문장 수정" : "문장 추가"}</h2>
                <p>수동 입력하거나 자동 번역으로 한국어 해석을 먼저 채울 수 있습니다.</p>
              </div>
            </div>
            <form className="sentenceForm" onSubmit={handleSaveSentence}>
              <div className="segmented compactSegments">
                <button
                  type="button"
                  className={sentenceForm.translateMode === "manual" ? "active" : ""}
                  onClick={() => {
                    setAutoKoreanDirty(false);
                    setTranslationStatus("");
                    setSentenceForm((form) => ({ ...form, translateMode: "manual" }));
                  }}
                >
                  수동 번역
                </button>
                <button
                  type="button"
                  className={sentenceForm.translateMode === "auto" ? "active" : ""}
                  onClick={() => {
                    setAutoKoreanDirty(false);
                    setSentenceForm((form) => ({ ...form, translateMode: "auto" }));
                  }}
                >
                  자동 번역
                </button>
              </div>
              <textarea
                placeholder="English sentence"
                value={sentenceForm.english}
                onChange={(event) => {
                  if (sentenceForm.translateMode === "auto") {
                    setAutoKoreanDirty(false);
                  }
                  setSentenceForm((form) => ({ ...form, english: event.target.value }));
                }}
              />
              {sentenceForm.translateMode === "auto" && (
                <div className="translateControls">
                  {isTranslating ? <Loader2 className="spin" size={18} /> : <Languages size={18} />}
                  <span>{translationStatus || "영어 문장을 입력하면 실시간으로 번역합니다."}</span>
                </div>
              )}
              <textarea
                placeholder="한국어 해석"
                value={sentenceForm.korean}
                onChange={(event) => {
                  if (sentenceForm.translateMode === "auto") {
                    setAutoKoreanDirty(true);
                  }
                  setSentenceForm((form) => ({ ...form, korean: event.target.value }));
                }}
              />
              <div className="formActions">
                {sentenceForm.id && (
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setAutoKoreanDirty(false);
                      setTranslationStatus("");
                      setSentenceForm({ id: "", english: "", korean: "", translateMode: "manual" });
                    }}
                  >
                    <X size={18} /> 취소
                  </button>
                )}
                <button className="button primary" type="submit">
                  <Plus size={18} /> 저장
                </button>
              </div>
            </form>
          </section>
        </section>

        <section className="panel tablePanel">
          <div className="tableToolbar">
            <label className="searchBox">
              <Search size={18} />
              <input placeholder="문장 또는 해석 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="toolbarActions">
              <button className="button ghost" onClick={handleDeleteSelected} disabled={selectedCount === 0}>
                <Trash2 size={18} /> 선택 삭제
              </button>
              <button className="button ghost dangerText" onClick={handleClearDeck} disabled={sentences.length === 0}>
                <Trash2 size={18} /> 전체 삭제
              </button>
            </div>
          </div>

          <div className="sentenceTableWrap">
            <table className="sentenceTable">
              <thead>
                <tr>
                  <th>선택</th>
                  <th>English</th>
                  <th>Korean</th>
                  <th>편집</th>
                </tr>
              </thead>
              <tbody>
                {filteredSentences.map((sentence) => (
                  <tr key={sentence.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={sentence.selected}
                        onChange={async (event) => {
                          await setSentenceSelected(sentence.id, event.target.checked);
                          await refreshSentences();
                        }}
                      />
                    </td>
                    <td>{sentence.english}</td>
                    <td>{sentence.korean}</td>
                    <td>
                      <button
                        className="iconButton small"
                        aria-label="문장 수정"
                        onClick={() =>
                          setSentenceForm({
                            id: sentence.id,
                            english: sentence.english,
                            korean: sentence.korean,
                            translateMode: "manual",
                          })
                        }
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredSentences.length === 0 && <div className="tableEmpty">표시할 문장이 없습니다.</div>}
          </div>
        </section>
      </main>
    );
  }

  function renderStudy() {
    if (!currentPrompt) return null;
    const progress = Math.round(((currentIndex + 1) / prompts.length) * 100);

    return (
      <main className="studyShell">
        <section className="studyHeader">
          <button className="iconButton" aria-label="문장 관리로 돌아가기" onClick={() => setView("manage")}>
            <ArrowLeft size={20} />
          </button>
          <div className="progressBlock">
            <span>
              {currentIndex + 1} / {prompts.length}
            </span>
            <div className="progressTrack">
              <div style={{ width: `${progress}%` }} />
            </div>
          </div>
          <span className="difficultyBadge">난이도 {difficulty}</span>
        </section>

        <section className="studyCard">
          <p className="translation">{currentPrompt.sentence.korean}</p>
          <form className="promptLine" onSubmit={submitAnswer}>
            {currentPrompt.parts.map((part, index) =>
              part.type === "text" ? (
                <span key={`${part.value}-${index}`}>{part.value}</span>
              ) : (
                <input
                  key={part.index}
                  ref={(node) => {
                    blankRefs.current[part.index] = node;
                  }}
                  aria-label={`${part.index + 1}번 빈칸`}
                  value={answers[part.index] ?? ""}
                  onChange={(event) =>
                    setAnswers((values) => values.map((value, answerIndex) => (answerIndex === part.index ? event.target.value : value)))
                  }
                />
              ),
            )}
            <button className="button submitButton" type="submit">
              <Check size={18} /> 정답 제출
            </button>
          </form>

          {currentResult && !currentResult.isCorrect && (
            <div className="answerPanel">
              <strong>정답: {getCorrectAnswer(currentPrompt)}</strong>
              <span>입력: {currentResult.answer || "빈 답안"}</span>
              <div>
                <button className="button primary" onClick={() => moveNext()}>
                  다음 문장
                </button>
                <button className="button ghost" onClick={forceCorrect}>
                  정답 처리하기
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  function renderResult() {
    const total = results.length;
    const score = total === 0 ? 0 : Math.round((correctCount / total) * 100);
    const wrongSentenceMap = new Map(studySource.map((sentence) => [sentence.id, sentence]));

    return (
      <main className="shell resultShell">
        <section className="resultHero">
          <CheckCircle2 size={40} />
          <p>학습 완료</p>
          <h1>{score}%</h1>
          <span>
            정답 {correctCount}개 · 오답 {total - correctCount}개
          </span>
          <div className="resultActions">
            <button className="button primary" onClick={() => startStudy("wrong")} disabled={wrongResults.length === 0}>
              <RotateCcw size={18} /> 오답만 다시 학습
            </button>
            <button className="button ghost" onClick={() => startStudy("all")}>
              <Play size={18} /> 같은 설정으로 재시작
            </button>
            <button className="button ghost" onClick={() => setView("manage")}>
              문장 관리로
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>오답 목록</h2>
              <p>오답이 없는 경우 바로 다음 세트를 학습하면 됩니다.</p>
            </div>
          </div>
          <div className="wrongList">
            {wrongResults.length === 0 ? (
              <div className="tableEmpty">오답이 없습니다.</div>
            ) : (
              wrongResults.map((result) => {
                const sentence = wrongSentenceMap.get(result.sentenceId);
                return (
                  <article key={result.sentenceId} className="wrongItem">
                    <strong>{sentence?.korean}</strong>
                    <span>{sentence?.english}</span>
                    <small>입력: {result.answer || "빈 답안"} · 정답: {result.correctAnswer}</small>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      {busy && (
        <div className="busyOverlay">
          <Loader2 className="spin" size={24} /> 처리 중
        </div>
      )}
      {notice && <div className={`toast ${notice.type}`}>{notice.message}</div>}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.db"
        hidden
        onChange={(event) => void handleFileImport(event.target.files?.[0] ?? null)}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept=".json"
        hidden
        onChange={(event) => void handleBackupImport(event.target.files?.[0] ?? null)}
      />
      {view === "dashboard" && renderDashboard()}
      {view === "manage" && renderManage()}
      {view === "study" && renderStudy()}
      {view === "result" && renderResult()}
    </>
  );
}

function EmptyState() {
  return (
    <div className="emptyState">
      <Settings2 size={28} />
      <strong>아직 문장 세트가 없습니다.</strong>
      <span>엑셀/CSV/DB를 가져오거나 새 세트를 만들어 문장을 추가하세요.</span>
    </div>
  );
}

export default App;
