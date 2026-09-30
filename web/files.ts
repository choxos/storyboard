const database = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("storyboard-web", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function stored(key: string): Promise<unknown> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly"),
      request = tx.objectStore("files").get(key);
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export async function storeFile(key: string, value: unknown): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(
        tx.error ||
          new Error(
            "Browser storage is full or unavailable. Download a project copy.",
          ),
      );
    };
  });
}
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    input.id = "browser-file";
    const finish = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] || null), {
      once: true,
    });
    input.addEventListener("cancel", () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}
export function download(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 200);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return link.download;
}
