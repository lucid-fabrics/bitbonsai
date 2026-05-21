import { ClipboardBo } from './clipboard.bo';

describe('ClipboardBo', () => {
  describe('copyToClipboard', () => {
    it('should return true when clipboard.writeText resolves', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
      });
      const result = await ClipboardBo.copyToClipboard('hello');
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    });

    it('should return false when clipboard.writeText rejects', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      });
      const result = await ClipboardBo.copyToClipboard('hello');
      expect(result).toBe(false);
    });
  });

  describe('copyWithMessage', () => {
    it('should return message with label when copy succeeds', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
      });
      const { message, clear } = await ClipboardBo.copyWithMessage('secret', 'API Key');
      expect(message).toBe('API Key copied to clipboard');
      expect(clear).toBeInstanceOf(Function);
    });

    it('should return null message when copy fails', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      });
      const { message } = await ClipboardBo.copyWithMessage('secret', 'License Key');
      expect(message).toBeNull();
    });

    it('clear() should not throw', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
      });
      const { clear } = await ClipboardBo.copyWithMessage('text', 'Token');
      expect(() => clear()).not.toThrow();
    });
  });
});
