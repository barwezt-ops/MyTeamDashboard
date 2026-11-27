// Dialogs for owner-entered records and copyable documents.
import { useState, type FormEvent, type ReactNode } from "react";
import { api, message } from "../api";
import { Modal } from "../components/design";
import { ErrorNotice } from "../components/ui";
import { useShared } from "./context";
import { copy } from "./copy";

/** Runs a save, reports it and reloads the open views. */
export function useSave() {
  const { changed, notify } = useShared();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      notify(done);
      changed();
      return true;
    } catch (error) {
      setError(message(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, error };
}

export function FormDialog({
  title,
  close,
  submit,
  action,
  done,
  children,
}: {
  title: string;
  close: () => void;
  submit: () => Promise<unknown>;
  action: string;
  done: string;
  children: ReactNode;
}) {
  const { save, busy, error } = useSave();
  async function send(event: FormEvent) {
    event.preventDefault();
    if (await save(submit, done)) close();
  }
  return (
    <Modal title={title} close={close}>
      <form className="record-form" onSubmit={send}>
        {children}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="button-row">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : action}
          </button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function DismissDialog({
  flag,
  name,
  close,
}: {
  flag: { id: string; token: string; reason: string };
  name: string;
  close: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <FormDialog
      title="Dismiss flag"
      close={close}
      action="Dismiss"
      done="Flag dismissed."
      submit={() =>
        api("/v2/flags/dismiss", "POST", {
          id: flag.id,
          token: flag.token,
          reason,
        })
      }
    >
      <p>
        {name}: {flag.reason}. It comes back only if new facts arrive.
      </p>
      <label>
        Reason
        <textarea
          aria-label="Reason"
          required
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
    </FormDialog>
  );
}

export type NoteDraft = {
  id?: number;
  date: string;
  body: string;
  tags: string[];
};

export function NoteDialog({
  code,
  note,
  close,
}: {
  code: string;
  note: NoteDraft;
  close: () => void;
}) {
  const [date, setDate] = useState(note.date);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState(note.tags.join(", "));
  const values = () => ({
    date,
    body,
    tags: [
      ...new Set(
        tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ],
  });
  return (
    <FormDialog
      title={note.id ? "Edit private note" : "Add private note"}
      close={close}
      action="Save note"
      done="Note saved."
      submit={() =>
        note.id
          ? api(`/v2/notes/${note.id}`, "PATCH", values())
          : api("/v2/notes", "POST", { ...values(), code })
      }
    >
      <label>
        Date
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label>
        Note
        <textarea
          aria-label="Note"
          required
          maxLength={10000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label>
        Tags, separated by commas
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <p className="quiet">
        Private. Kept on this computer and in your backups.
      </p>
    </FormDialog>
  );
}

/** Shows a generated document the owner can edit before copying. */
export function DocumentDialog({
  title,
  text,
  close,
  notes = true,
}: {
  title: string;
  text: (includeNotes: boolean) => string;
  close: () => void;
  notes?: boolean;
}) {
  const [include, setInclude] = useState(false);
  const [draft, setDraft] = useState(() => text(false));
  const [status, setStatus] = useState("");
  return (
    <Modal title={title} close={close}>
      <div className="record-form">
        {notes && (
          <label className="check">
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => {
                setInclude(e.target.checked);
                setDraft(text(e.target.checked));
              }}
            />
            Include private notes
          </label>
        )}
        <label>
          Text
          <textarea
            aria-label="Text"
            className="document-text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            className="primary"
            onClick={() =>
              void copy(draft)
                .then(() => setStatus("Copied."))
                .catch((error) => setStatus(message(error)))
            }
          >
            Copy
          </button>
          <button type="button" className="secondary" onClick={close}>
            Close
          </button>
          <span role="status">{status}</span>
        </div>
      </div>
    </Modal>
  );
}
