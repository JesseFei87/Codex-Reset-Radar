const fs = require('node:fs');
const path = require('node:path');

class SecretStore {
  constructor(directory, safeStorage) {
    this.directory = directory;
    this.safeStorage = safeStorage;
  }

  file(name) {
    return path.join(this.directory, `${name}.secret`);
  }

  has(name) {
    return fs.existsSync(this.file(name));
  }

  get(name) {
    if (!this.has(name)) return null;
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用');
    return this.safeStorage.decryptString(fs.readFileSync(this.file(name)));
  }

  set(name, value) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用');
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(this.file(name), this.safeStorage.encryptString(String(value)));
  }

  clear(name) {
    fs.rmSync(this.file(name), { force: true });
  }
}

module.exports = { SecretStore };
