import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { BackupPayload } from "./types";
import { clearSyncItems, exportBackup, getPendingSyncItems } from "./storage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

let client: SupabaseClient | null = null;

export function isCloudSyncConfigured() {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseClient() {
  if (!isCloudSyncConfigured()) return null;
  client ??= createClient(supabaseUrl!, supabasePublishableKey!, {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      flowType: "pkce",
    },
  });
  return client;
}

export function formatSupabaseError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "details" in error) return String((error as { details: unknown }).details);
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return "Supabase 요청에 실패했습니다.";
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

export async function completeOAuthRedirect(): Promise<User | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const existingUser = await getSessionUser();
  if (existingUser) return existingUser;

  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  window.history.replaceState({}, document.title, window.location.pathname);
  return data.session?.user ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 환경변수가 없어 클라우드 동기화를 사용할 수 없습니다.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUpWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 환경변수가 없어 클라우드 동기화를 사용할 수 없습니다.");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signInWithGoogle() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase 환경변수가 없어 클라우드 동기화를 사용할 수 없습니다.");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin,
      scopes: "openid email profile",
    },
  });
  if (error) throw error;
}

export function onAuthStateChanged(callback: (user: User | null) => void) {
  const supabase = getSupabaseClient();
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function uploadLocalSnapshot(userId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) return { uploaded: false, count: 0 };
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("로그인 세션이 없습니다. 다시 로그인하세요.");

  const backup: BackupPayload = await exportBackup(true);
  const { error } = await supabase.from("sentence_anki_snapshots").upsert({
    user_id: userId,
    payload: backup,
    updated_at: backup.exportedAt,
  });
  if (error) {
    if (error.code === "42P01") {
      throw new Error("Supabase에 sentence_anki_snapshots 테이블이 없습니다. SQL Editor에서 테이블 생성 SQL을 먼저 실행하세요.");
    }
    if (error.code === "42501") {
      throw new Error("Supabase RLS 정책 때문에 업로드가 거부됐습니다. own snapshot 정책을 다시 확인하세요.");
    }
    throw error;
  }

  const pending = await getPendingSyncItems();
  await clearSyncItems(pending.map((item) => item.id));
  return { uploaded: true, count: pending.length };
}

export const supabaseSchemaHint = `
create table if not exists sentence_anki_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table sentence_anki_snapshots enable row level security;
create policy "own snapshot" on sentence_anki_snapshots
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
`;
