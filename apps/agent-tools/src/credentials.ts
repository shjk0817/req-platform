/**
 * 系统凭据存储
 * 作用：优先使用 macOS Keychain、Windows Credential Manager 或 Linux Secret Service，
 *      只有显式设置 AIM_ALLOW_FILE_CREDENTIALS=true 才允许回退到本地权限文件
 */
import keytar from 'keytar';
import { existsSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CONFIG_DIR, CREDENTIAL_SERVICE, loadConfig } from './config.js';
import { join } from 'node:path';

const FILE_PATH = join(CONFIG_DIR, 'credentials.json');

/** 令牌键名 */
export type CredentialKey = 'platform-token' | 'gitea-token';

export class CredentialStore {
  /** 保存凭据 */
  async set(key: CredentialKey, value: string): Promise<void> {
    if (!value.trim()) {
      throw new Error('凭据不能为空');
    }
    try {
      await keytar.setPassword(CREDENTIAL_SERVICE, key, value);
      return;
    } catch (error) {
      if (!loadConfig().allowFileCredentials) {
        throw new Error(`系统钥匙串不可用，请显式设置 AIM_ALLOW_FILE_CREDENTIALS=true 后再使用文件降级：${(error as Error).message}`);
      }
    }
    const credentials = this.readFile();
    credentials[key] = value;
    this.writeFile(credentials);
  }

  /** 读取凭据 */
  async get(key: CredentialKey): Promise<string | null> {
    try {
      const value = await keytar.getPassword(CREDENTIAL_SERVICE, key);
      if (value) {
        return value;
      }
    } catch (error) {
      if (!loadConfig().allowFileCredentials) {
        throw new Error(`系统钥匙串不可用，请显式设置 AIM_ALLOW_FILE_CREDENTIALS=true：${(error as Error).message}`);
      }
    }
    return this.readFile()[key] ?? null;
  }

  /** 删除凭据 */
  async delete(key: CredentialKey): Promise<void> {
    try {
      await keytar.deletePassword(CREDENTIAL_SERVICE, key);
    } catch (error) {
      if (!loadConfig().allowFileCredentials) {
        throw new Error(`系统钥匙串不可用，请显式设置 AIM_ALLOW_FILE_CREDENTIALS=true：${(error as Error).message}`);
      }
    }
    const credentials = this.readFile();
    delete credentials[key];
    this.writeFile(credentials);
  }

  private readFile(): Partial<Record<CredentialKey, string>> {
    if (!existsSync(FILE_PATH)) {
      return {};
    }
    try {
      return JSON.parse(readFileSync(FILE_PATH, 'utf8')) as Partial<Record<CredentialKey, string>>;
    } catch {
      return {};
    }
  }

  private writeFile(credentials: Partial<Record<CredentialKey, string>>): void {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(FILE_PATH, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    chmodSync(FILE_PATH, 0o600);
  }
}
