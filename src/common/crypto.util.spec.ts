import { encrypt, decrypt } from './crypto.util';

describe('crypto.util', () => {
  const key = 'a'.repeat(64);

  it('round-trips plaintext through encrypt/decrypt', () => {
    const plain = '8Ff2QmXQm9CQm9CQm9CQm9CQm9CQm9CwQ8f';
    const stored = encrypt(plain, key);
    expect(stored).not.toContain(plain);
    expect(decrypt(stored, key)).toBe(plain);
  });

  it('produces a different iv (and ciphertext) each call', () => {
    const plain = 'same-plaintext';
    const a = encrypt(plain, key);
    const b = encrypt(plain, key);
    expect(a).not.toBe(b);
    expect(decrypt(a, key)).toBe(plain);
    expect(decrypt(b, key)).toBe(plain);
  });

  it('throws on malformed stored value', () => {
    expect(() => decrypt('not-a-valid-format', key)).toThrow();
  });

  it('throws when authTag/ciphertext is tampered with', () => {
    const stored = encrypt('secret', key);
    const [iv, authTag, ciphertext] = stored.split(':');
    const tampered = `${iv}:${authTag}:${ciphertext.slice(0, -2)}00`;
    expect(() => decrypt(tampered, key)).toThrow();
  });
});
