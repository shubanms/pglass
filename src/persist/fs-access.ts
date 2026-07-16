// File System Access API wrapper with a download/upload fallback for browsers
// that don't support it (Firefox/Safari). PRD §14.2. The handle lets Ctrl+S
// write straight back to schema.pgl on disk.

export type FileKind = 'pgl' | 'sql' | 'pglass';

export interface OpenedFile {
  name: string;
  kind: FileKind;
  text?: string;
  bytes?: Uint8Array;
  handle?: FileSystemFileHandle;
}

// The File System Access API isn't in the default TS lib; access via a cast.
type WithFsAccess = Window &
  typeof globalThis & {
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
  };

export interface FileSystemFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: BufferSource | string): Promise<void>;
    close(): Promise<void>;
  }>;
}

export function isFsSupported(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

function kindOf(name: string): FileKind {
  if (name.endsWith('.pglass')) return 'pglass';
  if (name.endsWith('.sql')) return 'sql';
  return 'pgl';
}

/** Open a file via the picker (FS Access) or an <input> fallback. */
export async function pickAndReadFile(): Promise<OpenedFile | null> {
  const w = window as WithFsAccess;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [
          {
            description: 'Pglass / SQL',
            accept: { 'text/plain': ['.pgl', '.sql'], 'application/zip': ['.pglass'] },
          },
        ],
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return await readFile(file, handle);
    } catch {
      return null; // user cancelled
    }
  }
  return readViaInput();
}

async function readFile(file: File, handle?: FileSystemFileHandle): Promise<OpenedFile> {
  const kind = kindOf(file.name);
  if (kind === 'pglass') {
    return { name: file.name, kind, bytes: new Uint8Array(await file.arrayBuffer()), handle };
  }
  return { name: file.name, kind, text: await file.text(), handle };
}

function readViaInput(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pgl,.sql,.pglass';
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? await readFile(file) : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Write back to an existing handle (Ctrl+S with no dialog). */
export async function writeToHandle(
  handle: FileSystemFileHandle,
  data: string | Uint8Array,
): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data as BufferSource);
  await writable.close();
}

/** Save-as: pick a location (FS Access) and return the handle, or download. */
export async function saveAs(
  suggestedName: string,
  data: string | Uint8Array,
): Promise<FileSystemFileHandle | null> {
  const w = window as WithFsAccess;
  if (w.showSaveFilePicker) {
    try {
      const ext = suggestedName.split('.').pop() ?? 'pgl';
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Pglass', accept: { 'text/plain': [`.${ext}`] } }],
      });
      await writeToHandle(handle, data);
      return handle;
    } catch {
      return null;
    }
  }
  downloadFile(suggestedName, data);
  return null;
}

export function downloadFile(name: string, data: string | Uint8Array): void {
  const blob = new Blob([data as BlobPart], {
    type: name.endsWith('.pglass') ? 'application/zip' : 'text/plain',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
