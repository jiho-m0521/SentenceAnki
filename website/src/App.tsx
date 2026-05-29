/* eslint-disable react-hooks/exhaustive-deps */
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  Cloud,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  Grid2X2,
  Home,
  Import,
  Keyboard,
  Languages,
  List,
  Loader2,
  Mail,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Tags,
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
  getSettings,
  importBackup,
  listAllSentences,
  listDecks,
  listReviewStates,
  listSentences,
  listStudyRecords,
  saveStudyRecords,
  setSentenceSelected,
  touchDeck,
  updateDeck,
  updateSettings,
  upsertSentence,
} from "./storage";
import { downloadJson, formatDateTime, formatDuration, nowIso } from "./utils";
import { extractWeakWords, getCorrectAnswer, gradePrompt, makePrompt, orderSentences } from "./study";
import { parseBackup, previewImportFile } from "./importers";
import { exportDeckFile, type ExportFormat } from "./exporters";
import { translateEnglishToKorean } from "./translator";
import { formatSupabaseError } from "./sync";
import type {
  AppSettings,
  BlankMode,
  Deck,
  ImportPreview,
  ReviewState,
  Sentence,
  StudyMode,
  StudyPrompt,
  StudyRecord,
  StudyResult,
} from "./types";
import { createId } from "./utils";

type View = "landing" | "dashboard" | "manage" | "study" | "result" | "settings";
type Notice = { type: "success" | "error"; message: string } | null;
type SentenceView = "table" | "cards";

const blankModeLabels: Record<BlankMode, string> = {
  random: "랜덤",
  important: "핵심 단어",
  weak: "이전 오답",
  phrase: "구문 단위",
};

function App() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [allSentences, setAllSentences] = useState<Sentence[]>([]);
  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [view, setView] = useState<View>("landing");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState(3);
  const [studyMode, setStudyMode] = useState<StudyMode>("srs");
  const [sentenceView, setSentenceView] = useState<SentenceView>("table");
  const [studySource, setStudySource] = useState<Sentence[]>([]);
  const [prompts, setPrompts] = useState<StudyPrompt[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentResult, setCurrentResult] = useState<StudyResult | null>(null);
  const [results, setResults] = useState<StudyResult[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [promptStartedAt, setPromptStartedAt] = useState(Date.now());
  const [shownHints, setShownHints] = useState<number[]>([]);
  const [editingDeckName, setEditingDeckName] = useState("");
  const [renamingDeckId, setRenamingDeckId] = useState<string | null>(null);
  const [renamingDeckName, setRenamingDeckName] = useState("");
  const [exportMenuDeckId, setExportMenuDeckId] = useState<string | null>(null);
  const [exportHistory, setExportHistory] = useState(false);
  const [sentenceForm, setSentenceForm] = useState({ id: "", english: "", korean: "", tags: "", translateMode: "manual" });
  const [bulkText, setBulkText] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const [autoKoreanDirty, setAutoKoreanDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const blankRefs = useRef<Array<HTMLInputElement | null>>([]);
  const latestTranslationRequest = useRef(0);

  const activeDeck = decks.find((deck) => deck.id === activeDeckId) ?? null;
  const selectedCount = sentences.filter((sentence) => sentence.selected).length;
  const activeReviews = reviews.filter((review) => review.deckId === activeDeckId);
  const currentPrompt = prompts[currentIndex] ?? null;
  const correctCount = results.filter((result) => result.isCorrect).length;
  const wrongResults = results.filter((result) => !result.isCorrect);

  const filteredSentences = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return sentences;
    return sentences.filter(
      (sentence) =>
        sentence.english.toLocaleLowerCase().includes(keyword) ||
        sentence.korean.toLocaleLowerCase().includes(keyword) ||
        sentence.tags.join(" ").toLocaleLowerCase().includes(keyword),
    );
  }, [query, sentences]);

  const metrics = useMemo(() => {
    const today = new Date();
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    const now = nowIso();
    return {
      dueToday: reviews.filter((review) => review.nextReviewAt <= todayEnd).length,
      overdue: reviews.filter((review) => review.nextReviewAt < now).length,
      weak: reviews.filter((review) => review.lastWrong || review.correctAttempts / Math.max(1, review.attempts) < 0.7).length,
      recentRecords: records.slice(0, 5),
    };
  }, [records, reviews]);

  useEffect(() => {
    void refreshAll();
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
      setShownHints([]);
      setPromptStartedAt(Date.now());
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
          setSentenceForm((form) => (form.translateMode === "auto" && form.english.trim() === source && !autoKoreanDirty ? { ...form, korean } : form));
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

  async function refreshAll() {
    const [deckItems, allSentenceItems, recordItems, reviewItems, appSettings] = await Promise.all([
      listDecks(),
      listAllSentences(),
      listStudyRecords(),
      listReviewStates(),
      getSettings(),
    ]);
    setDecks(deckItems);
    setAllSentences(allSentenceItems);
    setRecords(recordItems);
    setReviews(reviewItems);
    setSettings(appSettings);
    if (!activeDeckId && deckItems[0]) setActiveDeckId(deckItems[0].id);
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
    setSentenceForm({ id: "", english: "", korean: "", tags: "", translateMode: "manual" });
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
      showNotice("error", formatSupabaseError(error));
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
      await refreshAll();
      setView("manage");
      showNotice("success", "새 문장 세트를 만들었습니다.");
    });
  }

  async function handleSaveDeckName() {
    if (!activeDeck) return;
    const name = editingDeckName.trim();
    if (!name || name === activeDeck.name) return;
    await runTask(async () => {
      await updateDeck({ ...activeDeck, name });
      await refreshAll();
      showNotice("success", "문장 세트 이름을 변경했습니다.");
    });
  }

  async function handleDeleteDeckById(deck: Deck) {
    if (!confirm(`"${deck.name}" 세트를 삭제할까요? 문장도 함께 삭제됩니다.`)) return;
    await runTask(async () => {
      await deleteDeck(deck.id);
      resetEditorState();
      const nextDecks = await listDecks();
      setDecks(nextDecks);
      setActiveDeckId((currentId) => (currentId === deck.id ? (nextDecks[0]?.id ?? null) : currentId));
      setView("dashboard");
      await refreshAll();
      showNotice("success", "문장 세트를 삭제했습니다.");
    });
  }

  async function saveRenamedDeck(deck: Deck) {
    const nextName = renamingDeckName.trim();
    if (!nextName || nextName === deck.name) {
      setRenamingDeckId(null);
      setRenamingDeckName("");
      return;
    }
    await runTask(async () => {
      await updateDeck({ ...deck, name: nextName });
      if (activeDeckId === deck.id) setEditingDeckName(nextName);
      await refreshAll();
      setRenamingDeckId(null);
      setRenamingDeckName("");
      showNotice("success", "문장 세트 이름을 변경했습니다.");
    });
  }

  async function handleExportDeck(deck: Deck, format: ExportFormat) {
    await runTask(async () => {
      const deckSentences = await listSentences(deck.id);
      const deckRecords = records.filter((record) => record.deckId === deck.id);
      const deckReviews = reviews.filter((review) => review.deckId === deck.id);
      await exportDeckFile(deck, deckSentences, format, { includeHistory: exportHistory, studyRecords: deckRecords, reviewStates: deckReviews });
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
        orderIndex: existing?.orderIndex,
        deckId: activeDeckId,
        english: sentenceForm.english,
        korean: sentenceForm.korean,
        selected: existing?.selected ?? false,
        tags: sentenceForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setSentenceForm({ id: "", english: "", korean: "", tags: "", translateMode: sentenceForm.translateMode });
      await refreshAll();
      await refreshSentences();
      showNotice("success", existing ? "문장을 수정했습니다." : "문장을 추가했습니다.");
    });
  }

  async function handleBulkAdd() {
    if (!activeDeckId || !bulkText.trim()) return;
    const rows = bulkText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [english, korean] = line.includes("\t") ? line.split("\t") : line.split(/\s[-–]\s/);
        return { english: (english ?? "").trim(), korean: (korean ?? "").trim() };
      })
      .filter((row) => row.english && row.korean);
    if (rows.length === 0) {
      showNotice("error", "각 줄을 English<Tab>Korean 또는 English - Korean 형식으로 입력하세요.");
      return;
    }
    await runTask(async () => {
      await addImportedSentences(activeDeckId, rows);
      setBulkText("");
      await refreshAll();
      await refreshSentences();
      showNotice("success", `${rows.length}개 문장을 추가했습니다.`);
    });
  }

  async function handleDeleteSelected() {
    const ids = sentences.filter((sentence) => sentence.selected).map((sentence) => sentence.id);
    if (ids.length === 0) return;
    if (!confirm(`선택한 ${ids.length}개 문장을 삭제할까요?`)) return;
    await runTask(async () => {
      await deleteSentences(ids);
      await refreshAll();
      await refreshSentences();
      showNotice("success", "선택한 문장을 삭제했습니다.");
    });
  }

  async function handleClearDeck() {
    if (!activeDeckId || sentences.length === 0 || !confirm("현재 세트의 모든 문장을 삭제할까요?")) return;
    await runTask(async () => {
      await clearDeckSentences(activeDeckId);
      await refreshAll();
      await refreshSentences();
      showNotice("success", "모든 문장을 삭제했습니다.");
    });
  }

  async function handleFileImport(file: File | null) {
    if (!file) return;
    await runTask(async () => {
      const existing = activeDeckId ? await listSentences(activeDeckId) : [];
      setImportPreview(await previewImportFile(file, existing));
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function commitImportPreview(mode: "valid" | "all") {
    if (!importPreview) return;
    await runTask(async () => {
      const deck = activeDeckId ? activeDeck : await createDeck(importPreview.deckName);
      if (!deck) throw new Error("가져올 세트를 찾지 못했습니다.");
      const rows = mode === "valid" ? importPreview.validRows : importPreview.rows.filter((row) => row.english.trim() && row.korean.trim());
      if (rows.length === 0) throw new Error("가져올 수 있는 문장이 없습니다.");
      await addImportedSentences(deck.id, rows);
      setActiveDeckId(deck.id);
      setImportPreview(null);
      await refreshAll();
      await refreshSentences(deck.id);
      setView("manage");
      showNotice("success", `${rows.length}개 문장을 가져왔습니다.`);
    });
  }

  async function handleBackupImport(file: File | null) {
    if (!file) return;
    await runTask(async () => {
      await importBackup(await parseBackup(file));
      await refreshAll();
      showNotice("success", "백업을 가져왔습니다.");
    });
    if (backupInputRef.current) backupInputRef.current.value = "";
  }

  async function handleBackupExport() {
    await runTask(async () => {
      const backup = await exportBackup(settings?.defaultExportIncludesHistory ?? true);
      downloadJson(`sentence-anki-backup-${new Date().toISOString().slice(0, 10)}.json`, backup);
      showNotice("success", "백업 파일을 내보냈습니다.");
    });
  }

  function dueSentences() {
    const dueIds = new Set(reviews.filter((review) => review.nextReviewAt <= nowIso()).map((review) => review.sentenceId));
    return allSentences.filter((sentence) => dueIds.has(sentence.id));
  }

  function weakSentences() {
    const weakIds = new Set(reviews.filter((review) => review.lastWrong || review.correctAttempts / Math.max(1, review.attempts) < 0.7).map((review) => review.sentenceId));
    return allSentences.filter((sentence) => weakIds.has(sentence.id));
  }

  function startStudy(source: "all" | "selected" | "wrong" | "due" | "weak" = "all") {
    const base =
      source === "wrong"
        ? wrongResults.map((result) => studySource.find((sentence) => sentence.id === result.sentenceId)).filter((sentence): sentence is Sentence => Boolean(sentence))
        : source === "selected"
          ? sentences.filter((sentence) => sentence.selected)
          : source === "due"
            ? dueSentences()
            : source === "weak"
              ? weakSentences()
              : sentences;
    if (base.length === 0) {
      showNotice("error", source === "selected" ? "선택된 문장이 없습니다." : "학습할 문장이 없습니다.");
      return;
    }
    const ordered = orderSentences(base, studyMode, reviews);
    const weakWords = extractWeakWords(records, allSentences);
    setSessionId(createId("session"));
    setStudySource(ordered);
    setPrompts(ordered.map((sentence) => makePrompt(sentence, difficulty, settings?.blankMode ?? "random", weakWords)));
    setCurrentIndex(0);
    setResults([]);
    setCurrentResult(null);
    setView("study");
  }

  async function submitAnswer(event?: FormEvent) {
    event?.preventDefault();
    if (!currentPrompt || !settings) return;
    const result = gradePrompt(currentPrompt, answers, settings.grading, promptStartedAt);
    setCurrentResult(result);
    if (result.isCorrect && settings.studyScreen.autoAdvanceCorrect) await moveNext(result);
  }

  async function persistResults(nextResults: StudyResult[]) {
    if (!activeDeckId) return;
    const recordItems: StudyRecord[] = nextResults.map((result) => ({
      id: createId("record"),
      deckId: activeDeckId,
      sentenceId: result.sentenceId,
      sessionId,
      answer: result.answer,
      correctAnswer: result.correctAnswer,
      isCorrect: result.isCorrect,
      forcedCorrect: result.forcedCorrect,
      difficulty,
      blankMode: settings?.blankMode ?? "random",
      responseMs: result.responseMs,
      studiedAt: result.completedAt,
    }));
    await saveStudyRecords(recordItems);
    await touchDeck(activeDeckId);
    await refreshAll();
  }

  async function moveNext(result = currentResult) {
    if (!result || !currentPrompt) return;
    const nextResults = [...results.filter((item) => item.sentenceId !== result.sentenceId), result];
    setResults(nextResults);
    if (currentIndex + 1 >= prompts.length) {
      await persistResults(nextResults);
      setView("result");
      return;
    }
    setCurrentIndex((index) => index + 1);
  }

  async function forceCorrect() {
    if (!currentResult) return;
    await moveNext({ ...currentResult, isCorrect: true, forcedCorrect: true });
  }

  async function saveSettings(next: AppSettings) {
    await updateSettings(next);
    setSettings(next);
    showNotice("success", "설정을 저장했습니다.");
  }

  function openApp() {
    setView("dashboard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderLanding() {
    return (
      <main className="landingPage">
        <section className="landingHero">
          <div className="heroStudyScene" aria-hidden="true">
            <div className="sceneWindow">
              <div className="sceneToolbar">
                <span />
                <span />
                <span />
              </div>
              <div className="sceneContent">
                <div className="sceneMetric">
                  <strong>24</strong>
                  <small>오늘 복습</small>
                </div>
                <div className="scenePrompt">
                  <span>이탈리아 음식에 오신 것을 환영합니다.</span>
                  <p>
                    Welcome to <mark>Italian</mark> <mark>Food</mark>.
                  </p>
                </div>
                <div className="sceneRows">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
          <nav className="landingNav">
            <button onClick={openApp}>앱 열기</button>
            <a href="mailto:jiho@mjiho.com">문의</a>
          </nav>
          <div className="landingHeroContent">
            <p className="eyebrow">SentenceAnki</p>
            <h1>문장 암기를 시험처럼, 복습은 자동으로.</h1>
            <p>
              한국어 해석을 보고 영어 문장의 빈칸을 채우는 학습 흐름에 SRS 복습, 파일 가져오기,
              오답 재학습을 더한 브라우저 기반 문장 암기 앱입니다.
            </p>
            <div className="landingActions">
              <button className="button primary" onClick={openApp}>
                <Play size={18} /> 바로 시작하기
              </button>
              <a className="button ghost" href="mailto:jiho@mjiho.com">
                <Mail size={18} /> jiho@mjiho.com
              </a>
            </div>
          </div>
        </section>

        <section className="landingSection">
          <div className="sectionIntro">
            <p className="eyebrow">Workflow</p>
            <h2>자료를 넣고, 바로 테스트하고, 틀린 문장만 다시 봅니다.</h2>
          </div>
          <div className="featureGrid">
            <article>
              <Upload size={22} />
              <h3>Excel/CSV/DB 가져오기</h3>
              <p>ID, English, Korean 컬럼과 기존 SQLite DB를 미리보기로 검증한 뒤 저장합니다.</p>
            </article>
            <article>
              <BookOpen size={22} />
              <h3>빈칸 학습</h3>
              <p>난이도와 빈칸 생성 모드를 조절해 실제 시험처럼 문장을 입력합니다.</p>
            </article>
            <article>
              <CalendarClock size={22} />
              <h3>SRS 복습 큐</h3>
              <p>오답, 낮은 정답률, 복습 예정일을 기준으로 오늘 볼 문장을 정리합니다.</p>
            </article>
          </div>
        </section>

        <section className="landingBand">
          <div>
            <p className="eyebrow">Designed for focus</p>
            <h2>설명보다 행동이 먼저 보이는 학습 대시보드</h2>
          </div>
          <button className="button primary" onClick={openApp}>
            학습 대시보드 보기 <ArrowUpRight size={18} />
          </button>
        </section>

        <SiteFooter />
      </main>
    );
  }

  function renderDeckCard(deck: Deck) {
    return (
      <article className={`deckCard ${deck.id === activeDeckId ? "active" : ""}`} key={deck.id}>
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
            <small>Enter 저장, Esc 취소</small>
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
          <button className="iconButton small" aria-label={`${deck.name} 이름 수정`} onClick={() => { setRenamingDeckId(deck.id); setRenamingDeckName(deck.name); }}>
            <Pencil size={16} />
          </button>
          <button className="iconButton small" aria-label={`${deck.name} 파일로 내보내기`} onClick={() => setExportMenuDeckId((currentId) => (currentId === deck.id ? null : deck.id))}>
            <Download size={16} />
          </button>
          <button className="iconButton small dangerIcon" aria-label={`${deck.name} 삭제`} onClick={() => handleDeleteDeckById(deck)}>
            <Trash2 size={16} />
          </button>
          {exportMenuDeckId === deck.id && (
            <div className="exportMenu">
              <label className="menuCheck">
                <input type="checkbox" checked={exportHistory} onChange={(event) => setExportHistory(event.target.checked)} /> 기록 포함
              </label>
              <button onClick={() => handleExportDeck(deck, "xlsx")}>Excel</button>
              <button onClick={() => handleExportDeck(deck, "csv")}>CSV</button>
              <button onClick={() => handleExportDeck(deck, "db")}>DB</button>
              <button onClick={() => handleExportDeck(deck, "json")}>JSON</button>
            </div>
          )}
        </div>
      </article>
    );
  }

  function renderDashboard() {
    return (
      <main className="shell dashboardShell">
        <section className="topbar">
          <div>
            <p className="eyebrow">SentenceAnki Web</p>
            <h1>오늘 할 학습을 한 화면에서 끝내세요</h1>
          </div>
          <div className="topbarActions">
            <button className="button ghost" onClick={() => setView("landing")}>
              <Home size={18} /> 소개
            </button>
            <button className="button ghost" onClick={() => setView("settings")}>
              <Settings2 size={18} /> 설정
            </button>
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

        <section className="focusBoard">
          <div className="focusPrimary">
            <p className="eyebrow">Next Action</p>
            <h2>{metrics.dueToday > 0 ? "오늘 복습부터 시작" : activeDeck ? "현재 세트 바로 학습" : "문장 세트 만들기"}</h2>
            <p>
              {metrics.dueToday > 0
                ? "복습 예정 문장을 우선 처리하면 장기 기억 흐름을 유지할 수 있습니다."
                : activeDeck
                  ? `${activeDeck.name} 세트에서 이어서 학습할 수 있습니다.`
                  : "파일을 가져오거나 새 세트를 만들어 첫 학습을 준비하세요."}
            </p>
            <div className="focusActions">
              <button className="button primary" onClick={() => (metrics.dueToday > 0 ? startStudy("due") : activeDeck ? startStudy("all") : handleCreateDeck())}>
                <Play size={18} /> {metrics.dueToday > 0 ? "복습 시작" : activeDeck ? "학습 시작" : "새 세트 만들기"}
              </button>
              <button className="button ghost" onClick={() => fileInputRef.current?.click()}>
                <Import size={18} /> 자료 가져오기
              </button>
            </div>
          </div>
          <div className="focusStats">
            <span><strong>{decks.length}</strong>세트</span>
            <span><strong>{allSentences.length}</strong>문장</span>
            <span><strong>{metrics.weak}</strong>취약</span>
          </div>
        </section>

        <section className="dashboardGrid">
          <div className="panel reviewPanel">
            <div className="panelHeader">
              <div>
                <h2>복습 큐</h2>
                <p>SRS 기록을 기준으로 오늘 볼 문장과 취약 문장을 먼저 제안합니다.</p>
              </div>
              <CalendarClock size={22} />
            </div>
            <div className="metricGrid">
              <button className="metricCard" onClick={() => startStudy("due")}>
                <span>{metrics.dueToday}</span>
                <small>오늘 복습</small>
              </button>
              <button className="metricCard warn" onClick={() => startStudy("due")}>
                <span>{metrics.overdue}</span>
                <small>밀린 복습</small>
              </button>
              <button className="metricCard danger" onClick={() => startStudy("weak")}>
                <span>{metrics.weak}</span>
                <small>취약 문장</small>
              </button>
            </div>
          </div>

          <div className="panel importPanel">
            <div className="panelHeader">
              <div>
                <h2>자료 가져오기</h2>
                <p>Excel, CSV, 기존 SQLite DB를 미리보기로 검증한 뒤 저장합니다.</p>
              </div>
              <Upload size={22} />
            </div>
            <button className="uploadBox" onClick={() => fileInputRef.current?.click()}>
              <Import size={28} />
              <span>파일 선택</span>
              <small>.xlsx, .xls, .csv, .db</small>
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>문장 세트</h2>
              <p>세트를 선택하면 문장 관리, 선택 학습, 내보내기를 이어서 할 수 있습니다.</p>
            </div>
          </div>
          {decks.length === 0 ? <EmptyState /> : <div className="deckGrid">{decks.map(renderDeckCard)}</div>}
        </section>

        <section className="panel recentPanel">
          <div className="panelHeader">
            <div>
              <h2>최근 학습</h2>
              <p>정답률과 응답 시간을 계속 쌓아 복습 우선순위에 반영합니다.</p>
            </div>
          </div>
          {metrics.recentRecords.length === 0 ? (
            <div className="tableEmpty">아직 학습 기록이 없습니다.</div>
          ) : (
            <div className="recentList">
              {metrics.recentRecords.map((record) => (
                <article className="recentItem" key={record.id}>
                  <strong>{record.isCorrect ? "정답" : "오답"}</strong>
                  <span>{formatDateTime(record.studiedAt)}</span>
                  <small>{formatDuration(record.responseMs)} · 난이도 {record.difficulty}</small>
                </article>
              ))}
            </div>
          )}
        </section>
        <DashboardNav />
        <SiteFooter />
      </main>
    );
  }

  function DashboardNav() {
    return (
      <nav className="floatingTabBar" aria-label="대시보드 주요 기능">
        <button className="active" onClick={() => setView("dashboard")}>
          <Home size={18} />
          <span>홈</span>
        </button>
        <button onClick={() => (activeDeck ? setView("manage") : handleCreateDeck())}>
          <FolderOpen size={18} />
          <span>세트</span>
        </button>
        <button onClick={() => (metrics.dueToday > 0 ? startStudy("due") : startStudy("all"))} disabled={!activeDeck && metrics.dueToday === 0}>
          <Play size={18} />
          <span>학습</span>
        </button>
        <button onClick={() => fileInputRef.current?.click()}>
          <Import size={18} />
          <span>가져오기</span>
        </button>
        <button onClick={() => setView("settings")}>
          <Settings2 size={18} />
          <span>설정</span>
        </button>
      </nav>
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
            <input className="deckTitleInput" value={editingDeckName || activeDeck?.name || ""} onChange={(event) => setEditingDeckName(event.target.value)} onBlur={handleSaveDeckName} />
            <p>{sentences.length}개 문장 · 선택 {selectedCount}개 · 복습 상태 {activeReviews.length}개</p>
          </div>
          <div className="topbarActions">
            <button className="button ghost" onClick={() => setView("settings")}>
              <Settings2 size={18} /> 학습 설정
            </button>
            <button className="button ghost dangerText" onClick={() => activeDeck && handleDeleteDeckById(activeDeck)}>
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
              <input type="range" min={1} max={5} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} />
            </label>
            <div className="segmented three">
              <button className={studyMode === "ordered" ? "active" : ""} onClick={() => setStudyMode("ordered")}>순서</button>
              <button className={studyMode === "random" ? "active" : ""} onClick={() => setStudyMode("random")}>랜덤</button>
              <button className={studyMode === "srs" ? "active" : ""} onClick={() => setStudyMode("srs")}>SRS</button>
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
                <p>자동 번역은 보조 입력입니다. 저장 전에 해석을 직접 확인하세요.</p>
              </div>
            </div>
            <form className="sentenceForm" onSubmit={handleSaveSentence}>
              <div className="segmented compactSegments">
                <button type="button" className={sentenceForm.translateMode === "manual" ? "active" : ""} onClick={() => { setAutoKoreanDirty(false); setTranslationStatus(""); setSentenceForm((form) => ({ ...form, translateMode: "manual" })); }}>수동 번역</button>
                <button type="button" className={sentenceForm.translateMode === "auto" ? "active" : ""} onClick={() => { setAutoKoreanDirty(false); setSentenceForm((form) => ({ ...form, translateMode: "auto" })); }}>실시간 번역</button>
              </div>
              <textarea placeholder="English sentence" value={sentenceForm.english} onChange={(event) => { if (sentenceForm.translateMode === "auto") setAutoKoreanDirty(false); setSentenceForm((form) => ({ ...form, english: event.target.value })); }} />
              {sentenceForm.translateMode === "auto" && (
                <div className="translateControls">
                  {isTranslating ? <Loader2 className="spin" size={18} /> : <Languages size={18} />}
                  <span>{translationStatus || "영어 문장을 입력하면 실시간으로 번역합니다."}</span>
                </div>
              )}
              <textarea placeholder="한국어 해석" value={sentenceForm.korean} onChange={(event) => { if (sentenceForm.translateMode === "auto") setAutoKoreanDirty(true); setSentenceForm((form) => ({ ...form, korean: event.target.value })); }} />
              <input className="textInput" placeholder="태그, 쉼표로 구분" value={sentenceForm.tags} onChange={(event) => setSentenceForm((form) => ({ ...form, tags: event.target.value }))} />
              <div className="formActions">
                {sentenceForm.id && (
                  <button type="button" className="button ghost" onClick={resetEditorState}>
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

        <section className="panel bulkPanel">
          <div className="panelHeader">
            <div>
              <h2>빠른 붙여넣기</h2>
              <p>한 줄에 `English 탭 Korean` 또는 `English - Korean` 형식으로 여러 문장을 넣을 수 있습니다.</p>
            </div>
          </div>
          <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={"Welcome to Italian Food.\t이탈리아 음식에 오신 것을 환영합니다."} />
          <button className="button primary" onClick={handleBulkAdd} disabled={!bulkText.trim()}>
            <Plus size={18} /> 여러 문장 추가
          </button>
        </section>

        <section className="panel tablePanel">
          <div className="tableToolbar">
            <label className="searchBox">
              <Search size={18} />
              <input placeholder="문장, 해석, 태그 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="toolbarActions">
              <div className="segmented viewSwitch">
                <button className={sentenceView === "table" ? "active" : ""} onClick={() => setSentenceView("table")}><List size={16} /></button>
                <button className={sentenceView === "cards" ? "active" : ""} onClick={() => setSentenceView("cards")}><Grid2X2 size={16} /></button>
              </div>
              <button className="button ghost" onClick={handleDeleteSelected} disabled={selectedCount === 0}>
                <Trash2 size={18} /> 선택 삭제
              </button>
              <button className="button ghost dangerText" onClick={handleClearDeck} disabled={sentences.length === 0}>
                <Trash2 size={18} /> 전체 삭제
              </button>
            </div>
          </div>
          {sentenceView === "table" ? renderSentenceTable() : renderSentenceCards()}
        </section>
      </main>
    );
  }

  function editSentence(sentence: Sentence) {
    setSentenceForm({
      id: sentence.id,
      english: sentence.english,
      korean: sentence.korean,
      tags: sentence.tags.join(", "),
      translateMode: "manual",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSentenceTable() {
    return (
      <div className="sentenceTableWrap">
        <table className="sentenceTable">
          <thead>
            <tr>
              <th>선택</th>
              <th>English</th>
              <th>Korean</th>
              <th>태그</th>
              <th>편집</th>
            </tr>
          </thead>
          <tbody>
            {filteredSentences.map((sentence) => (
              <tr key={sentence.id}>
                <td><input type="checkbox" checked={sentence.selected} onChange={async (event) => { await setSentenceSelected(sentence.id, event.target.checked); await refreshSentences(); }} /></td>
                <td>{sentence.english}</td>
                <td>{sentence.korean}</td>
                <td>{sentence.tags.join(", ") || "-"}</td>
                <td><button className="iconButton small" aria-label="문장 수정" onClick={() => editSentence(sentence)}><Pencil size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredSentences.length === 0 && <div className="tableEmpty">표시할 문장이 없습니다.</div>}
      </div>
    );
  }

  function renderSentenceCards() {
    return (
      <div className="sentenceCards">
        {filteredSentences.map((sentence) => (
          <article className="sentenceCard" key={sentence.id}>
            <label><input type="checkbox" checked={sentence.selected} onChange={async (event) => { await setSentenceSelected(sentence.id, event.target.checked); await refreshSentences(); }} /> 선택</label>
            <strong>{sentence.english}</strong>
            <span>{sentence.korean}</span>
            <small><Tags size={14} /> {sentence.tags.join(", ") || "태그 없음"}</small>
            <button className="button ghost" onClick={() => editSentence(sentence)}><Pencil size={16} /> 수정</button>
          </article>
        ))}
        {filteredSentences.length === 0 && <div className="tableEmpty">표시할 문장이 없습니다.</div>}
      </div>
    );
  }

  function renderStudy() {
    if (!currentPrompt) return null;
    const progress = Math.round(((currentIndex + 1) / prompts.length) * 100);
    return (
      <main className="studyShell">
        <section className="studyHeader">
          <button className="iconButton" aria-label="문장 관리로 돌아가기" onClick={() => setView("manage")}><ArrowLeft size={20} /></button>
          <div className="progressBlock">
            <span>{currentIndex + 1} / {prompts.length}</span>
            <div className="progressTrack"><div style={{ width: `${progress}%` }} /></div>
          </div>
          <span className="difficultyBadge">난이도 {difficulty} · {blankModeLabels[settings?.blankMode ?? "random"]}</span>
        </section>
        <section className="studyCard">
          <p className="translation">{currentPrompt.sentence.korean}</p>
          <form className="promptLine" onSubmit={submitAnswer}>
            {currentPrompt.parts.map((part, index) =>
              part.type === "text" ? (
                <span key={`${part.value}-${index}`}>{part.value}</span>
              ) : (
                <span className="blankWrap" key={part.index}>
                  <input
                    ref={(node) => { blankRefs.current[part.index] = node; }}
                    aria-label={`${part.index + 1}번 빈칸`}
                    value={answers[part.index] ?? ""}
                    onChange={(event) => setAnswers((values) => values.map((value, answerIndex) => (answerIndex === part.index ? event.target.value : value)))}
                  />
                  {shownHints.includes(part.index) && <small>{part.hint}</small>}
                </span>
              ),
            )}
            <button className="button submitButton" type="submit"><Check size={18} /> 정답 제출</button>
          </form>
          <div className="studyActions">
            {settings?.studyScreen.showHintButton && (
              <button className="button ghost" onClick={() => setShownHints(currentPrompt.blanks.map((blank) => blank.index))}>
                <Eye size={18} /> 힌트 보기
              </button>
            )}
            <span><Keyboard size={16} /> Enter 제출</span>
          </div>
          {currentResult && (
            <div className={`answerPanel ${currentResult.isCorrect ? "correct" : ""}`}>
              <strong>{currentResult.isCorrect ? "정답입니다." : `정답: ${getCorrectAnswer(currentPrompt)}`}</strong>
              <span>입력: {currentResult.answer || "빈 답안"} · {formatDuration(currentResult.responseMs)}</span>
              {!currentResult.isCorrect && (
                <div className="diffLine">
                  {currentResult.diff.map((part, index) => <mark className={part.type} key={`${part.value}-${index}`}>{part.value}</mark>)}
                </div>
              )}
              <div>
                <button className="button primary" onClick={() => moveNext()}>다음 문장</button>
                {!currentResult.isCorrect && <button className="button ghost" onClick={forceCorrect}>정답 처리하기</button>}
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
    const averageMs = total === 0 ? 0 : Math.round(results.reduce((sum, result) => sum + result.responseMs, 0) / total);
    const wrongSentenceMap = new Map(studySource.map((sentence) => [sentence.id, sentence]));
    return (
      <main className="shell resultShell">
        <section className="resultHero">
          <CheckCircle2 size={40} />
          <p>학습 완료</p>
          <h1>{score}%</h1>
          <span>정답 {correctCount}개 · 오답 {total - correctCount}개 · 평균 {formatDuration(averageMs)}</span>
          <div className="resultActions">
            <button className="button primary" onClick={() => startStudy("wrong")} disabled={wrongResults.length === 0}><RotateCcw size={18} /> 오답만 다시 학습</button>
            <button className="button ghost" onClick={() => startStudy("all")}><Play size={18} /> 같은 설정으로 재시작</button>
            <button className="button ghost" onClick={() => setView("manage")}>문장 관리로</button>
          </div>
        </section>
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>오답 목록</h2>
              <p>오답은 다음 복습 큐와 취약 문장에 우선 반영됩니다.</p>
            </div>
          </div>
          <div className="wrongList">
            {wrongResults.length === 0 ? <div className="tableEmpty">오답이 없습니다.</div> : wrongResults.map((result) => {
              const sentence = wrongSentenceMap.get(result.sentenceId);
              return (
                <article key={result.sentenceId} className="wrongItem">
                  <strong>{sentence?.korean}</strong>
                  <span>{sentence?.english}</span>
                  <small>입력: {result.answer || "빈 답안"} · 정답: {result.correctAnswer}</small>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    );
  }

  function renderSettings() {
    if (!settings) return null;
    return (
      <main className="shell">
        <section className="topbar compact">
          <button className="iconButton" aria-label="뒤로" onClick={() => setView(activeDeckId ? "manage" : "dashboard")}><ArrowLeft size={20} /></button>
          <div>
            <p className="eyebrow">Settings</p>
            <h1>채점, 빈칸, 동기화 설정</h1>
          </div>
        </section>
        <section className="settingsGrid">
          <div className="panel">
            <div className="panelHeader"><div><h2>채점 옵션</h2><p>수업 방식에 맞춰 정답 판정을 조절합니다.</p></div><ShieldAlert size={22} /></div>
            {([
              ["ignoreCase", "대소문자 무시"],
              ["ignorePunctuation", "문장부호 무시"],
              ["normalizeWhitespace", "공백 정규화"],
              ["allowTypo", "짧은 오타 허용"],
            ] as const).map(([key, label]) => (
              <label className="checkRow" key={key}>
                <input type="checkbox" checked={settings.grading[key]} onChange={(event) => saveSettings({ ...settings, grading: { ...settings.grading, [key]: event.target.checked } })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="panel">
            <div className="panelHeader"><div><h2>빈칸 생성</h2><p>난이도와 별개로 어떤 단어를 가릴지 선택합니다.</p></div><BarChart3 size={22} /></div>
            <div className="optionGrid">
              {(Object.keys(blankModeLabels) as BlankMode[]).map((mode) => (
                <button className={`optionCard ${settings.blankMode === mode ? "active" : ""}`} key={mode} onClick={() => saveSettings({ ...settings, blankMode: mode })}>
                  {blankModeLabels[mode]}
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panelHeader"><div><h2>학습 화면</h2><p>입력 흐름과 결과 확인 방식을 조절합니다.</p></div><Keyboard size={22} /></div>
            <label className="checkRow"><input type="checkbox" checked={settings.studyScreen.autoAdvanceCorrect} onChange={(event) => saveSettings({ ...settings, studyScreen: { ...settings.studyScreen, autoAdvanceCorrect: event.target.checked } })} /><span>정답이면 자동으로 다음 문장 이동</span></label>
            <label className="checkRow"><input type="checkbox" checked={settings.studyScreen.showHintButton} onChange={(event) => saveSettings({ ...settings, studyScreen: { ...settings.studyScreen, showHintButton: event.target.checked } })} /><span>힌트 버튼 표시</span></label>
            <label className="checkRow"><input type="checkbox" checked={settings.defaultExportIncludesHistory} onChange={(event) => saveSettings({ ...settings, defaultExportIncludesHistory: event.target.checked })} /><span>백업 내보내기에 학습 기록 포함</span></label>
          </div>
          <div className="panel">
            <div className="panelHeader"><div><h2>클라우드 동기화</h2><p>비로그인 상태에서는 브라우저 IndexedDB만 사용합니다.</p></div><Cloud size={22} /></div>
            <div className="comingSoonPanel">
              <Sparkles size={22} />
              <strong>준비중입니다.</strong>
              <p>기기 간 동기화, 학습 진행 상황 저장, 개인 맞춤형 학습 Coming Soon</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  function renderImportPreview() {
    if (!importPreview) return null;
    return (
      <div className="modalBackdrop">
        <section className="modalCard">
          <div className="panelHeader">
            <div>
              <h2>가져오기 미리보기</h2>
              <p>{importPreview.fileName} · 정상 {importPreview.validRows.length}개 · 수정 필요 {importPreview.invalidRows.length}개 · 중복 {importPreview.duplicateRows.length}개</p>
            </div>
            <button className="iconButton" onClick={() => setImportPreview(null)}><X size={20} /></button>
          </div>
          <div className="previewTable">
            {importPreview.rows.slice(0, 12).map((row) => (
              <article className={row.valid ? "valid" : "invalid"} key={`${row.rowNumber}-${row.english}`}>
                <strong>#{row.rowNumber} {row.english || "(비어 있음)"}</strong>
                <span>{row.korean || "(비어 있음)"}</span>
                {row.issues && row.issues.length > 0 && <small>{row.issues.join(", ")}</small>}
              </article>
            ))}
          </div>
          <div className="formActions">
            <button className="button ghost" onClick={() => commitImportPreview("all")}>비어있지 않은 행 모두 가져오기</button>
            <button className="button primary" onClick={() => commitImportPreview("valid")}>정상 행만 가져오기</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <>
      {busy && <div className="busyOverlay"><Loader2 className="spin" size={24} /> 처리 중</div>}
      {notice && <div className={`toast ${notice.type}`}>{notice.message}</div>}
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.db" hidden onChange={(event) => void handleFileImport(event.target.files?.[0] ?? null)} />
      <input ref={backupInputRef} type="file" accept=".json" hidden onChange={(event) => void handleBackupImport(event.target.files?.[0] ?? null)} />
      {view === "landing" && renderLanding()}
      {view === "dashboard" && renderDashboard()}
      {view === "manage" && renderManage()}
      {view === "study" && renderStudy()}
      {view === "result" && renderResult()}
      {view === "settings" && renderSettings()}
      {renderImportPreview()}
    </>
  );
}

function EmptyState() {
  return (
    <div className="emptyState">
      <Settings2 size={28} />
      <strong>아직 문장 세트가 없습니다.</strong>
      <span>Excel/CSV/DB를 가져오거나 새 세트를 만들어 문장을 추가하세요.</span>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="siteFooter">
      <a href="https://mjiho.com" target="_blank" rel="noreferrer">
        Made By Jiho Min
      </a>
    </footer>
  );
}

export default App;
