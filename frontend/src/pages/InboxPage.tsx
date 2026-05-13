import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, MessageSquare } from 'lucide-react';
import { inboxApi } from '../lib/api';

interface Thread {
  thread_id: string;
  participant_name: string | null;
  last_message: string;
  timestamp: number;
}

interface Message {
  id: string;
  thread_id: string;
  direction: 'in' | 'out';
  sender_name: string | null;
  text: string;
  timestamp: number;
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function InboxPage() {
  const qc = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data: threads = [], isLoading: threadsLoading } = useQuery({
    queryKey: ['inbox-threads'],
    queryFn: inboxApi.threads,
    refetchInterval: 60000,
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['inbox-messages', selectedThread],
    queryFn: () => inboxApi.messages(selectedThread!),
    enabled: !!selectedThread,
    refetchInterval: 30000,
  });

  const replyMutation = useMutation({
    mutationFn: () => inboxApi.reply(selectedThread!, replyText),
    onSuccess: () => {
      setReplyText('');
      qc.invalidateQueries({ queryKey: ['inbox-messages', selectedThread] });
      qc.invalidateQueries({ queryKey: ['inbox-threads'] });
    },
  });

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Thread list */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Inbox</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threadsLoading ? (
            <p className="text-sm text-gray-400 p-4">Loading…</p>
          ) : (threads as Thread[]).length === 0 ? (
            <p className="text-sm text-gray-400 p-4">
              No conversations yet. The inbox poller runs every 15 minutes after you connect your account.
            </p>
          ) : (
            (threads as Thread[]).map(thread => (
              <button
                key={thread.thread_id}
                onClick={() => setSelectedThread(thread.thread_id)}
                className={`w-full text-left p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                  selectedThread === thread.thread_id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                }`}
              >
                <p className="font-medium text-sm text-gray-900 truncate">
                  {thread.participant_name || 'Unknown'}
                </p>
                <p className="text-xs text-gray-500 truncate mt-0.5">{thread.last_message}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formatTime(thread.timestamp)}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Message view */}
      <div className="flex-1 flex flex-col bg-gray-50 min-w-0">
        {!selectedThread ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageSquare size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a conversation to view messages</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messagesLoading ? (
                <p className="text-sm text-gray-400">Loading messages…</p>
              ) : (messages as Message[]).length === 0 ? (
                <p className="text-sm text-gray-400 text-center mt-8">No messages in this thread yet</p>
              ) : (
                (messages as Message[]).map(msg => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm shadow-sm ${
                        msg.direction === 'out'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white text-gray-900 border border-gray-200'
                      }`}
                    >
                      {msg.direction === 'in' && msg.sender_name && (
                        <p className={`text-xs font-medium mb-1 ${msg.direction === 'in' ? 'text-gray-500' : 'text-blue-200'}`}>
                          {msg.sender_name}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      <p className={`text-xs mt-1.5 ${msg.direction === 'out' ? 'text-blue-200' : 'text-gray-400'}`}>
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reply area */}
            <div className="p-4 border-t border-gray-200 bg-white">
              <div className="flex gap-2">
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && replyText.trim()) {
                      replyMutation.mutate();
                    }
                  }}
                  placeholder="Type a reply… (Cmd+Enter to send)"
                  rows={2}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  onClick={() => replyMutation.mutate()}
                  disabled={!replyText.trim() || replyMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 self-end"
                >
                  <Send size={14} />
                  {replyMutation.isPending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
