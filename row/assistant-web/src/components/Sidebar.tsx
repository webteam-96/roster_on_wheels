import type { ConversationSummary } from "@/lib/api";
import { CloseIcon, PlusIcon, TrashIcon } from "./icons";

interface Props {
  conversations: ConversationSummary[];
  activeId: number | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: number) => void;
  onDelete: (c: ConversationSummary) => void;
}

function shortDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function Sidebar({ conversations, activeId, open, onClose, onNew, onSelect, onDelete }: Props) {
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <button
          type="button"
          aria-label="Close conversation list"
          className="fixed inset-0 z-30 bg-slate-900/40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        id="conversation-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white transition-[transform,visibility] md:visible md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={onNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gold-500 px-3 py-2 text-sm font-semibold text-ink hover:bg-gold-600"
          >
            <PlusIcon className="h-4 w-4" />
            New chat
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close conversation list"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-500">No conversations yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => {
                const active = c.id === activeId;
                return (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      aria-current={active ? "page" : undefined}
                      className={`w-full rounded-lg py-2 pl-3 pr-10 text-left text-sm ${
                        active ? "bg-navy-50 font-medium text-navy-900" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="block truncate">{c.title || "Untitled conversation"}</span>
                      <span className="block text-xs font-normal text-slate-400">{shortDate(c.updatedDate)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(c)}
                      aria-label={`Delete conversation: ${c.title || "Untitled conversation"}`}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  );
}
