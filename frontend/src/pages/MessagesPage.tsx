import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AxiosError } from 'axios';
import { useTranslation } from 'react-i18next';
import {
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  startConversation,
} from '@/api/messaging';
import type { Conversation, Message } from '@/features/messaging/types';
import { appendPage, mergeFirstPage } from '@/features/messaging/conversations';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import type { RootState } from '@/app/store';
import { syncUnreadCounts } from '@/features/notifications/syncUnreadCounts';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageTitle } from '@/components/ui/PageTitle';
import { userPath } from '@/lib/paths';
import { timeAgo } from '@/lib/time';
import { cn } from '@/lib/cn';
import { usePolling } from '@/lib/usePolling';
import { Check, CheckCheck, ChevronLeft } from 'lucide-react';

const POLL_MS = 4_000;
const CONVERSATIONS_POLL_MS = 30_000;
// How close to the bottom still counts as "reading the latest messages".
const BOTTOM_SLACK_PX = 40;

function byTimeThenId(a: Message, b: Message) {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id;
}

export function MessagesPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { getState } = useStore<RootState>();
  const currentUserId = useAppSelector((s) => s.auth.user?.id);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convsLoading, setConvsLoading] = useState(true);
  const [nextConvPage, setNextConvPage] = useState<number | null>(null);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const [loadMoreConvsFailed, setLoadMoreConvsFailed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const refetchedForId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listConversations(1)
      .then((d) => {
        if (cancelled) return;
        setConversations(d.results);
        setNextConvPage(d.next ? 2 : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setConvsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshConversations = useCallback(() => {
    // Only page 1 is polled; rows loaded from later pages stay below it.
    listConversations(1)
      .then((d) => setConversations((prev) => mergeFirstPage(d.results, prev)))
      .catch(() => undefined);
  }, []);

  async function loadMoreConversations() {
    if (nextConvPage === null || loadingMoreConvs) return;
    setLoadingMoreConvs(true);
    setLoadMoreConvsFailed(false);
    try {
      const d = await listConversations(nextConvPage);
      setConversations((prev) => appendPage(prev, d.results));
      setNextConvPage(d.next ? nextConvPage + 1 : null);
    } catch {
      setLoadMoreConvsFailed(true);
    } finally {
      setLoadingMoreConvs(false);
    }
  }

  // Keeps unread counts and previews of the other conversations current.
  usePolling(refreshConversations, CONVERSATIONS_POLL_MS, !convsLoading);

  const selected = useMemo(
    () => conversations.find((c) => c.id === Number(id)) ?? null,
    [conversations, id],
  );

  // A routed conversation (e.g. from a DM notification) may have started after the list loaded.
  useEffect(() => {
    if (convsLoading || !id || selected || refetchedForId.current === id) return;
    refetchedForId.current = id;
    refreshConversations();
  }, [convsLoading, id, selected, refreshConversations]);

  async function handleNew(username: string): Promise<string | null> {
    try {
      const conv = await startConversation(username);
      // Avoid duplicate if already in list
      setConversations((prev) => (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]));
      setNewOpen(false);
      navigate(`/messages/${conv.id}`);
      return null;
    } catch (err) {
      const ax = err as AxiosError<{ username?: string[]; detail?: string }>;
      return ax.response?.data?.username?.[0] ?? ax.response?.data?.detail ?? t('messages.startFailed');
    }
  }

  return (
    <div className="grid h-[calc(100vh-128px)] grid-cols-[minmax(0,3fr)_minmax(0,7fr)] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-bg-1)] max-[720px]:grid-cols-1">
      <PageTitle title={t('titles.messages')} />
      {/* Inbox */}
      <aside className={cn('flex min-h-0 flex-col border-r border-[var(--color-border)]', selected && 'max-[720px]:hidden')}>
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{t('messages.inbox')}</h2>
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3 py-1 text-[12px] font-semibold text-[var(--color-on-accent)] transition hover:opacity-90"
          >
            {t('messages.newButton')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <p className="px-4 py-4 text-[13px] text-[var(--color-text-muted)]">{t('common.loading')}</p>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-[var(--color-text-muted)]">
              {t('messages.empty')}
            </p>
          ) : (
            conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                active={c.id === selected?.id}
                currentUserId={currentUserId}
              />
            ))
          )}
          {nextConvPage !== null && (
            <div className="px-4 py-3">
              <Button variant="secondary" size="sm" loading={loadingMoreConvs} onClick={loadMoreConversations}>
                {t('messages.loadMoreConversations')}
              </Button>
              {loadMoreConvsFailed && (
                <p className="mt-2 text-[12.5px] text-[var(--color-danger)]">
                  {t('messages.loadMoreConversationsFailed')}
                </p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Chat */}
      <section className={cn('flex min-h-0 min-w-0 flex-col', !selected && 'max-[720px]:hidden')}>
        {selected ? (
          <ChatPane
            key={selected.id}
            conversation={selected}
            currentUserId={currentUserId}
            onMessageSent={(msg) => {
              // The list is ordered by latest activity, so the conversation moves to the top.
              setConversations((prev) => {
                const sentIn = prev.find((c) => c.id === selected.id);
                if (!sentIn) return prev;
                return [{ ...sentIn, last_message: msg }, ...prev.filter((c) => c !== sentIn)];
              });
            }}
            onRead={() => {
              setConversations((prev) =>
                prev.map((c) => (c.id === selected.id ? { ...c, unread_count: 0 } : c)),
              );
              void syncUnreadCounts(dispatch, getState);
            }}
          />
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('messages.selectPrompt')}
              </p>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-[var(--color-on-accent)]"
              >
                {t('messages.startNew')}
              </button>
            </div>
          </div>
        )}
      </section>

      <NewConversationModal open={newOpen} onClose={() => setNewOpen(false)} onSubmit={handleNew} />
    </div>
  );
}

interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  currentUserId?: number;
}

function ConversationRow({ conversation, active, currentUserId }: ConversationRowProps) {
  const { t } = useTranslation();
  const other = conversation.other;
  const last = conversation.last_message;
  const isOwn = last?.sender === currentUserId;
  const preview = last
    ? isOwn
      ? t('messages.ownPreview', { body: last.body })
      : last.body
    : t('messages.noMessagesPreview');

  return (
    <Link
      to={`/messages/${conversation.id}`}
      className={cn(
        'flex gap-3 border-b border-[var(--color-border)] px-4 py-3 transition',
        active ? 'bg-[var(--color-bg-elevated)]' : 'hover:bg-[var(--color-surface)]',
      )}
    >
      <Avatar alt={other?.username} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-medium">u/{other?.username ?? '?'}</span>
          {last && (
            <span className="font-mono shrink-0 text-[10.5px] text-[var(--color-text-dim)]">
              {timeAgo(last.created_at)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[12.5px] text-[var(--color-text-muted)]">{preview}</p>
          {conversation.unread_count > 0 && (
            <span className="font-mono shrink-0 rounded-full bg-[var(--color-link)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-on-link)]">
              {conversation.unread_count}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

interface ChatPaneProps {
  conversation: Conversation;
  currentUserId?: number;
  onMessageSent: (msg: Message) => void;
  onRead: () => void;
}

function ChatPane({ conversation, currentUserId, onMessageSent, onRead }: ChatPaneProps) {
  const { t } = useTranslation();
  // Kept oldest → newest for rendering; the API pages newest → oldest.
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderPage, setOlderPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadOlderError, setLoadOlderError] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Lets the poll callback see the loaded list without re-creating itself.
  const messagesRef = useRef<Message[]>([]);
  // Bumped when a poll replaces the list, so an in-flight older page can tell it is stale.
  const listGeneration = useRef(0);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSendError(null);
    stickToBottom.current = true;
    listMessages(conversation.id)
      .then((d) => {
        if (cancelled) return;
        setMessages([...d.results].reverse());
        setOlderPage(d.next ? 2 : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    markConversationRead(conversation.id)
      .then(() => onRead())
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    messagesRef.current = messages;
    if (stickToBottom.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  const pollLatest = useCallback(() => {
    listMessages(conversation.id)
      .then((d) => {
        const loaded = messagesRef.current;
        const known = new Set(loaded.map((m) => m.id));
        // No shared id means more than a page of messages arrived; the gap can't be filled by merging.
        if (d.results.length > 0 && !d.results.some((m) => known.has(m.id))) {
          listGeneration.current += 1;
          setMessages([...d.results].reverse());
          setOlderPage(d.next ? 2 : null);
        } else {
          const latest = new Map(d.results.map((m) => [m.id, m]));
          // Filter against `current`: the ref can lag behind a just-sent message.
          setMessages((current) => {
            const have = new Set(current.map((m) => m.id));
            const fresh = d.results.filter((m) => !have.has(m.id));
            let receiptChanged = false;
            const refreshed = current.map((m) => {
              const polled = latest.get(m.id);
              if (!polled || polled.read_at === m.read_at) return m;
              receiptChanged = true;
              return polled;
            });
            // Same reference means no re-render, so an idle poll can't move the scroll position.
            if (fresh.length === 0 && !receiptChanged) return current;
            return [...refreshed, ...fresh].sort(byTimeThenId);
          });
        }
        if (d.results.some((m) => m.sender !== currentUserId && m.read_at === null)) {
          markConversationRead(conversation.id)
            .then(() => onRead())
            .catch(() => undefined);
        }
      })
      .catch((err: AxiosError) => {
        // Access was revoked or the conversation is gone; retrying can't succeed.
        const status = err.response?.status;
        if (status === 403 || status === 404) setLost(true);
      });
  }, [conversation.id, currentUserId, onRead]);

  usePolling(pollLatest, POLL_MS, !loading && !lost);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
  }

  async function loadOlder() {
    if (olderPage === null || loadingOlder) return;
    setLoadingOlder(true);
    setLoadOlderError(false);
    const generation = listGeneration.current;
    try {
      const d = await listMessages(conversation.id, olderPage);
      // A poll replaced the list meanwhile; this page no longer lines up with it.
      if (generation !== listGeneration.current) return;
      stickToBottom.current = false;
      setMessages((current) => {
        const known = new Set(current.map((m) => m.id));
        const older = [...d.results].reverse().filter((m) => !known.has(m.id));
        return [...older, ...current];
      });
      setOlderPage(d.next ? olderPage + 1 : null);
    } catch {
      setLoadOlderError(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await sendMessage(conversation.id, trimmed);
      stickToBottom.current = true;
      setMessages((m) => (m.some((x) => x.id === created.id) ? m : [...m, created]));
      onMessageSent(created);
      setBody('');
    } catch (err) {
      const ax = err as AxiosError<{ detail?: string; body?: string[] }>;
      setSendError(
        ax.response?.data?.detail ?? ax.response?.data?.body?.[0] ?? t('messages.sendFailed'),
      );
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e as unknown as FormEvent);
    }
  }

  const other = conversation.other;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
        <Link
          to="/messages"
          aria-label={t('messages.back')}
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-control)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] min-[721px]:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Avatar alt={other?.username} size="md" />
        <div className="min-w-0 flex-1">
          {other ? (
            <Link
              to={userPath(other.username)}
              className="text-[14px] font-semibold hover:text-[var(--color-link)]"
            >
              u/{other.username}
            </Link>
          ) : (
            <span className="text-[14px] font-semibold">u/?</span>
          )}
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t('messages.loadingMessages')}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-[var(--color-text-muted)]">
            {t('messages.emptyChat')}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {olderPage !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center"
                loading={loadingOlder}
                onClick={loadOlder}
              >
                {t('messages.loadOlder')}
              </Button>
            )}
            {loadOlderError && (
              <p role="alert" className="text-center text-xs text-[var(--color-danger)]">
                {t('messages.loadOlderFailed')}
              </p>
            )}
            {messages.map((m, i) => {
              const own = m.sender === currentUserId;
              const showAvatar = !own && (i === 0 || messages[i - 1].sender !== m.sender);
              return (
                <div key={m.id} className={cn('flex items-end gap-2', own ? 'justify-end' : 'justify-start')}>
                  {!own && (
                    <div className={cn('w-7 shrink-0', !showAvatar && 'opacity-0')}>
                      <Avatar alt={m.sender_username} size="xs" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-[70%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug whitespace-pre-wrap',
                      own
                        ? 'bg-[var(--color-link)] text-[var(--color-on-link)] rounded-br-md'
                        : 'bg-[var(--color-bg-elevated)] text-[var(--color-text)] rounded-bl-md',
                    )}
                  >
                    {m.body}
                    <div
                      className={cn(
                        'font-mono mt-1 flex items-center gap-1 text-[10px]',
                        own ? 'justify-end text-[var(--color-on-link)]/60' : 'text-[var(--color-text-dim)]',
                      )}
                    >
                      {timeAgo(m.created_at)}
                      {own && (
                        <span title={m.read_at ? t('messages.read') : t('messages.sent')}>
                          {m.read_at ? <CheckCheck className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                          <span className="sr-only">{m.read_at ? t('messages.read') : t('messages.sent')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lost ? (
        <p className="border-t border-[var(--color-border)] px-4 py-3 text-center text-sm text-[var(--color-text-muted)]">
          {t('messages.conversationUnavailable')}
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 border-t border-[var(--color-border)] px-4 py-3"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t('messages.placeholder', { username: other?.username })}
            className="max-h-32 flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3.5 py-2 text-[14px] placeholder:text-[var(--color-text-dim)] focus:border-[var(--color-link)] focus:outline-none focus:ring-2 focus:ring-[var(--color-link)]/30"
          />
          <Button type="submit" size="md" loading={sending} disabled={!body.trim()}>
            {t('messages.send')}
          </Button>
        </form>
      )}
      {sendError && (
        <p role="alert" className="px-4 pb-3 text-xs text-[var(--color-danger)]">
          {sendError}
        </p>
      )}
    </>
  );
}

interface NewConvModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (username: string) => Promise<string | null>;
}

function NewConversationModal({ open, onClose, onSubmit }: NewConvModalProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUsername('');
      setError(null);
    }
  }, [open]);

  async function handle(e: FormEvent) {
    e.preventDefault();
    const u = username.trim();
    if (!u || busy) return;
    setBusy(true);
    const err = await onSubmit(u);
    if (err) setError(err);
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('messages.newConversation')}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" loading={busy} disabled={!username.trim()} onClick={handle}>
            {t('messages.start')}
          </Button>
        </>
      }
    >
      <form onSubmit={handle} className="flex flex-col gap-3">
        <Input
          name="username"
          label={t('auth.username')}
          placeholder={t('messages.usernamePlaceholder')}
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/^@/, ''))}
          error={error}
          autoFocus
        />
      </form>
    </Modal>
  );
}
