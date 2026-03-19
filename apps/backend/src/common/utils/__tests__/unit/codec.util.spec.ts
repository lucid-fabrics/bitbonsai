import { normalizeCodec } from '../../codec.util';

describe('normalizeCodec', () => {
  // ── HEVC / H.265 variants ────────────────────────────────────────────────

  it('normalizes "hevc" to "hevc"', () => {
    expect(normalizeCodec('hevc')).toBe('hevc');
  });

  it('normalizes "h265" to "hevc"', () => {
    expect(normalizeCodec('h265')).toBe('hevc');
  });

  it('normalizes "h.265" to "hevc"', () => {
    expect(normalizeCodec('h.265')).toBe('hevc');
  });

  it('normalizes "hvc1" to "hevc"', () => {
    expect(normalizeCodec('hvc1')).toBe('hevc');
  });

  it('normalizes "x265" to "hevc"', () => {
    expect(normalizeCodec('x265')).toBe('hevc');
  });

  // ── H.264 / AVC variants ─────────────────────────────────────────────────

  it('normalizes "h264" to "h264"', () => {
    expect(normalizeCodec('h264')).toBe('h264');
  });

  it('normalizes "h.264" to "h264"', () => {
    expect(normalizeCodec('h.264')).toBe('h264');
  });

  it('normalizes "avc" to "h264"', () => {
    expect(normalizeCodec('avc')).toBe('h264');
  });

  it('normalizes "avc1" to "h264"', () => {
    expect(normalizeCodec('avc1')).toBe('h264');
  });

  it('normalizes "x264" to "h264"', () => {
    expect(normalizeCodec('x264')).toBe('h264');
  });

  // ── VP9 variants ─────────────────────────────────────────────────────────

  it('normalizes "vp9" to "vp9"', () => {
    expect(normalizeCodec('vp9')).toBe('vp9');
  });

  it('normalizes "vp 9" to "vp9"', () => {
    expect(normalizeCodec('vp 9')).toBe('vp9');
  });

  it('normalizes "vp09" to "vp9"', () => {
    expect(normalizeCodec('vp09')).toBe('vp9');
  });

  // ── AV1 variants ─────────────────────────────────────────────────────────

  it('normalizes "av1" to "av1"', () => {
    expect(normalizeCodec('av1')).toBe('av1');
  });

  it('normalizes "av01" to "av1"', () => {
    expect(normalizeCodec('av01')).toBe('av1');
  });

  // ── VP8 variants ─────────────────────────────────────────────────────────

  it('normalizes "vp8" to "vp8"', () => {
    expect(normalizeCodec('vp8')).toBe('vp8');
  });

  it('normalizes "vp08" to "vp8"', () => {
    expect(normalizeCodec('vp08')).toBe('vp8');
  });

  // ── MPEG variants ─────────────────────────────────────────────────────────

  it('normalizes "mpeg2" to "mpeg2"', () => {
    expect(normalizeCodec('mpeg2')).toBe('mpeg2');
  });

  it('normalizes "mpeg-2" to "mpeg2"', () => {
    expect(normalizeCodec('mpeg-2')).toBe('mpeg2');
  });

  it('normalizes "mpeg4" to "mpeg4"', () => {
    expect(normalizeCodec('mpeg4')).toBe('mpeg4');
  });

  it('normalizes "mpeg-4" to "mpeg4"', () => {
    expect(normalizeCodec('mpeg-4')).toBe('mpeg4');
  });

  // ── Case insensitivity ────────────────────────────────────────────────────

  it('normalizes uppercase "HEVC" to "hevc"', () => {
    expect(normalizeCodec('HEVC')).toBe('hevc');
  });

  it('normalizes mixed-case "H264" to "h264"', () => {
    expect(normalizeCodec('H264')).toBe('h264');
  });

  it('normalizes "AV1" to "av1"', () => {
    expect(normalizeCodec('AV1')).toBe('av1');
  });

  // ── Whitespace trimming ───────────────────────────────────────────────────

  it('trims leading/trailing whitespace', () => {
    expect(normalizeCodec('  hevc  ')).toBe('hevc');
  });

  it('trims and normalizes uppercase with spaces', () => {
    expect(normalizeCodec('  H265  ')).toBe('hevc');
  });

  // ── Unknown codec passthrough ─────────────────────────────────────────────

  it('returns unknown codec as-is (lowercased)', () => {
    expect(normalizeCodec('theora')).toBe('theora');
  });

  it('returns unknown codec lowercased', () => {
    expect(normalizeCodec('PRORES')).toBe('prores');
  });
});
