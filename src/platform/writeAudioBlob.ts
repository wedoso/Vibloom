/** Closing commits an OPFS stream. On write failure abort it instead, so the
 * previous file is not replaced by a partially written version. */
export async function writeAudioBlob(writer: FileSystemWritableFileStream, file: Blob) {
  try { await writer.write(file); await writer.close(); }
  catch (error) { try { await writer.abort(); } catch { /* Preserve the write/close error. */ } throw error; }
}
