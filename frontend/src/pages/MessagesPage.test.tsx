import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setUser } from '@/features/auth/authSlice';
import messagingReducer, { setDMUnreadCount } from '@/features/messaging/messagingSlice';
import type { Conversation, Message } from '@/features/messaging/types';
import { MessagesPage } from './MessagesPage';
import * as messagingApi from '@/api/messaging';
import * as usersApi from '@/api/users';
import i18n from '@/i18n';
import { resetLanguage, visibleText } from '@/test/i18nHelpers';

vi.mock('@/api/messaging', () => ({
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  markConversationRead: vi.fn(),
  sendMessage: vi.fn(),
  startConversation: vi.fn(),
}));

vi.mock('@/api/users', () => ({
  getUnreadCounts: vi.fn().mockResolvedValue({ notifications: 0, messages: 0 }),
}));

const api = vi.mocked(messagingApi);
const users = vi.mocked(usersApi);

const conversation: Conversation = {
  id: 1,
  participant_a: 1,
  participant_b: 2,
  other: { id: 2, username: 'bob' },
  last_message: null,
  unread_count: 0,
  created_at: '2026-10-01T00:00:00Z',
};

const otherConversation: Conversation = {
  ...conversation,
  id: 2,
  participant_b: 3,
  other: { id: 3, username: 'carol' },
};

function msg(id: number, sender = 2, conversationId = 1): Message {
  return {
    id,
    conversation: conversationId,
    sender,
    sender_username: sender === 1 ? 'alice' : 'bob',
    body: `m${id}`,
    created_at: `2026-10-01T00:0${id}:00Z`,
    read_at: null,
  };
}

function page(results: Message[], next: string | null) {
  return { count: results.length, next, previous: null, results };
}

function convs(results: Conversation[], next: string | null = null) {
  return { count: results.length, next, previous: null, results };
}

function renderAt(path: string, initialUnread = 0) {
  const store = configureStore({ reducer: { auth: authReducer, messaging: messagingReducer } });
  store.dispatch(setDMUnreadCount(initialUnread));
  store.dispatch(
    setUser({
      id: 1,
      username: 'alice',
      email: 'a@x.com',
      email_verified: true,
      avatar: null,
      bio: '',
      country: '',
      show_nsfw: false,
      post_karma: 0,
      comment_karma: 0,
    }),
  );
  const result = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:id" element={<MessagesPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { ...result, store };
}

function isBefore(a: HTMLElement, b: HTMLElement) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo'];
});

describe('MessagesPage chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConversations.mockResolvedValue(convs([conversation]));
    api.markConversationRead.mockResolvedValue();
  });

  it('shows the newest page oldest-to-newest and loads older messages on demand', async () => {
    api.listMessages
      .mockResolvedValueOnce(page([msg(3), msg(2)], 'p2'))
      .mockResolvedValueOnce(page([msg(2), msg(1)], null));
    renderAt('/messages/1');

    const m2 = await screen.findByText('m2');
    expect(isBefore(m2, screen.getByText('m3'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    const m1 = await screen.findByText('m1');
    expect(isBefore(m1, screen.getByText('m2'))).toBe(true);
    expect(screen.getAllByText('m2')).toHaveLength(1);
    expect(api.listMessages).toHaveBeenLastCalledWith(1, 2);
  });

  it('shows the API error when sending fails', async () => {
    api.listMessages.mockResolvedValue(page([], null));
    api.sendMessage.mockRejectedValue({
      response: { data: { detail: 'You cannot message this user.' } },
    });
    renderAt('/messages/1');

    await userEvent.type(await screen.findByPlaceholderText(/message u\/bob/i), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot message this user.');
  });
});

describe('MessagesPage chat edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConversations.mockResolvedValue(convs([conversation, otherConversation]));
    api.markConversationRead.mockResolvedValue();
  });

  it('ignores a stale older-page response after switching conversation', async () => {
    let resolveOlder!: (value: ReturnType<typeof page>) => void;
    api.listMessages.mockImplementation((conversationId, pageNumber) => {
      if (conversationId === 1 && pageNumber === 2) {
        return new Promise<ReturnType<typeof page>>((resolve) => {
          resolveOlder = resolve;
        });
      }
      if (conversationId === 1) return Promise.resolve(page([msg(3)], 'p2'));
      return Promise.resolve(page([msg(9, 2, 2)], null));
    });
    renderAt('/messages/1');

    await userEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    await userEvent.click(screen.getByRole('link', { name: /carol/ }));
    await screen.findByText('m9');

    await act(async () => resolveOlder(page([msg(1)], null)));
    expect(screen.queryByText('m1')).not.toBeInTheDocument();
    expect(screen.getByText('m9')).toBeInTheDocument();
  });

  it('shows an inline error and keeps the button when loading older messages fails', async () => {
    api.listMessages
      .mockResolvedValueOnce(page([msg(3)], 'p2'))
      .mockRejectedValueOnce(new Error('network'));
    renderAt('/messages/1');

    await userEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load older messages.');
    expect(screen.getByRole('button', { name: 'Load older messages' })).toBeInTheDocument();
  });
});

describe('MessagesPage polling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConversations.mockResolvedValue(convs([conversation]));
    api.markConversationRead.mockResolvedValue();
  });

  afterEach(() => vi.useRealTimers());

  it('merges new messages from a poll without duplicates', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    api.listMessages
      .mockResolvedValueOnce(page([msg(1)], null))
      .mockResolvedValue(page([msg(3), msg(2, 1), msg(1)], null));
    api.sendMessage.mockResolvedValue(msg(2, 1));
    renderAt('/messages/1');

    await user.type(await screen.findByPlaceholderText(/message u\/bob/i), 'm2');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('m2');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(await screen.findByText('m3')).toBeInTheDocument();
    expect(screen.getAllByText('m2')).toHaveLength(1);
    expect(api.markConversationRead).toHaveBeenCalledTimes(2);
  });

  it('keeps messages ordered by time when a poll brings an earlier message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    api.listMessages
      .mockResolvedValueOnce(page([msg(1)], null))
      .mockResolvedValue(page([msg(5, 1), msg(3), msg(1)], null));
    api.sendMessage.mockResolvedValue(msg(5, 1));
    renderAt('/messages/1');

    await user.type(await screen.findByPlaceholderText(/message u\/bob/i), 'm5');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('m5');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    const m3 = await screen.findByText('m3');
    expect(isBefore(m3, screen.getByText('m5'))).toBe(true);
  });

  it('replaces the list when a poll page does not overlap what is loaded', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listMessages
      .mockResolvedValueOnce(page([msg(1)], null))
      .mockResolvedValue(page([msg(4), msg(3)], 'p2'));
    renderAt('/messages/1');
    await screen.findByText('m1');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(await screen.findByText('m4')).toBeInTheDocument();
    expect(screen.queryByText('m1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load older messages' })).toBeInTheDocument();
  });

  it('stops polling and shows a notice when the conversation returns 404', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listMessages
      .mockResolvedValueOnce(page([msg(1)], null))
      .mockRejectedValue({ response: { status: 404 } });
    renderAt('/messages/1');
    await screen.findByText('m1');

    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
    }
    // One initial load plus the single poll that failed.
    expect(api.listMessages).toHaveBeenCalledTimes(2);
    expect(screen.getByText('This conversation is no longer available.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/message u\/bob/i)).not.toBeInTheDocument();
  });

  it('keeps polling after a network error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listMessages
      .mockResolvedValueOnce(page([msg(1)], null))
      .mockRejectedValue(new Error('Network Error'));
    renderAt('/messages/1');
    await screen.findByText('m1');

    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
    }
    expect(api.listMessages).toHaveBeenCalledTimes(4);
    expect(screen.getByPlaceholderText(/message u\/bob/i)).toBeInTheDocument();
  });

  it('drops an older page that resolves after a poll replaced the list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolveOlder!: (value: ReturnType<typeof page>) => void;
    api.listMessages.mockImplementation((_id, pageNumber) => {
      if (pageNumber === 2) {
        return new Promise<ReturnType<typeof page>>((resolve) => {
          resolveOlder = resolve;
        });
      }
      return Promise.resolve(
        api.listMessages.mock.calls.length === 1 ? page([msg(3)], 'p2') : page([msg(6), msg(5)], 'p2'),
      );
    });
    renderAt('/messages/1');

    fireEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await screen.findByText('m6');

    await act(async () => resolveOlder(page([msg(2), msg(1)], null)));
    expect(screen.queryByText('m1')).not.toBeInTheDocument();
    expect(screen.queryByText('m2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    const olderCalls = api.listMessages.mock.calls.filter(([, p]) => p === 2);
    expect(olderCalls).toHaveLength(2);
  });

  it('does not duplicate a sent message when a poll resolves in the same tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let resolveSend!: (value: Message) => void;
    let resolvePoll!: (value: ReturnType<typeof page>) => void;
    api.listMessages
      .mockResolvedValueOnce(page([msg(1)], null))
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof page>>((resolve) => {
            resolvePoll = resolve;
          }),
      );
    api.sendMessage.mockImplementation(
      () =>
        new Promise<Message>((resolve) => {
          resolveSend = resolve;
        }),
    );
    renderAt('/messages/1');

    await user.type(await screen.findByPlaceholderText(/message u\/bob/i), 'm2');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });

    // Both responses settle before React flushes the send's state update.
    await act(async () => {
      resolveSend(msg(2, 1));
      resolvePoll(page([msg(2, 1), msg(1)], null));
    });
    expect(screen.getAllByText('m2')).toHaveLength(1);
  });
});

function scrollContainerOf(el: HTMLElement) {
  return el.closest('.overflow-y-auto') as HTMLElement;
}

// jsdom has no layout, so the scroll geometry is stubbed on the element itself.
function scrollUp(container: HTMLElement) {
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 300 });
  Object.defineProperty(container, 'scrollTop', { configurable: true, writable: true, value: 100 });
  fireEvent.scroll(container);
}

describe('MessagesPage scroll position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConversations.mockResolvedValue(convs([conversation]));
    api.markConversationRead.mockResolvedValue();
  });

  afterEach(() => vi.useRealTimers());

  const read = { ...msg(1), read_at: '2026-10-01T00:05:00Z' };

  async function openScrolledUp() {
    renderAt('/messages/1');
    scrollUp(scrollContainerOf(await screen.findByText('m1')));
    vi.mocked(Element.prototype.scrollTo).mockClear();
  }

  it('does not jump to the bottom on an empty poll while the user has scrolled up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listMessages.mockResolvedValue(page([read], null));
    await openScrolledUp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(api.listMessages).toHaveBeenCalledTimes(2);
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
  });

  it('does not jump to the bottom for an incoming message while the user has scrolled up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listMessages
      .mockResolvedValueOnce(page([read], null))
      .mockResolvedValue(page([msg(2), read], null));
    await openScrolledUp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(await screen.findByText('m2')).toBeInTheDocument();
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
  });
});

describe('MessagesPage conversation list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.markConversationRead.mockResolvedValue();
    api.listMessages.mockResolvedValue(page([], null));
  });

  it('refetches the list once when the routed conversation is not in it', async () => {
    api.listConversations
      .mockResolvedValueOnce(convs([conversation]))
      .mockResolvedValue(convs([otherConversation, conversation]));
    renderAt('/messages/2');

    expect(await screen.findByPlaceholderText(/message u\/carol/i)).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenCalledTimes(2);
  });

  it('does not keep refetching when the routed conversation never appears', async () => {
    api.listConversations.mockResolvedValue(convs([conversation]));
    renderAt('/messages/99');

    await screen.findByText('Select a conversation to start chatting.');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(api.listConversations).toHaveBeenCalledTimes(2);
  });

  it('moves a conversation to the top of the list after sending in it', async () => {
    api.listConversations.mockResolvedValue(convs([conversation, otherConversation]));
    api.sendMessage.mockResolvedValue(msg(7, 1, 2));
    renderAt('/messages/2');

    const rowOrder = () =>
      screen
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
        .filter((h) => /^\/messages\/\d+$/.test(h ?? ''));
    await userEvent.type(await screen.findByPlaceholderText(/message u\/carol/i), 'm7');
    expect(rowOrder()).toEqual(['/messages/1', '/messages/2']);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('You: m7');
    expect(rowOrder()).toEqual(['/messages/2', '/messages/1']);
  });

  it('refreshes the list every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.listConversations
        .mockResolvedValueOnce(convs([conversation]))
        .mockResolvedValue(convs([{ ...conversation, unread_count: 3 }]));
      renderAt('/messages');
      await screen.findByText('u/bob');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(await screen.findByText('3')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not derive the DM badge from loaded conversations', async () => {
    api.listConversations.mockResolvedValue(convs([{ ...conversation, unread_count: 4 }]));
    const { store } = renderAt('/messages', 7);
    await screen.findByText('u/bob');
    expect(store.getState().messaging.dmUnreadCount).toBe(7);
  });

  it('syncs both badges from the server after marking a conversation read', async () => {
    api.listConversations.mockResolvedValue(convs([{ ...conversation, unread_count: 2 }]));
    api.listMessages.mockResolvedValue(page([msg(1)], null));
    let finishRead: () => void = () => undefined;
    api.markConversationRead.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRead = resolve;
      }) as ReturnType<typeof messagingApi.markConversationRead>,
    );
    users.getUnreadCounts.mockResolvedValue({ notifications: 1, messages: 0 });
    const { store } = renderAt('/messages/1', 2);
    await waitFor(() => expect(api.markConversationRead).toHaveBeenCalledTimes(1));
    expect(users.getUnreadCounts).not.toHaveBeenCalled();

    await act(async () => finishRead());
    expect(users.getUnreadCounts).toHaveBeenCalledTimes(1);
    expect(store.getState().messaging.dmUnreadCount).toBe(0);
  });

  it('loads the next page of conversations on demand', async () => {
    api.listConversations
      .mockResolvedValueOnce(convs([conversation], 'p2'))
      .mockResolvedValueOnce(convs([otherConversation]));
    renderAt('/messages');
    await userEvent.click(await screen.findByRole('button', { name: 'Load more conversations' }));
    expect(await screen.findByText('u/carol')).toBeInTheDocument();
    expect(api.listConversations).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole('button', { name: 'Load more conversations' })).not.toBeInTheDocument();
  });

  it('keeps later-page conversations when the first page is polled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.listConversations
        .mockResolvedValueOnce(convs([conversation], 'p2'))
        .mockResolvedValueOnce(convs([otherConversation]))
        .mockResolvedValue(convs([{ ...conversation, unread_count: 2 }], 'p2'));
      renderAt('/messages');
      await userEvent.click(await screen.findByRole('button', { name: 'Load more conversations' }));
      await screen.findByText('u/carol');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(await screen.findByText('2')).toBeInTheDocument();
      expect(screen.getByText('u/carol')).toBeInTheDocument();
      expect(screen.getAllByText('u/bob')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MessagesPage read receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listConversations.mockResolvedValue(convs([conversation]));
    api.markConversationRead.mockResolvedValue();
  });

  // A title tooltip is not announced reliably, and the icon itself is hidden from screen readers.
  it('names the receipt state for screen readers', async () => {
    api.listMessages.mockResolvedValue(page([{ ...msg(2, 1), read_at: '2026-10-01T00:05:00Z' }, msg(1, 1)], null));
    renderAt('/messages/1');
    const read = await screen.findByText('m2', { selector: 'div' });
    expect(read).toHaveTextContent(/^m2.*Read$/);
    expect(screen.getByText('m1', { selector: 'div' })).toHaveTextContent(/^m1.*Sent$/);
  });
});

describe('MessagesPage in Turkish', () => {
  const ENGLISH_PROBE =
    /\b(Inbox|New|Start a new|Select a conversation|No conversations|No messages|Say hi|Loading|Send|You|Read|Sent|Cancel|Username|Could not start)\b/;

  beforeEach(() => {
    vi.clearAllMocks();
    api.markConversationRead.mockResolvedValue();
  });

  afterEach(resetLanguage);

  it('renders no English in Turkish', async () => {
    await i18n.changeLanguage('tr');
    api.listConversations.mockResolvedValue(
      convs([{ ...conversation, last_message: msg(1, 1) }]),
    );
    api.listMessages.mockResolvedValue(page([msg(1, 1)], null));
    api.startConversation.mockRejectedValue(new Error('network'));
    renderAt('/messages/1');
    expect(visibleText()).not.toMatch(ENGLISH_PROBE);
    await screen.findByText('m1', { selector: 'div' });
    expect(screen.getByText(/^Sen: m1$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '+ Yeni' }));
    await userEvent.type(screen.getByLabelText('Kullanıcı adı'), 'bob');
    await userEvent.click(screen.getByRole('button', { name: 'Başlat' }));
    expect(await screen.findByText('Sohbet başlatılamadı.')).toBeInTheDocument();
    expect(visibleText()).not.toMatch(ENGLISH_PROBE);
  });

  it('renders the empty states in Turkish', async () => {
    await i18n.changeLanguage('tr');
    api.listConversations.mockResolvedValue(convs([]));
    renderAt('/messages');
    expect(await screen.findByText('Henüz sohbet yok.')).toBeInTheDocument();
    expect(visibleText()).not.toMatch(ENGLISH_PROBE);
  });

  it('sets the page title', async () => {
    api.listConversations.mockResolvedValue(convs([]));
    renderAt('/messages');
    await waitFor(() => expect(document.title).toBe('Messages · Nexus'));
  });
});
