/** Read container metadata on the server; browser durations are not trusted. */
export function mp4Duration(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  function atoms(from: number, end: number) {
    const rows: { type: string; data: number; end: number }[] = [];
    let at = from;
    while (at < end) {
      if (end - at < 8) throw Error("Invalid MP4 atom.");
      let size = view.getUint32(at), header = 8;
      if (size === 1) {
        if (end - at < 16) throw Error("Invalid MP4 atom.");
        size = view.getUint32(at + 8) * 4294967296 + view.getUint32(at + 12);
        header = 16;
      } else if (size === 0) size = end - at;
      if (!Number.isSafeInteger(size) || size < header || at + size > end) throw Error("Invalid MP4 size.");
      rows.push({ type: text(at + 4), data: at + header, end: at + size });
      at += size;
    }
    return rows;
  }
  const root = atoms(0, bytes.length);
  if (!root.some(a => a.type === "ftyp")) throw Error("Use an MP4 video.");
  const moov = root.find(a => a.type === "moov");
  if (!moov) throw Error("Video has no movie metadata.");
  const movie = atoms(moov.data, moov.end), mvhd = movie.find(a => a.type === "mvhd");
  if (!mvhd) throw Error("Video duration is unavailable.");
  const version = bytes[mvhd.data];
  if (version !== 0 && version !== 1) throw Error("Unsupported MP4 metadata.");
  const offset = mvhd.data + (version === 1 ? 20 : 12), length = version === 1 ? 12 : 8;
  if (offset + length > mvhd.end) throw Error("Truncated MP4 metadata.");
  const scale = view.getUint32(offset), duration = version === 1 ? view.getUint32(offset + 4) * 4294967296 + view.getUint32(offset + 8) : view.getUint32(offset + 4);
  let video = false;
  for (const track of movie.filter(a => a.type === "trak")) {
    const media = atoms(track.data, track.end).find(a => a.type === "mdia");
    if (!media) continue;
    const handler = atoms(media.data, media.end).find(a => a.type === "hdlr");
    if (handler && handler.end - handler.data >= 12 && text(handler.data + 8) === "vide") video = true;
  }
  if (!video || !scale || !Number.isSafeInteger(duration) || !Number.isFinite(duration / scale)) throw Error("A valid video track and duration are required.");
  return duration / scale;
}
